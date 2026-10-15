using System.IO.Compression;
using System.Net;
using System.Text;
using Mdv.Core;

static class QiitaImageTests
{
    private const string Article = "https://qiita.com/example/items/0123456789abcdef0123";
    private const string Original = "https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/1/image.png";
    private static readonly string Service = "https://qiita-user-contents.imgix.net/" + Uri.EscapeDataString(Original) + "?w=1400&q=75&s=public-signature";
    private static readonly byte[] Pixels = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=");
    private static void Assert(bool ok) { if (!ok) throw new Exception("Qiita image assertion failed."); }
    private static void Throws<T>(Action action) where T : Exception { try { action(); } catch (T) { return; } throw new Exception("Expected " + typeof(T).Name); }
    private static HttpResponseMessage Response(string type, byte[] bytes)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) };
        response.Content.Headers.ContentType = new(type); return response;
    }
    private static HttpResponseMessage Html() => Response("text/html", Encoding.UTF8.GetBytes($"<img src=\"{WebUtility.HtmlEncode(Service)}\"><img src=\"{Service}\">"));

    internal static void Run(Action<string, Action> check, string folder)
    {
        var document = Path.Combine(folder, "qiita 日本語.md"); File.WriteAllText(document, "![image](" + Original + ")");
        check("Qiita saved images are opt-in and survive INI persistence", () => {
            Assert(!new UserSettings().UseSavedQiitaImages);
            var settings = new UserSettings { UseSavedQiitaImages = true };
            var path = Path.Combine(folder, "qiita-images.ini"); settings.Save(path); Assert(UserSettings.Load(path).UseSavedQiitaImages);
        });
        check("Qiita import validates article origin and CDN source mapping", () => {
            Assert(QiitaImageImporter.ArticleUri(Article + "?utm_source=test#section").AbsoluteUri == Article);
            foreach (var url in new[] { "http://qiita.com/example/items/0123456789abcdef0123", Article.Replace("qiita.com", "qiita.com.evil.test"), Article.Replace("qiita.com", "user@qiita.com"), Article.Replace("qiita.com", "qiita.com:8443"), "https://qiita.com/" })
                Throws<ArgumentException>(() => QiitaImageImporter.ArticleUri(url));
            Assert(QiitaImageImporter.OriginalUrl(Service) == Original);
            Assert(QiitaImageImporter.OriginalUrl(Service.Replace("qiita-user-contents.imgix.net", "evil.test")) is null);
            var found = QiitaImageImporter.FindImages($"<img alt='>' src='{WebUtility.HtmlEncode(Service)}'><img data-src='{Service}'><img src='{Service.Replace("image.png", "other.png")}'>", [Original]);
            Assert(found.Count == 1 && found[Original] == Service);
            Assert(QiitaImageImporter.FindImages($"<img src='{Service}'>", ["https://example.com/other.png"]).Count == 0);
        });
        check("Qiita CDN lookup fetches only the article and preserves signed URLs", () => {
            var requests = new List<string>();
            using var importer = new QiitaImageImporter(new ImageTestHandler(r => {
                requests.Add(r.RequestUri!.AbsoluteUri); return Html();
            }));
            var images = importer.ResolveCdnImagesAsync(Article, [Original]).GetAwaiter().GetResult();
            Assert(images[Original] == Service && requests.SequenceEqual(new[] { Article }));
            Throws<InvalidDataException>(() => importer.ResolveCdnImagesAsync(Article, ["https://example.com/other.png"]).GetAwaiter().GetResult());
        });
        check("Qiita import saves matching images once and reads them offline after moving", () => {
            var requests = new List<string>();
            using var importer = new QiitaImageImporter(new ImageTestHandler(r => {
                requests.Add(r.RequestUri!.AbsoluteUri);
                return r.RequestUri.Host == "qiita.com" ? Html() : Response("image/png", Pixels);
            }));
            var manifest = importer.ImportAsync(document, Article, [Original]).GetAwaiter().GetResult();
            Assert(manifest.Images.Length == 1 && requests.Count == 2);
            Assert(File.ReadAllText(document) == "![image](" + Original + ")");
            var moved = Path.Combine(folder, "moved 日本語.md");
            File.Copy(QiitaImageArchive.PathFor(document), QiitaImageArchive.PathFor(moved));
            var loaded = QiitaImageArchive.Load(moved)!;
            Assert(QiitaImageArchive.Read(moved, loaded.Images[0]).Bytes.SequenceEqual(Pixels));
            Assert(requests.Count == 2);
        });
        check("Qiita import selects the displayed signed 1x variant instead of the full-size src fallback", () => {
            var fallback = Service.Replace("?w=1400&", "?");
            var found = QiitaImageImporter.FindImages($"<img src='{fallback}' srcset='{WebUtility.HtmlEncode(Service)} 1x'>", [Original]);
            Assert(found[Original] == Service);
            var unchanged = QiitaImageImporter.FindImages($"<img src='{fallback}' srcset='https://example.com/untrusted.png 1x'>", [Original]);
            Assert(unchanged[Original] == fallback);
        });
        check("Failed Qiita refresh preserves the existing archive and removes temporary files", () => {
            var before = File.ReadAllBytes(QiitaImageArchive.PathFor(document));
            using var importer = new QiitaImageImporter(new ImageTestHandler(r => r.RequestUri!.Host == "qiita.com" ? Html() : Response("text/html", [1])));
            Throws<InvalidDataException>(() => importer.ImportAsync(document, Article, [Original]).GetAwaiter().GetResult());
            Assert(before.SequenceEqual(File.ReadAllBytes(QiitaImageArchive.PathFor(document))));
            Assert(!Directory.EnumerateFiles(folder, "*.zip.*.tmp").Any());
        });
        check("Cancelled Qiita download preserves previous saved images", () => {
            var before = File.ReadAllBytes(QiitaImageArchive.PathFor(document));
            using var cancellation = new CancellationTokenSource();
            using var importer = new QiitaImageImporter(new ImageTestHandler(r => {
                if (r.RequestUri!.Host == "qiita.com") return Html();
                cancellation.Cancel(); return Response("image/png", Pixels);
            }));
            Throws<OperationCanceledException>(() => importer.ImportAsync(document, Article, [Original], cancellation.Token).GetAwaiter().GetResult());
            Assert(before.SequenceEqual(File.ReadAllBytes(QiitaImageArchive.PathFor(document))));
            Assert(!Directory.EnumerateFiles(folder, "*.zip.*.tmp").Any());
        });
        check("Qiita import rejects redirects outside the article/CDN and oversized image responses", () => {
            var requests = 0;
            using (var importer = new QiitaImageImporter(new ImageTestHandler(_ => { requests++; var response = new HttpResponseMessage(HttpStatusCode.Found); response.Headers.Location = new("https://example.com/private"); return response; })))
                Throws<ArgumentException>(() => importer.ImportAsync(document, Article, [Original]).GetAwaiter().GetResult());
            Assert(requests == 1);
            using var large = new QiitaImageImporter(new ImageTestHandler(r => {
                if (r.RequestUri!.Host == "qiita.com") return Html();
                var response = Response("image/png", Pixels); response.Content.Headers.ContentLength = RemoteImageLoader.MaxBytes + 1; return response;
            }));
            Throws<InvalidDataException>(() => large.ImportAsync(document, Article, [Original]).GetAwaiter().GetResult());
        });
        check("Unmatched article cannot replace a document's Qiita image archive", () => {
            var before = File.ReadAllBytes(QiitaImageArchive.PathFor(document));
            using var importer = new QiitaImageImporter(new ImageTestHandler(_ => Html()));
            Throws<InvalidDataException>(() => importer.ImportAsync(document, Article, ["https://example.com/unrelated.png"]).GetAwaiter().GetResult());
            Assert(before.SequenceEqual(File.ReadAllBytes(QiitaImageArchive.PathFor(document))));
        });
        check("Corrupted saved image bytes fail checksum validation", () => {
            var bad = Path.Combine(folder, "bad-image.md"); File.Copy(QiitaImageArchive.PathFor(document), QiitaImageArchive.PathFor(bad));
            var manifest = QiitaImageArchive.Load(bad)!;
            using (var zip = ZipFile.Open(QiitaImageArchive.PathFor(bad), ZipArchiveMode.Update))
            {
                var name = "images/" + manifest.Images[0].Hash; zip.GetEntry(name)!.Delete();
                using var stream = zip.CreateEntry(name).Open(); stream.Write(new byte[Pixels.Length]);
            }
            Throws<InvalidDataException>(() => QiitaImageArchive.Read(bad, manifest.Images[0]));
        });
        check("Qiita image archive rejects null image records", () => {
            var bad = Path.Combine(folder, "bad-manifest.md");
            using (var zip = ZipFile.Open(QiitaImageArchive.PathFor(bad), ZipArchiveMode.Create))
            using (var stream = new StreamWriter(zip.CreateEntry("manifest.json").Open()))
                stream.Write("{\"version\":1,\"articleUrl\":\"" + Article + "\",\"images\":[null]}");
            Throws<InvalidDataException>(() => QiitaImageArchive.Load(bad));
        });
        if (!OperatingSystem.IsWindows()) check("Qiita image archives cannot redirect reads through a symlink", () => {
            var linked = Path.Combine(folder, "linked-archive.md");
            File.CreateSymbolicLink(QiitaImageArchive.PathFor(linked), QiitaImageArchive.PathFor(document));
            Throws<InvalidDataException>(() => QiitaImageArchive.Load(linked));
            Throws<InvalidDataException>(() => QiitaImageArchive.Read(linked, QiitaImageArchive.Load(document)!.Images[0]));
        });
    }
}
