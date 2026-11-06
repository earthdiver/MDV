using System.IO.Compression;
using System.Net;
using System.Text.Json;
using Mdv.Core;

static class DocumentImageTests
{
    private const string Source = "https://images.example.com/original.png?size=large&token=abc";
    private static readonly byte[] Pixels = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=");
    private static void Assert(bool ok) { if (!ok) throw new Exception("Document image assertion failed."); }
    private static HttpResponseMessage Image(byte[]? bytes = null) => new(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes ?? Pixels) { Headers = { ContentType = new("image/png") } } };
    private static void Snapshot(string document, bool github, string article, params (string Source, string Url, bool Direct, byte[] Bytes)[] images)
    {
        using var zip = ZipFile.Open(QiitaImageArchive.PathFor(document, github), ZipArchiveMode.Create);
        var written = new HashSet<string>();
        var saved = images.Select(image => {
            var hash = QiitaImageArchive.Hash(image.Bytes);
            if (written.Add(hash))
            {
                using var entry = zip.CreateEntry("images/" + hash, CompressionLevel.NoCompression).Open();
                entry.Write(image.Bytes);
            }
            return new QiitaSavedImage(image.Source, image.Url, hash, "image/png", image.Bytes.Length, image.Direct);
        }).ToArray();
        using var info = zip.CreateEntry("manifest.json").Open();
        JsonSerializer.Serialize(info, new QiitaImageManifest(2, article, DateTimeOffset.UtcNow, saved), new JsonSerializerOptions(JsonSerializerDefaults.Web));
    }
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        { token.ThrowIfCancellationRequested(); return Task.FromResult(reply(request)); }
    }

    internal static void Run(Action<string, Action> check, string folder)
    {
        foreach (var github in new[] { false, true })
        {
            var document = Path.Combine(folder, "direct-" + github + ".md");
            File.WriteAllText(document, "![image](" + Source + ")");
            check($"{github}: authored remote images save without any article URL or service request", () => {
                var requests = new List<string>();
                using var importer = new DocumentImageImporter(remoteHandler: new Handler(r => { requests.Add(r.RequestUri!.AbsoluteUri); return Image(); }),
                    githubHandler: new Handler(_ => throw new Exception("Unexpected GitHub request")), qiitaHandler: new Handler(_ => throw new Exception("Unexpected Qiita request")));
                var result = importer.ImportAsync(document, github, [Source, Source]).GetAwaiter().GetResult();
                Assert(result.Failures.Length == 0 && requests.SequenceEqual([Source]));
                var manifest = QiitaImageArchive.Load(document, github)!;
                Assert(manifest.Version == 2 && manifest.ArticleUrl == "" && manifest.Images.Length == 1);
                Assert(manifest.Images[0].Direct && manifest.Images[0].OriginalUrl == Source && manifest.Images[0].ServiceUrl == Source);
                var moved = Path.Combine(folder, "direct-moved-" + github + ".md");
                File.Copy(QiitaImageArchive.PathFor(document, github), QiitaImageArchive.PathFor(moved, github));
                Assert(QiitaImageArchive.Read(moved, QiitaImageArchive.Load(moved, github)!.Images[0], github).Bytes.SequenceEqual(Pixels));
                Assert(File.ReadAllText(document) == "![image](" + Source + ")");
            });
            check($"{github}: partial downloads report failures, skip local images and save available sources", () => {
                File.WriteAllBytes(Path.Combine(folder, "local.png"), Pixels);
                using var importer = new DocumentImageImporter(remoteHandler: new Handler(r => r.RequestUri!.AbsoluteUri == Source ? Image() : new(HttpStatusCode.NotFound)));
                var result = importer.ImportAsync(document, github, [Source, "https://images.example.com/missing.png", "missing-relative.png", "local.png", "data:image/png;base64,AAAA"]).GetAwaiter().GetResult();
                Assert(result.Manifest?.Images.Length == 1 && result.LocalImages == 1 && result.Failures.Length == 2);
                Assert(result.Failures.Select(f => f.Source).ToHashSet().SetEquals(["https://images.example.com/missing.png", "missing-relative.png"]));
            });
            check($"{github}: all failures and cancellation preserve previous snapshots", () => {
                var before = File.ReadAllBytes(QiitaImageArchive.PathFor(document, github));
                using (var importer = new DocumentImageImporter(remoteHandler: new Handler(_ => new(HttpStatusCode.NotFound))))
                {
                    var result = importer.ImportAsync(document, github, [Source]).GetAwaiter().GetResult();
                    Assert(result.Manifest == null && result.Failures.Length == 1);
                    Assert(result.ReusedImages == 1 && result.Failures[0].UsedPrevious);
                }
                using var cancellation = new CancellationTokenSource();
                using (var importer = new DocumentImageImporter(remoteHandler: new Handler(_ => { cancellation.Cancel(); return Image(); })))
                {
                    var cancelled = false;
                    try { importer.ImportAsync(document, github, [Source], cancellationToken: cancellation.Token).GetAwaiter().GetResult(); }
                    catch (OperationCanceledException) { cancelled = true; }
                    Assert(cancelled);
                }
                Assert(before.SequenceEqual(File.ReadAllBytes(QiitaImageArchive.PathFor(document, github))));
                Assert(!Directory.EnumerateFiles(folder, "*.zip.*.tmp").Any());
            });
            check($"{github}: partial refresh retains failed images, updates successes and removes unreferenced images", () => {
                var path = Path.Combine(folder, "refresh-" + github + ".md");
                const string updated = "https://images.example.com/updated.png", removed = "https://images.example.com/removed.png", missing = "https://images.example.com/new-missing.png";
                Snapshot(path, github, "", (Source, Source, true, Pixels), (updated, updated, true, new byte[] { 1 }), (removed, removed, true, new byte[] { 2 }));
                using var importer = new DocumentImageImporter(remoteHandler: new Handler(r => r.RequestUri!.AbsoluteUri == updated ? Image([3]) : new(HttpStatusCode.NotFound)));
                var result = importer.ImportAsync(path, github, [Source, updated, missing]).GetAwaiter().GetResult();
                var manifest = QiitaImageArchive.Load(path, github)!;
                Assert(result.Manifest != null && manifest.Images.Length == 2 && result.ReusedImages == 1);
                Assert(result.Failures.Length == 2 && result.Failures.Single(f => f.Source == Source).UsedPrevious && !result.Failures.Single(f => f.Source == missing).UsedPrevious);
                Assert(manifest.Images.Select(i => i.OriginalUrl).ToHashSet().SetEquals([Source, updated]));
                Assert(QiitaImageArchive.Read(path, manifest.Images.Single(i => i.OriginalUrl == Source), github).Bytes.SequenceEqual(Pixels));
                Assert(QiitaImageArchive.Read(path, manifest.Images.Single(i => i.OriginalUrl == updated), github).Bytes.SequenceEqual(new byte[] { 3 }));
            });
            check($"{github}: cancellation after a reused image leaves the previous archive intact", () => {
                var path = Path.Combine(folder, "cancel-reuse-" + github + ".md");
                Snapshot(path, github, "", (Source, Source, true, Pixels));
                var before = File.ReadAllBytes(QiitaImageArchive.PathFor(path, github));
                using var cancellation = new CancellationTokenSource();
                using var importer = new DocumentImageImporter(remoteHandler: new Handler(r => {
                    if (r.RequestUri!.AbsoluteUri == Source) return new(HttpStatusCode.NotFound);
                    cancellation.Cancel(); return Image();
                }));
                var cancelled = false;
                try { importer.ImportAsync(path, github, [Source, "https://images.example.com/cancel.png"], cancellationToken: cancellation.Token).GetAwaiter().GetResult(); }
                catch (OperationCanceledException) { cancelled = true; }
                Assert(cancelled && before.SequenceEqual(File.ReadAllBytes(QiitaImageArchive.PathFor(path, github))));
                Assert(!Directory.EnumerateFiles(folder, "*.zip.*.tmp").Any());
            });
            foreach (var invalidZip in new[] { false, true })
                check($"{github}: corrupt prior {(invalidZip ? "ZIP" : "image checksum")} is never reused", () => {
                    var path = Path.Combine(folder, $"corrupt-reuse-{github}-{invalidZip}.md");
                    var archive = QiitaImageArchive.PathFor(path, github);
                    if (invalidZip) File.WriteAllText(archive, "not a ZIP");
                    else
                    {
                        Snapshot(path, github, "", (Source, Source, true, Pixels));
                        using var zip = ZipFile.Open(archive, ZipArchiveMode.Update);
                        var name = "images/" + QiitaImageArchive.Hash(Pixels);
                        zip.GetEntry(name)!.Delete();
                        using var image = zip.CreateEntry(name).Open();
                        image.Write(new byte[Pixels.Length]);
                    }
                    var before = File.ReadAllBytes(archive);
                    using var importer = new DocumentImageImporter(remoteHandler: new Handler(r => r.RequestUri!.AbsoluteUri == Source ? new(HttpStatusCode.NotFound) : Image()));
                    var failed = importer.ImportAsync(path, github, [Source]).GetAwaiter().GetResult();
                    Assert(failed.Manifest == null && failed.ReusedImages == 0 && before.SequenceEqual(File.ReadAllBytes(archive)));
                    var result = importer.ImportAsync(path, github, [Source, "https://images.example.com/fresh.png"]).GetAwaiter().GetResult();
                    Assert(result.Manifest?.Images.Length == 1 && result.ReusedImages == 0 && !result.Failures[0].UsedPrevious);
                    Assert(result.Manifest!.Images[0].OriginalUrl != Source);
                });
        }
        check("Unresolved GitHub sources retain validated previous images when the optional URL is omitted", () => {
            var document = Path.Combine(folder, "github-reuse-relative.md");
            const string article = "https://raw.githubusercontent.com/owner/repo/main/docs/readme.md";
            const string source = "../images/repository.png", url = "https://raw.githubusercontent.com/owner/repo/main/images/repository.png";
            Snapshot(document, true, article, (source, url, false, Pixels));
            using var importer = new DocumentImageImporter(remoteHandler: new Handler(_ => Image()));
            var result = importer.ImportAsync(document, true, [Source, source]).GetAwaiter().GetResult();
            Assert(result.Manifest?.ArticleUrl == article && result.Manifest.Images.Length == 2 && result.ReusedImages == 1);
            Assert(result.Failures.Single().UsedPrevious && QiitaImageArchive.Load(document, true)!.Images.Any(i => i.OriginalUrl == source && !i.Direct));
        });
        check("Changing GitHub repositories does not reuse a different image with the same relative path", () => {
            var document = Path.Combine(folder, "github-reuse-changed-repository.md");
            const string source = "../images/repository.png";
            Snapshot(document, true, "https://raw.githubusercontent.com/owner/old/main/docs/readme.md",
                (source, "https://raw.githubusercontent.com/owner/old/main/images/repository.png", false, Pixels));
            using var importer = new DocumentImageImporter(remoteHandler: new Handler(_ => Image()), githubHandler: new Handler(_ => new(HttpStatusCode.NotFound)));
            var result = importer.ImportAsync(document, true, [Source, source], "https://github.com/owner/new/blob/main/docs/readme.md").GetAwaiter().GetResult();
            Assert(result.Manifest?.Images.Length == 1 && result.ReusedImages == 0 && !result.Failures.Single().UsedPrevious);
            Assert(result.Manifest!.Images[0].OriginalUrl == Source);
        });
        check("Reusing a published Qiita image preserves its validated service metadata", () => {
            var document = Path.Combine(folder, "qiita-reuse-cdn.md");
            const string article = "https://qiita.com/example/items/0123456789abcdef0123";
            var cdn = "https://qiita-user-contents.imgix.net/" + Uri.EscapeDataString(Source) + "?w=1400&s=signed";
            Snapshot(document, false, article, (Source, cdn, false, Pixels));
            using var importer = new DocumentImageImporter(remoteHandler: new Handler(r => r.RequestUri!.AbsoluteUri == Source ? new(HttpStatusCode.NotFound) : Image()));
            var result = importer.ImportAsync(document, false, [Source, "https://images.example.com/fresh.png"]).GetAwaiter().GetResult();
            Assert(result.Manifest?.ArticleUrl == article && result.ReusedImages == 1);
            Assert(QiitaImageArchive.Load(document)!.Images.Single(i => i.OriginalUrl == Source).ServiceUrl == cdn);
        });
        check("Reused relative images count toward the image limit without replacing the previous archive", () => {
            var document = Path.Combine(folder, "reuse-image-limit.md");
            const string article = "https://raw.githubusercontent.com/owner/repo/main/readme.md";
            var sources = Enumerable.Range(0, QiitaImageArchive.MaxImages).Select(i => $"images/{i}.png").ToArray();
            Snapshot(document, true, article, sources.Select(s => (s, "https://raw.githubusercontent.com/owner/repo/main/" + s, false, Pixels)).ToArray());
            var before = File.ReadAllBytes(QiitaImageArchive.PathFor(document, true));
            using var importer = new DocumentImageImporter(remoteHandler: new Handler(_ => Image()));
            var rejected = false;
            try { importer.ImportAsync(document, true, sources.Append(Source)).GetAwaiter().GetResult(); }
            catch (InvalidDataException) { rejected = true; }
            Assert(rejected && before.SequenceEqual(File.ReadAllBytes(QiitaImageArchive.PathFor(document, true))));
            Assert(!Directory.EnumerateFiles(folder, "*.zip.*.tmp").Any());
        });
        check("Reused image bytes count toward the total limit without replacing the previous archive", () => {
            var document = Path.Combine(folder, "reuse-byte-limit.md");
            var bytes = new byte[RemoteImageLoader.MaxBytes];
            var sources = Enumerable.Range(0, 8).Select(i => $"https://images.example.com/large-{i}.png").ToArray();
            Snapshot(document, false, "", sources.Select(s => (s, s, true, bytes)).ToArray());
            var archive = QiitaImageArchive.PathFor(document);
            var before = QiitaImageArchive.Hash(File.ReadAllBytes(archive));
            using var importer = new DocumentImageImporter(remoteHandler: new Handler(r => r.RequestUri!.AbsoluteUri == Source ? Image() : new(HttpStatusCode.NotFound)));
            var rejected = false;
            try { importer.ImportAsync(document, false, sources.Append(Source)).GetAwaiter().GetResult(); }
            catch (InvalidDataException) { rejected = true; }
            Assert(rejected && before == QiitaImageArchive.Hash(File.ReadAllBytes(archive)));
            Assert(!Directory.EnumerateFiles(folder, "*.zip.*.tmp").Any());
        });
        check("Optional GitHub URL resolves missing repository paths alongside unrelated remote images", () => {
            const string article = "https://github.com/owner/repo/blob/main/docs/readme.md";
            const string repositoryImage = "https://raw.githubusercontent.com/owner/repo/main/images/repository.png";
            var requests = new List<string>();
            using var importer = new DocumentImageImporter(remoteHandler: new Handler(r => { requests.Add(r.RequestUri!.AbsoluteUri); return Image(); }),
                githubHandler: new Handler(r => { requests.Add(r.RequestUri!.AbsoluteUri); return Image(); }));
            var result = importer.ImportAsync(Path.Combine(folder, "mixed-github.md"), true, [Source, "../images/repository.png"], article).GetAwaiter().GetResult();
            Assert(result.Manifest?.Images.Length == 2 && result.Failures.Length == 0);
            Assert(requests.SequenceEqual([Source, repositoryImage]));
            Assert(result.Manifest!.Images[0].Direct && !result.Manifest.Images[1].Direct);
        });
        check("Optional Qiita URL prefers the published 1x CDN and still saves unmatched originals", () => {
            const string article = "https://qiita.com/example/items/0123456789abcdef0123";
            var cdn = "https://qiita-user-contents.imgix.net/" + Uri.EscapeDataString(Source) + "?w=1400&s=signed";
            var requests = new List<string>();
            using var importer = new DocumentImageImporter(remoteHandler: new Handler(r => { requests.Add(r.RequestUri!.AbsoluteUri); return Image(); }),
                qiitaHandler: new Handler(r => {
                    requests.Add(r.RequestUri!.AbsoluteUri);
                    return r.RequestUri.Host == "qiita.com" ? new(HttpStatusCode.OK) { Content = new StringContent($"<img src='{WebUtility.HtmlEncode(cdn)}' srcset='{WebUtility.HtmlEncode(cdn)} 1x'>", System.Text.Encoding.UTF8, "text/html") } : Image();
                }));
            var result = importer.ImportAsync(Path.Combine(folder, "mixed-qiita.md"), false, [Source, "http://other.example.com/unmatched.png"], article).GetAwaiter().GetResult();
            Assert(result.Manifest?.Images.Length == 2 && result.Failures.Length == 0);
            Assert(requests.SequenceEqual([article, cdn, "http://other.example.com/unmatched.png"]));
            Assert(!result.Manifest!.Images[0].Direct && result.Manifest.Images[1].Direct);
        });
        check("An optional Qiita article without matching CDN images still saves authored sources", () => {
            using var importer = new DocumentImageImporter(remoteHandler: new Handler(_ => Image()),
                qiitaHandler: new Handler(_ => new(HttpStatusCode.OK) { Content = new StringContent("<p>No matching images</p>", System.Text.Encoding.UTF8, "text/html") }));
            var result = importer.ImportAsync(Path.Combine(folder, "qiita-no-match.md"), false, [Source],
                "https://qiita.com/example/items/0123456789abcdef0123").GetAwaiter().GetResult();
            Assert(result.Manifest?.Images.Length == 1 && result.Manifest.Images[0].Direct && result.Failures.Length == 0);
        });
        check("Direct archive records cannot substitute another URL or opt version 1 into direct mode", () => {
            foreach (var version in new[] { 1, 2 })
            {
                var document = Path.Combine(folder, "bad-direct-" + version + ".md");
                var hash = QiitaImageArchive.Hash(Pixels);
                using (var zip = ZipFile.Open(QiitaImageArchive.PathFor(document), ZipArchiveMode.Create))
                {
                    using (var image = zip.CreateEntry("images/" + hash).Open()) image.Write(Pixels);
                    using var info = zip.CreateEntry("manifest.json").Open();
                    JsonSerializer.Serialize(info, new QiitaImageManifest(version, "", DateTimeOffset.UtcNow,
                        [new(Source, version == 1 ? Source : "https://evil.example.com/image.png", hash, "image/png", Pixels.Length, true)]), new JsonSerializerOptions(JsonSerializerDefaults.Web));
                }
                var rejected = false;
                try { QiitaImageArchive.Load(document); }
                catch (Exception error) when (error is InvalidDataException or ArgumentException) { rejected = true; }
                Assert(rejected);
            }
        });
    }
}
