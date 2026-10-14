using System.IO.Compression;
using System.Net;
using System.Text;
using Mdv.Core;

static class QiitaCardTests
{
    private const string Url = "https://example.com/article";
    private static readonly byte[] Pixels = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=");
    private static void Assert(bool ok) { if (!ok) throw new Exception("Qiita card assertion failed."); }
    private static void Throws<T>(Action action) where T : Exception { try { action(); } catch (T) { return; } throw new Exception("Expected " + typeof(T).Name); }
    private static HttpResponseMessage Response(string type, byte[] bytes)
    {
        var r = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) }; r.Content.Headers.ContentType = new(type); return r;
    }
    private static HttpResponseMessage Metadata(bool image = true) => Response("application/json", Encoding.UTF8.GetBytes("{\"title\":\"<b>Saved title</b>\",\"url\":\"https://example.com/page\",\"image\":" + (image ? "\"https://example.com/thumb.png\"" : "null") + "}"));
    internal static void Run(Action<string, Action> check, string folder)
    {
        var document = Path.Combine(folder, "cards.md"); File.WriteAllText(document, Url);
        check("Qiita cards are opt-in and persist their setting", () => {
            Assert(!new UserSettings().UseSavedQiitaCards);
            var settings = new UserSettings { UseSavedQiitaCards = true }; var path = Path.Combine(folder, "cards.ini"); settings.Save(path); Assert(UserSettings.Load(path).UseSavedQiitaCards);
        });
        check("Qiita card import fetches metadata once, verifies thumbnails and survives relocation offline", () => {
            var calls = 0;
            using var importer = new QiitaCardImporter(new ImageTestHandler(r => { Assert(r.RequestUri!.Host == "qiita.com" && r.RequestUri.AbsolutePath == "/api/ogp"); calls++; return Metadata(); }), new ImageTestHandler(_ => Response("image/png", Pixels)));
            var manifest = importer.ImportAsync(document, [Url, Url]).GetAwaiter().GetResult();
            Assert(calls == 1 && manifest.Cards.Length == 1 && manifest.Cards[0].Origin == "https://example.com");
            var moved = Path.Combine(folder, "moved cards.md"); File.Copy(QiitaCardArchive.PathFor(document), QiitaCardArchive.PathFor(moved));
            var loaded = QiitaCardArchive.Load(moved)!; Assert(loaded.Cards[0].Title == "<b>Saved title</b>");
            Assert(QiitaCardArchive.Read(moved, loaded.Cards[0].Image!).Bytes.SequenceEqual(Pixels));
        });
        check("Failed or cancelled card refresh preserves the previous snapshot", () => {
            var before = File.ReadAllBytes(QiitaCardArchive.PathFor(document));
            using var importer = new QiitaCardImporter(new ImageTestHandler(_ => new(HttpStatusCode.ServiceUnavailable)));
            Throws<HttpRequestException>(() => importer.ImportAsync(document, [Url]).GetAwaiter().GetResult());
            Assert(before.SequenceEqual(File.ReadAllBytes(QiitaCardArchive.PathFor(document))));
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            Throws<OperationCanceledException>(() => importer.ImportAsync(document, [Url], cancelled.Token).GetAwaiter().GetResult());
            Assert(before.SequenceEqual(File.ReadAllBytes(QiitaCardArchive.PathFor(document))));
            Assert(Directory.GetFiles(folder, "cards.md.mdv-qiita-cards.zip.*.tmp").Length == 0);
        });
        check("Card thumbnail failure does not erase saved data", () => {
            var before = File.ReadAllBytes(QiitaCardArchive.PathFor(document));
            using var importer = new QiitaCardImporter(new ImageTestHandler(_ => Metadata()), new ImageTestHandler(_ => new(HttpStatusCode.NotFound)));
            Throws<HttpRequestException>(() => importer.ImportAsync(document, [Url]).GetAwaiter().GetResult());
            Assert(before.SequenceEqual(File.ReadAllBytes(QiitaCardArchive.PathFor(document))));
        });
        check("Cards without thumbnails remain usable and imports reject non-web sources", () => {
            using var importer = new QiitaCardImporter(new ImageTestHandler(_ => Metadata(false)));
            var result = importer.ImportAsync(document, [Url]).GetAwaiter().GetResult(); Assert(result.Cards[0].Image is null);
            foreach (var url in new[] { "file:///secret", "javascript:alert(1)", "https://document.mdv.invalid/image/private", "https://user@example.com/" })
                Throws<InvalidDataException>(() => importer.ImportAsync(document, [url]).GetAwaiter().GetResult());
        });
        check("Card archive rejects malformed metadata and changed image bytes", () => {
            using var importer = new QiitaCardImporter(new ImageTestHandler(_ => Metadata()), new ImageTestHandler(_ => Response("image/png", Pixels)));
            var manifest = importer.ImportAsync(document, [Url]).GetAwaiter().GetResult(); var image = manifest.Cards[0].Image!;
            using (var zip = ZipFile.Open(QiitaCardArchive.PathFor(document), ZipArchiveMode.Update)) { zip.GetEntry("images/" + image.Hash)!.Delete(); using var stream = zip.CreateEntry("images/" + image.Hash).Open(); stream.Write(new byte[image.Bytes]); }
            Throws<InvalidDataException>(() => QiitaCardArchive.Read(document, image));
            using (var zip = ZipFile.Open(QiitaCardArchive.PathFor(document), ZipArchiveMode.Update)) { zip.GetEntry("manifest.json")!.Delete(); using var writer = new StreamWriter(zip.CreateEntry("manifest.json").Open()); writer.Write("{\"version\":1,\"cards\":null}"); }
            Throws<InvalidDataException>(() => QiitaCardArchive.Load(document));
        });
    }
}
