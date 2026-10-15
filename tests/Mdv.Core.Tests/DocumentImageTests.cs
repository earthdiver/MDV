using System.IO.Compression;
using System.Net;
using System.Text.Json;
using Mdv.Core;

static class DocumentImageTests
{
    private const string Source = "https://images.example.com/original.png?size=large&token=abc";
    private static readonly byte[] Pixels = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=");
    private static void Assert(bool ok) { if (!ok) throw new Exception("Document image assertion failed."); }
    private static HttpResponseMessage Image() => new(HttpStatusCode.OK) { Content = new ByteArrayContent(Pixels) { Headers = { ContentType = new("image/png") } } };
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
        }
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
