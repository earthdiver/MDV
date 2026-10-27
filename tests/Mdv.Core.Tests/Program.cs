using System.Text;
using System.Globalization;
using System.IO.Compression;
using System.Formats.Tar;
using System.Security.Cryptography;
using System.Net;
using System.Net.Http.Headers;
using Mdv.Core;

var failures = new List<string>();
var checks = 0;
void Check(string name, Action body)
{
    checks++;
    try { body(); Console.WriteLine("PASS " + name); }
    catch (Exception e) { failures.Add(name + ": " + e.Message); Console.WriteLine("FAIL " + name + ": " + e.Message); }
}
void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception($"Expected {expected}, got {actual}"); }
void Throws<T>(Action body) where T : Exception
{
    try { body(); } catch (T) { return; }
    throw new Exception($"Expected {typeof(T).Name}");
}

Check("UI language follows Japanese display cultures and falls back to English", () => {
    foreach (var culture in new[] { "ja", "ja-JP", "en-US", "fr-FR", "zh-CN", "" })
    {
        var system = CultureInfo.GetCultureInfo(culture);
        Equal(culture.StartsWith("ja") ? "ja" : "en", UiLanguage.Resolve("auto", system));
        Equal("ja", UiLanguage.Resolve("ja", system));
        Equal("en", UiLanguage.Resolve("en", system));
        Equal(UiLanguage.Resolve("auto", system), UiLanguage.Resolve("invalid", system));
    }
});
Check("Empty tab labels refresh when the UI language changes", () => {
    var previous = UiLanguage.Current;
    try {
        var tab = new DocumentTab("github", 1);
        var changed = new List<string>();
        tab.PropertyChanged += (_, e) => changed.Add(e.PropertyName!);
        UiLanguage.Set("ja"); Equal("新しいタブ", tab.Title);
        UiLanguage.Set("en"); tab.RefreshLanguage(); Equal("New tab", tab.Title);
        Equal(true, changed.Contains("Title") && changed.Contains("FilePath"));
    } finally { UiLanguage.Set(previous); }
});
Check("Qiita highlighting skips plain prose and non-highlighted fences but retains code", () => {
    Equal(false, OriginalEngine.MayNeedQiitaHighlighting(new string('`', 100_000)));
    foreach (var markdown in new[] { "# Plain\n\nText", "```\nhello\n```", "```math\nx+y\n```", "~~~mermaid\nflowchart LR\n~~~", "```text\nhello\n```" })
        Equal(false, OriginalEngine.MayNeedQiitaHighlighting(markdown));
    foreach (var markdown in new[] { "```PowerShell:file.ps1\n$x=1\n```", "> ~~~ ruby\nputs 1\n~~~", "    ```js\nx()\n```", "<pre><code class=\"language-ruby\">x</code></pre>", "```unknown\nx\n```" })
        Equal(true, OriginalEngine.MayNeedQiitaHighlighting(markdown));
});
Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
Check("Renderer reading state survives native JSON serialization", () => {
    var options = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
    var view = System.Text.Json.JsonSerializer.Deserialize<ViewPosition>(
        """{"detailsState":{"B":true,"A":false},"elementScroll":{"code":{"x":500,"y":12}},"openDetails":[1]}""", options)!;
    var restored = System.Text.Json.JsonSerializer.Deserialize<ViewPosition>(System.Text.Json.JsonSerializer.Serialize(view, options), options)!;
    Equal(true, restored.DetailsState!["B"]); Equal(false, restored.DetailsState["A"]);
    Equal(500d, restored.ElementScroll!["code"].X); Equal(12d, restored.ElementScroll["code"].Y);
    Equal(1, restored.OpenDetails![0]);
});
foreach (var encoding in new Encoding[] { new UTF8Encoding(true, true), new UnicodeEncoding(false, true, true), new UnicodeEncoding(true, true, true), new UTF32Encoding(false, true, true), new UTF32Encoding(true, true, true) })
{
    Check("Decode " + encoding.WebName + " BOM " + Convert.ToHexString(encoding.GetPreamble()), () =>
        Equal("日本語 🌸", DocumentReader.Decode([.. encoding.GetPreamble(), .. encoding.GetBytes("日本語 🌸")]).Text));
}
Check("UTF-8 without BOM", () => Equal(("日本語", "UTF-8"), DocumentReader.Decode(Encoding.UTF8.GetBytes("日本語"))));
Check("Shift_JIS fallback", () => Equal(("日本語です", "Shift_JIS (CP932)"), DocumentReader.Decode(Encoding.GetEncoding(932).GetBytes("日本語です"))));
Check("Corrupt BOM-encoded input is not silently replaced", () => Throws<DecoderFallbackException>(() => DocumentReader.Decode([0xEF, 0xBB, 0xBF, 0xFF])));
Check("Empty document", () => Equal(("", "UTF-8"), DocumentReader.Decode([])));

HttpResponseMessage ImageResponse(byte[] bytes) {
    var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) };
    response.Content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
    return response;
}
Check("HTTP image loader preserves the original URL and image bytes", () => {
    var uri = new Uri("http://images.test/picture.png?size=2&name=a%20b");
    using var loader = new RemoteImageLoader(new ImageTestHandler(request => {
        Equal(uri, request.RequestUri); Equal(null, request.Headers.Referrer); Equal(null, request.Headers.Authorization);
        return ImageResponse([1, 2, 3]);
    }));
    var result = loader.LoadAsync(uri).GetAwaiter().GetResult();
    Equal("image/png", result.ContentType); Equal("010203", Convert.ToHexString(result.Bytes));
});
Check("HTTP image loader follows relative and HTTPS redirects", () => {
    var visited = new List<string>();
    using var loader = new RemoteImageLoader(new ImageTestHandler(request => {
        visited.Add(request.RequestUri!.AbsoluteUri);
        if (visited.Count == 3) return ImageResponse([1]);
        var response = new HttpResponseMessage(HttpStatusCode.Found);
        response.Headers.Location = new Uri(visited.Count == 1 ? "/next" : "https://images.test/final.png", UriKind.RelativeOrAbsolute);
        return response;
    }));
    loader.LoadAsync(new Uri("http://images.test/start")).GetAwaiter().GetResult();
    Equal("http://images.test/start|http://images.test/next|https://images.test/final.png", string.Join('|', visited));
});
foreach (var forbidden in new[] { "file:///secret.png", "https://app.mdv.invalid/secret.png", "http://user:password@images.test/image.png" })
    Check("HTTP image loader rejects forbidden redirect: " + forbidden, () => {
        var calls = 0;
        using var loader = new RemoteImageLoader(new ImageTestHandler(_ => {
            calls++; var response = new HttpResponseMessage(HttpStatusCode.Found);
            response.Headers.Location = new Uri(forbidden); return response;
        }));
        Throws<HttpRequestException>(() => loader.LoadAsync(new Uri("http://images.test/start")).GetAwaiter().GetResult());
        Equal(1, calls);
    });
Check("HTTP image loader bounds redirect loops", () => {
    var calls = 0;
    using var loader = new RemoteImageLoader(new ImageTestHandler(_ => {
        calls++; var response = new HttpResponseMessage(HttpStatusCode.TemporaryRedirect);
        response.Headers.Location = new Uri("/loop", UriKind.Relative); return response;
    }));
    Throws<HttpRequestException>(() => loader.LoadAsync(new Uri("http://images.test/loop")).GetAwaiter().GetResult());
    Equal(6, calls);
});
Check("HTTP image loader rejects oversized declared content", () => {
    using var loader = new RemoteImageLoader(new ImageTestHandler(_ => {
        var response = ImageResponse([1]); response.Content.Headers.ContentLength = RemoteImageLoader.MaxBytes + 1L; return response;
    }));
    Throws<HttpRequestException>(() => loader.LoadAsync(new Uri("http://images.test/large.png")).GetAwaiter().GetResult());
});
Check("HTTP image loader bounds streamed content without a declared length", () => {
    using var loader = new RemoteImageLoader(new ImageTestHandler(_ => {
        var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new ImageTestStream(RemoteImageLoader.MaxBytes + 1L)) };
        response.Content.Headers.ContentType = new MediaTypeHeaderValue("image/png"); return response;
    }));
    Throws<HttpRequestException>(() => loader.LoadAsync(new Uri("http://images.test/large.png")).GetAwaiter().GetResult());
});
Check("HTTP image loader rejects non-images and honors cancellation", () => {
    using var loader = new RemoteImageLoader(new ImageTestHandler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<html>not an image</html>") }));
    Throws<HttpRequestException>(() => loader.LoadAsync(new Uri("http://images.test/page")).GetAwaiter().GetResult());
    using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
    Throws<OperationCanceledException>(() => loader.LoadAsync(new Uri("http://images.test/image.png"), cancellation.Token).GetAwaiter().GetResult());
});

var temp = Path.Combine(Path.GetTempPath(), "mdv-tests-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(temp);
try
{
    Check("Image selections are isolated by document and syntax mode throughout navigation", () => {
        var images = new DocumentImagePreferences();
        var first = Path.Combine(temp, "first.md");
        var second = Path.Combine(temp, "second.md");
        Equal(ImageSourceSelection.Off, images.Get(first, "github"));
        images.Set(first, "github", ImageSourceSelection.Saved);
        images.Set(first, "qiita", ImageSourceSelection.Cdn);
        images.Set(second, "github", ImageSourceSelection.Remote);
        images.Set(second, "qiita", ImageSourceSelection.Off);
        Equal(ImageSourceSelection.Saved, images.Get(first, "github"));
        Equal(ImageSourceSelection.Cdn, images.Get(first, "qiita"));
        Equal(ImageSourceSelection.Remote, images.Get(second, "github"));
        Equal(ImageSourceSelection.Off, images.Get(second, "qiita"));
        Equal(ImageSourceSelection.Saved, images.Get(Path.Combine(temp, ".", "first.md"), "github", ImageSourceSelection.Remote));
        Equal(ImageSourceSelection.Off, images.Get(Path.Combine(temp, "other", "first.md"), "github"));
        Throws<ArgumentException>(() => images.Set(first, "github", ImageSourceSelection.Cdn));
    });
    DocumentImageTests.Run(Check, temp);
    QiitaImageTests.Run(Check, temp);
    GithubImageTests.Run(Check, temp);
    QiitaCardTests.Run(Check, temp);
    var root = Path.Combine(temp, "docs");
    Directory.CreateDirectory(Path.Combine(root, "images"));
    var image = Path.Combine(root, "images", "日本 語.png");
    File.WriteAllBytes(image, [0]);
    File.WriteAllText(Path.Combine(root, "readme.md"), "# タイトル\r\n本文\r次");
    File.WriteAllBytes(Path.Combine(temp, "outside.png"), [0]);
    Check("Document read and CRLF normalization", () => {
        var document = DocumentReader.ReadAsync(Path.Combine(root, "readme.md")).GetAwaiter().GetResult();
        Equal("# タイトル\n本文\n次", document.Text); Equal(3, document.LineCount);
    });
    Check("URL-encoded local image", () => Equal(image, LocalAssets.ResolvePath(root, "images/%E6%97%A5%E6%9C%AC%20%E8%AA%9E.png")));
    foreach (var bad in new[] { "../outside.png", "%2e%2e/outside.png", "images/../../outside.png", "/outside.png", "C:/outside.png", "\\\\server\\share\\file.png", "images/..\\..\\outside.png", "readme.md", "readme.md:stream", "missing.png" })
        Check("Reject unsafe or non-image path: " + bad, () => Equal<string?>(null, LocalAssets.ResolvePath(root, bad)));
    Check("Local Markdown navigation", () => Equal(Path.Combine(root, "readme.md"), LocalAssets.ResolvePath(root, "readme.md#title", imagesOnly: false)));
    if (!OperatingSystem.IsWindows())
    {
        Directory.CreateSymbolicLink(Path.Combine(root, "escape"), temp);
        Check("Reject symlinks escaping document folder", () => Equal<string?>(null, LocalAssets.ResolvePath(root, "escape/outside.png")));
    }
    Check("Bound file size before allocation", () => {
        var path = Path.Combine(root, "large.md");
        using (var stream = File.Create(path)) stream.SetLength(DocumentReader.MaxBytes + 1L);
        Throws<IOException>(() => DocumentReader.ReadAsync(path).GetAwaiter().GetResult());
    });
    Check("Bound decoded character count", () => {
        var path = Path.Combine(root, "long.md"); File.WriteAllText(path, new string('x', DocumentReader.MaxCharacters + 1));
        Throws<IOException>(() => DocumentReader.ReadAsync(path).GetAwaiter().GetResult());
    });
    Check("Language preference survives INI reload and supports old or invalid settings", () => {
        var path = Path.Combine(temp, "language.ini");
        foreach (var language in new[] { "auto", "ja", "en" }) {
            new UserSettings { Language = language }.Save(path);
            Equal(language, UserSettings.Load(path).Language);
        }
        File.WriteAllText(path, "[Viewer]\nLanguage=EN\n");
        Equal("en", UserSettings.Load(path).Language);
        File.WriteAllText(path, "[Viewer]\nLanguage=invalid\n");
        Equal("auto", UserSettings.Load(path).Language);
        File.WriteAllText(path, "[Viewer]\nMode=qiita\n");
        Equal("auto", UserSettings.Load(path).Language);
        Equal("auto", UserSettings.Load(Path.Combine(temp, "no-language.ini")).Language);
    });
    Check("Missing INI uses defaults", () => Equal("github", UserSettings.Load(Path.Combine(temp, "none.ini")).Mode));
    Check("Corrupt preferences recover", () => {
        var path = Path.Combine(temp, "bad.ini"); File.WriteAllText(path, "{\n[Viewer]\nZoom=broken\nShowOutline=invalid\nMode=other");
        var settings = UserSettings.Load(path); Equal(1d, settings.Zoom); Equal(true, settings.ShowOutline); Equal("github", settings.Mode);
    });
    Check("Preferences round-trip and recent file deduplication", () => {
        var settings = new UserSettings { Mode = "qiita", Theme = "dark", Zoom = 1.5 }; settings.Remember("C:\\a.md"); settings.Remember("C:\\b.md"); settings.Remember("C:\\a.md");
        var path = Path.Combine(temp, "settings.ini"); settings.Save(path); var loaded = UserSettings.Load(path);
        Equal("qiita", loaded.Mode); Equal("dark", loaded.Theme); Equal(1.5, loaded.Zoom); Equal(2, loaded.RecentFiles.Count); Equal("C:\\a.md", loaded.RecentFiles[0]);
        Equal(true, File.ReadAllText(path).Contains("[Viewer]"));
    });
    Check("Engine settings respect the compiled edition", () => {
        Equal(BuildEdition.DefaultEngine, new UserSettings().Engine);
        foreach (var requested in new[] { "legacy", "original", "invalid" }) {
            var value = new UserSettings { Engine = requested };
            value.Normalize();
            Equal(BuildEdition.ResolveEngine(requested), value.Engine);
        }
        var path = Path.Combine(temp, "original.ini");
        new UserSettings { Engine = "original" }.Save(path);
        Equal(BuildEdition.ResolveEngine("original"), UserSettings.Load(path).Engine);
        foreach (var saved in new[] { "legacy", "original" }) {
            // Simulate an INI copied from another edition, without normalizing it first.
            File.WriteAllText(path, "[Viewer]\nEngine=" + saved);
            var expected = BuildEdition.Id switch { "custom" => "legacy", "upstream" => "original", _ => saved };
            Equal(expected, UserSettings.Load(path).Engine);
        }
    });
    Check("Invalid preferences are constrained", () => {
        var settings = new UserSettings { Engine = "bad", Mode = "other", Theme = "bad", Zoom = double.NaN }; settings.Normalize();
        Equal(BuildEdition.DefaultEngine, settings.Engine); Equal("github", settings.Mode); Equal("light", settings.Theme); Equal(1d, settings.Zoom);
    });
    Check("INI tolerates BOM, comments, spaces, sections and case", () => {
        var path = Path.Combine(temp, "comments.ini");
        File.WriteAllText(path, "; comment\n# comment\n [viewer] \n mode = QIITA\nTHEME=dark\nShowSource=1\nShowOutline=no\nAllowRemoteImages=YES\n[unknown]\nMode=github", new UTF8Encoding(true));
        var settings = UserSettings.Load(path);
        Equal("qiita", settings.Mode); Equal("dark", settings.Theme); Equal(true, settings.ShowSource); Equal(false, settings.ShowOutline); Equal(true, settings.AllowRemoteImages);
    });
    Check("INI preserves Japanese and special characters in file names", () => {
        var settings = new UserSettings(); settings.Remember("C:\\日本 語\\#draft;[x]=1.md"); settings.Remember("C:\\quoted\"name.md");
        var path = Path.Combine(temp, "paths.ini"); settings.Save(path);
        Equal(string.Join('|', settings.RecentFiles), string.Join('|', UserSettings.Load(path).RecentFiles));
    });
    Check("INI numbers are culture-independent", () => {
        var previous = CultureInfo.CurrentCulture;
        try {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-FR");
            var path = Path.Combine(temp, "culture.ini"); new UserSettings { Zoom = 1.25 }.Save(path);
            Equal(true, File.ReadAllText(path).Contains("Zoom=1.25")); Equal(1.25, UserSettings.Load(path).Zoom);
        } finally { CultureInfo.CurrentCulture = previous; }
    });
    Check("INI duplicate keys use the last value", () => {
        var path = Path.Combine(temp, "duplicate.ini"); File.WriteAllText(path, "[Viewer]\nMode=github\nmode=qiita\nZoom=99");
        var settings = UserSettings.Load(path); Equal("qiita", settings.Mode); Equal(2.5, settings.Zoom);
    });
    Check("INI rejects injected sections in file names without overwriting settings", () => {
        var path = Path.Combine(temp, "preserved.ini"); var settings = new UserSettings(); settings.Save(path);
        var original = File.ReadAllText(path); settings.RecentFiles.Add("evil\n[Viewer]\nMode=qiita");
        Throws<ArgumentException>(() => settings.Save(path)); Equal(original, File.ReadAllText(path));
    });
    Check("INI refuses unreasonable file sizes", () => {
        var path = Path.Combine(temp, "huge.ini"); File.WriteAllText(path, new string('x', 128 * 1024 + 1));
        Throws<IOException>(() => UserSettings.Load(path));
    });
    Check("Settings follow the EXE name and directory regardless of working directory", () => {
        var executable = Path.Combine(root, "Renamed Viewer.exe"); var previous = Environment.CurrentDirectory;
        try { Environment.CurrentDirectory = temp; Equal(Path.Combine(root, "Renamed Viewer.ini"), PortablePaths.SettingsForExecutable(executable)); }
        finally { Environment.CurrentDirectory = previous; }
    });
    Check("INI save leaves no temporary sidecars", () => {
        var path = Path.Combine(temp, "clean.ini"); new UserSettings().Save(path); new UserSettings { Mode = "qiita" }.Save(path);
        Equal(0, Directory.GetFiles(temp, "clean.ini.*.tmp").Length);
    });
    var firstDocument = Path.Combine(root, "first.md");
    var secondDocument = Path.Combine(root, "second.md");
    var thirdDocument = Path.Combine(root, "third.md");
    Check("History restores each document's latest reading position in both directions", () => {
        var history = new DocumentHistory(); Equal(false, history.CanGoBack); Equal(false, history.CanGoForward);
        history.Visit(firstDocument); history.SaveView(new ViewPosition(Y: 420, Anchor: "intro", Offset: 32));
        history.Visit(secondDocument); history.SaveView(new ViewPosition(Y: 960));
        Equal(firstDocument, history.Move(-1)!.FilePath); Equal(420d, history.Current!.View!.Y);
        history.SaveView(new ViewPosition(Y: 600));
        Equal(secondDocument, history.Move(1)!.FilePath); Equal(960d, history.Current!.View!.Y);
        Equal(600d, history.Move(-1)!.View!.Y);
    });
    Check("Failed history targets can be inspected without changing history", () => {
        var history = new DocumentHistory(); history.Visit(firstDocument); history.Visit(secondDocument);
        Equal(firstDocument, history.Peek(-1)!.FilePath); Equal(secondDocument, history.Current!.FilePath);
        Equal(true, history.CanGoBack); Equal(false, history.CanGoForward);
    });
    Check("Reloading the current file retains forward history", () => {
        var history = new DocumentHistory(); history.Visit(firstDocument); history.Visit(secondDocument); history.Move(-1);
        history.Visit(firstDocument); Equal(false, history.CanGoBack); Equal(true, history.CanGoForward);
        Equal(secondDocument, history.Peek(1)!.FilePath);
    });
    Check("A new visit after going back replaces the forward branch", () => {
        var history = new DocumentHistory(); history.Visit(firstDocument); history.Visit(secondDocument); history.Move(-1);
        history.Visit(thirdDocument); Equal(false, history.CanGoForward);
        Equal(firstDocument, history.Move(-1)!.FilePath); Equal(thirdDocument, history.Move(1)!.FilePath);
    });
    Check("Same-file fragment visits retain distinct reading positions", () => {
        var history = new DocumentHistory(); history.Visit(firstDocument); history.SaveView(new ViewPosition(Y: 140));
        history.Visit(firstDocument, forceNew: true); history.SaveView(new ViewPosition(Y: 1200));
        Equal(140d, history.Move(-1)!.View!.Y); Equal(1200d, history.Move(1)!.View!.Y);
        Equal<HistoryEntry?>(null, history.Move(1)); Equal(firstDocument, history.Current!.FilePath);
    });
    Check("History bounds its session memory and preserves the remaining order", () => {
        var history = new DocumentHistory(2); history.Visit(firstDocument); history.Visit(secondDocument); history.Visit(thirdDocument);
        Equal(secondDocument, history.Move(-1)!.FilePath); Equal(false, history.CanGoBack);
        Equal(thirdDocument, history.Move(1)!.FilePath); Throws<ArgumentOutOfRangeException>(() => history.Move(0));
    });
    Check("Tabs retain independent navigation, view, mode, zoom and search state", () => {
        var workspace = new DocumentWorkspace("github", 1);
        var first = workspace.Active;
        first.History.Visit(firstDocument); first.History.SaveView(new ViewPosition(Y: 300));
        first.History.Visit(secondDocument); first.History.SaveView(new ViewPosition(Y: 800));
        first.SetDocument(new(secondDocument, "# Second", "UTF-8"));
        first.SearchQuery = "Second"; first.ShowSearch = true;
        var second = workspace.Add(); second.Mode = "qiita"; second.Zoom = 1.4;
        second.History.Visit(thirdDocument); second.History.SaveView(new ViewPosition(Y: 1200));
        second.SetDocument(new(thirdDocument, "# Third", "UTF-8"));
        workspace.Select(first); first.History.Move(-1);
        Equal(300d, first.History.Current!.View!.Y); Equal(true, first.History.CanGoForward);
        Equal(1200d, second.History.Current!.View!.Y); Equal(false, second.History.CanGoBack);
        Equal("github", first.Mode); Equal(1d, first.Zoom); Equal("Second", first.SearchQuery); Equal(true, first.ShowSearch);
        workspace.Select(second); Equal("qiita", workspace.Active.Mode); Equal(1.4, workspace.Active.Zoom);
        Equal("", second.SearchQuery); Equal(false, second.ShowSearch);
    });
    Check("Duplicate lookup uses full paths and distinguishes equal file names", () => {
        var workspace = new DocumentWorkspace("github", 1);
        var first = workspace.Active; first.SetDocument(new(firstDocument, "one", "UTF-8"));
        var otherPath = Path.Combine(root, "subdirectory", "first.md");
        var second = workspace.Add(); second.SetDocument(new(otherPath, "two", "UTF-8"));
        Equal(first, workspace.Find(Path.Combine(root, ".", "first.md")));
        Equal(second, workspace.Find(otherPath.ToUpperInvariant()));
        Equal<DocumentTab?>(null, workspace.Find(thirdDocument));
    });
    Check("Closing an inactive tab preserves the selected document and history", () => {
        var workspace = new DocumentWorkspace("github", 1); var first = workspace.Active;
        var second = workspace.Add(); second.History.Visit(secondDocument); second.History.SaveView(new ViewPosition(Y: 640));
        Equal(true, workspace.Close(first)); Equal(second, workspace.Active); Equal(640d, second.History.Current!.View!.Y);
        Equal(false, workspace.Select(first)); Equal(false, workspace.Close(first)); Equal(1, workspace.Tabs.Count);
    });
    Check("Closing the active tab selects the right neighbor then the previous one", () => {
        var workspace = new DocumentWorkspace("github", 1); var first = workspace.Active;
        var second = workspace.Add(); var third = workspace.Add(); workspace.Select(second);
        workspace.Close(second); Equal(third, workspace.Active);
        workspace.Close(third); Equal(first, workspace.Active);
    });
    Check("Closing the last document leaves a blank tab with no old history or search", () => {
        var workspace = new DocumentWorkspace("qiita", 1.2); var closed = workspace.Active;
        closed.SetDocument(new(firstDocument, "# First", "UTF-8")); closed.History.Visit(firstDocument);
        closed.SearchQuery = "First"; closed.ShowSearch = true;
        workspace.Close(closed);
        Equal(1, workspace.Tabs.Count); Equal<MarkdownDocument?>(null, workspace.Active.Document);
        Equal(false, workspace.Active.History.CanGoBack); Equal<HistoryEntry?>(null, workspace.Active.History.Current);
        Equal("qiita", workspace.Active.Mode); Equal(1.2, workspace.Active.Zoom);
        Equal("", workspace.Active.SearchQuery); Equal(false, workspace.Active.ShowSearch);
    });
    foreach (var compression in Enum.GetValues<PayloadCompression>())
    {
        Stream Compress(Stream output)
        {
            if (compression == PayloadCompression.Brotli) return new BrotliStream(output, CompressionLevel.Fastest, leaveOpen: true);
            var encoder = new ZstdSharp.CompressionStream(output, 1, leaveOpen: true);
            encoder.SetParameter(ZstdSharp.Unsafe.ZSTD_cParameter.ZSTD_c_checksumFlag, 1);
            return encoder;
        }
        string Extract(Stream archive, string root, string expected) => PortablePayload.Extract(archive, root, expected, compression);
        byte[] Archive(params (string Path, string Content)[] files) {
            using var memory = new MemoryStream();
            using (var compressed = Compress(memory))
            using (var tar = new TarWriter(compressed))
                foreach (var (name, content) in files) {
                    using var data = new MemoryStream(Encoding.UTF8.GetBytes(content));
                    tar.WriteEntry(new PaxTarEntry(TarEntryType.RegularFile, name) { DataStream = data });
                }
            return memory.ToArray();
        }
        var payload = Archive(("Renderer/index.html", "preview"), ("WebView2Runtime/msedgewebview2.exe", "runtime"));
        var hash = Convert.ToHexString(SHA256.HashData(payload));
        var cache = Path.Combine(temp, "cache-" + compression);
        Check("Portable resources extract to a versioned temporary cache", () => {
            using var stream = new MemoryStream(payload); var extracted = Extract(stream, cache, hash);
            Equal(Path.Combine(cache, hash.ToLowerInvariant()), extracted); Equal("preview", File.ReadAllText(Path.Combine(extracted, "Renderer", "index.html")));
        });
        Check("Completed payload cache is reused", () => {
            using var stream = new MemoryStream([]); Equal(Path.Combine(cache, hash.ToLowerInvariant()), Extract(stream, cache, hash));
        });
        Check("Incomplete payload cache is repaired", () => {
            var index = Path.Combine(cache, hash.ToLowerInvariant(), "Renderer", "index.html"); File.Delete(index);
            using var stream = new MemoryStream(payload); Extract(stream, cache, hash); Equal(true, File.Exists(index));
        });
        Check("Cache repair tolerates a temporary Windows file lock", () => {
            var lockedCache = Path.Combine(temp, "locked-cache-" + compression);
            var target = Path.Combine(lockedCache, hash.ToLowerInvariant()); Directory.CreateDirectory(target);
            var locked = new FileStream(Path.Combine(target, "locked.bin"), FileMode.Create, FileAccess.ReadWrite, FileShare.None);
            var release = Task.Run(async () => { await Task.Delay(400); locked.Dispose(); });
            try
            {
                using var stream = new MemoryStream(payload);
                var extracted = Extract(stream, lockedCache, hash);
                Equal("preview", File.ReadAllText(Path.Combine(extracted, "Renderer", "index.html")));
                Equal(0, Directory.GetDirectories(lockedCache, "*.pending-*").Length);
            }
            finally { release.GetAwaiter().GetResult(); locked.Dispose(); }
        });
        Check("Payload tampering is detected", () => {
            using var stream = new MemoryStream(payload); Throws<InvalidDataException>(() => Extract(stream, cache, new string('0', 64)));
        });
        Check("Payload traversal cannot write outside the staging directory", () => {
            var malicious = Archive(("../outside.txt", "unsafe")); var maliciousHash = Convert.ToHexString(SHA256.HashData(malicious));
            using var stream = new MemoryStream(malicious); Throws<IOException>(() => Extract(stream, cache, maliciousHash));
            Equal(false, File.Exists(Path.Combine(cache, "outside.txt"))); Equal(0, Directory.GetDirectories(cache, "*.pending-*").Length);
        });
        foreach (var name in new[] { "/outside.txt", "C:/outside.txt", "..\\outside.txt", "Renderer/index.html:stream" })
            Check("Compressed payload rejects platform-specific escape: " + name, () => {
                var invalid = Archive((name, "unsafe")); var invalidHash = Convert.ToHexString(SHA256.HashData(invalid));
                using var stream = new MemoryStream(invalid); Throws<IOException>(() => Extract(stream, cache, invalidHash));
                Equal(0, Directory.GetDirectories(cache, "*.pending-*").Length);
            });
        Check("Compressed payload rejects TAR links", () => {
            using var memory = new MemoryStream();
            using (var compressed = Compress(memory))
            using (var tar = new TarWriter(compressed))
                tar.WriteEntry(new PaxTarEntry(TarEntryType.SymbolicLink, "escape") { LinkName = ".." });
            var data = memory.ToArray(); var invalidHash = Convert.ToHexString(SHA256.HashData(data));
            using var stream = new MemoryStream(data); Throws<InvalidDataException>(() => Extract(stream, cache, invalidHash));
            Equal(0, Directory.GetDirectories(cache, "*.pending-*").Length);
        });
        Check("Incomplete compressed payload is not marked complete", () => {
            var data = Archive(("Renderer/index.html", "preview")); var invalidHash = Convert.ToHexString(SHA256.HashData(data));
            using var stream = new MemoryStream(data); Throws<InvalidDataException>(() => Extract(stream, cache, invalidHash));
            Equal(false, Directory.Exists(Path.Combine(cache, invalidHash.ToLowerInvariant())));
        });
        Check("Compressed payload preserves long Unicode file names and contents", () => {
            var name = "Samples/" + new string('あ', 80) + ".md";
            var data = Archive(("Renderer/index.html", "preview"), ("WebView2Runtime/msedgewebview2.exe", "runtime"), (name, "# 日本語 🌸\n"));
            var dataHash = Convert.ToHexString(SHA256.HashData(data)); using var stream = new MemoryStream(data);
            var extracted = Extract(stream, cache, dataHash); Equal("# 日本語 🌸\n", File.ReadAllText(Path.Combine(extracted, name)));
            Equal(0, Directory.GetFiles(extracted, "*.tar", SearchOption.AllDirectories).Length);
        });
        Check("Concurrent payload extraction produces one complete cache", () => {
            var parallelCache = Path.Combine(temp, "parallel-cache-" + compression);
            Task.WaitAll(Enumerable.Range(0, 3).Select(_ => Task.Run(() => { using var stream = new MemoryStream(payload); Extract(stream, parallelCache, hash); })).ToArray());
            Equal(1, Directory.GetDirectories(parallelCache).Length);
        });
        if (compression == PayloadCompression.Zstandard)
        {
            Check("Zstandard rejects a truncated frame before publishing the cache", () => {
                var truncated = payload[..^2]; var truncatedHash = Convert.ToHexString(SHA256.HashData(truncated));
                using var stream = new MemoryStream(truncated);
                Throws<EndOfStreamException>(() => Extract(stream, cache, truncatedHash));
                Equal(false, Directory.Exists(Path.Combine(cache, truncatedHash.ToLowerInvariant())));
                Equal(0, Directory.GetDirectories(cache, "*.pending-*").Length);
            });
            Check("Zstandard validates the checksum after the TAR end markers", () => {
                var corrupt = payload.ToArray(); corrupt[^1] ^= 1;
                var corruptHash = Convert.ToHexString(SHA256.HashData(corrupt));
                using var stream = new MemoryStream(corrupt);
                Throws<ZstdSharp.ZstdException>(() => Extract(stream, cache, corruptHash));
                Equal(false, Directory.Exists(Path.Combine(cache, corruptHash.ToLowerInvariant())));
                Equal(0, Directory.GetDirectories(cache, "*.pending-*").Length);
            });
        }
    }

}
finally { Directory.Delete(temp, true); }
Console.WriteLine($"{checks - failures.Count}/{checks} core checks passed");
return failures.Count == 0 ? 0 : 1;

sealed class ImageTestHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(respond(request));
    }
}

sealed class ImageTestStream(long remaining) : Stream
{
    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override int Read(byte[] buffer, int offset, int count)
    {
        count = (int)Math.Min(remaining, count); remaining -= count;
        Array.Clear(buffer, offset, count); return count;
    }
    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
