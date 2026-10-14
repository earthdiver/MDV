using System.Net;
using Mdv.Core;

static class GithubImageTests
{
    const string Document = "https://github.com/owner/repo/blob/main/docs/readme.md";
    const string Root = "https://raw.githubusercontent.com/owner/repo/main/";
    static void Assert(bool value) { if (!value) throw new Exception("GitHub image assertion failed"); }
    static void Throws<T>(Action action) where T : Exception { try { action(); } catch (T) { return; } throw new Exception("Expected " + typeof(T).Name); }
    internal static void Run(Action<string, Action> check, string folder)
    {
        check("GitHub relative images resolve against the document and repository root", () => {
            Assert(GithubImageImporter.DocumentUri(Document + "?plain=1#x").AbsoluteUri == Root + "docs/readme.md");
            foreach (var (source, expected) in new[] { ("image.png", "docs/image.png"), ("../images/a.png", "images/a.png"), ("/images/a.png", "images/a.png"), ("./a%20b.png#x", "docs/a%20b.png") })
                Assert(GithubImageImporter.ResolveImage(Document, source)?.AbsoluteUri == Root + expected);
            foreach (var source in new[] { "../../outside.png", "//evil.test/image.png", "https://evil.test/i.png", "data:image/png;base64,AA==", "file:///tmp/image.png", "a\\b.png" })
                Assert(GithubImageImporter.ResolveImage(Document, source) is null);
            Throws<ArgumentException>(() => GithubImageImporter.DocumentUri("https://github.com.evil.test/owner/repo/blob/main/a.md"));
        });
        var document = Path.Combine(folder, "github.md");
        File.WriteAllText(document, "![image](../images/a.png)");
        var bytes = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=");
        check("GitHub snapshots preserve paths, move offline, and persist opt-in", () => {
            var requests = new List<string>();
            using var importer = new GithubImageImporter(new Handler(r => {
                requests.Add(r.RequestUri!.AbsoluteUri);
                var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) };
                response.Content.Headers.ContentType = new("image/png"); return response;
            }));
            var manifest = importer.ImportAsync(document, Document, ["../images/a.png", "../images/a.png"]).GetAwaiter().GetResult();
            Assert(requests.SequenceEqual([Root + "images/a.png"]));
            Assert(manifest.Images[0].OriginalUrl == "../images/a.png");
            Assert(File.ReadAllText(document) == "![image](../images/a.png)");
            var moved = Path.Combine(folder, "github-moved.md");
            File.Copy(QiitaImageArchive.PathFor(document, true), QiitaImageArchive.PathFor(moved, true));
            var loaded = QiitaImageArchive.Load(moved, true)!;
            Assert(QiitaImageArchive.Read(moved, loaded.Images[0], true).Bytes.SequenceEqual(bytes));
            Assert(QiitaImageArchive.Load(document) is null);
            var settings = new UserSettings { UseSavedGithubImages = true };
            var path = Path.Combine(folder, "github.ini"); settings.Save(path);
            Assert(UserSettings.Load(path).UseSavedGithubImages && !UserSettings.Load(path).UseSavedQiitaImages);
        });
        check("GitHub failed refresh and forbidden redirects preserve existing snapshots", () => {
            var before = File.ReadAllBytes(QiitaImageArchive.PathFor(document, true));
            var requests = 0;
            using var importer = new GithubImageImporter(new Handler(_ => {
                requests++; var response = new HttpResponseMessage(HttpStatusCode.Found);
                response.Headers.Location = new("https://evil.test/image.png"); return response;
            }));
            Throws<HttpRequestException>(() => importer.ImportAsync(document, Document, ["a.png"]).GetAwaiter().GetResult());
            Assert(requests == 1);
            Assert(before.SequenceEqual(File.ReadAllBytes(QiitaImageArchive.PathFor(document, true))));
            Assert(!Directory.EnumerateFiles(folder, "*.zip.*.tmp").Any());
        });
    }
    sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => Task.FromResult(reply(request));
    }
}
