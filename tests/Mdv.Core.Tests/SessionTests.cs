using System.Text.Json;
using Mdv.Core;

static class SessionTests
{
    private static void Assert(bool condition) { if (!condition) throw new Exception("Session assertion failed."); }
    private static void Throws<T>(Action action) where T : Exception
    {
        try { action(); } catch (T) { return; }
        throw new Exception($"Expected {typeof(T).Name}");
    }

    internal static void Run(Action<string, Action> check, string folder)
    {
        var documentA = Path.Combine(folder, "session-a.md");
        var documentB = Path.Combine(folder, "session-b.md");
        File.WriteAllText(documentA, "# PRIVATE_DOCUMENT_TEXT_A");
        File.WriteAllText(documentB, "# PRIVATE_DOCUMENT_TEXT_B");
        var settingsPath = Path.Combine(folder, "session-viewer.ini");
        var path = DocumentSession.PathForSettings(settingsPath);
        var view = new ViewPosition(10, 400, "heading", -12, .4, [2], 11, 22,
            new() { ["details"] = true }, new() { ["code"] = new(33, 44) });
        var snapshot = new SessionSnapshot(1, 1, [new(documentA, "github", 1.25, "needle", true, view), new(documentB, "qiita", 1.5)]);

        check("Session restoration is opt-in and persists in the portable INI", () =>
        {
            Assert(!new UserSettings().RestoreSession && !UserSettings.Load(settingsPath).RestoreSession);
            new UserSettings { RestoreSession = true }.Save(settingsPath);
            Assert(UserSettings.Load(settingsPath).RestoreSession);
            Assert(path == Path.Combine(folder, "session-viewer.session.json"));
        });
        check("Saved sessions retain reading state without document text or browsing history", () =>
        {
            DocumentSession.Save(path, snapshot);
            var restored = DocumentSession.Load(path)!;
            Assert(restored.ActiveTab == 1 && restored.Tabs.Length == 2 && restored.Tabs[1].Mode == "qiita");
            Assert(restored.Tabs[0].SearchQuery == "needle" && restored.Tabs[0].ShowSearch && restored.Tabs[0].Zoom == 1.25);
            Assert(restored.Tabs[0].View!.SourceX == 11 && restored.Tabs[0].View!.SourceY == 22);
            Assert(restored.Tabs[0].View!.DetailsState!["details"] && restored.Tabs[0].View!.ElementScroll!["code"] == new ElementScrollPosition(33, 44));
            Assert(restored.Tabs[0].View!.Offset == -12 && restored.Tabs[0].View!.OpenDetails!.SequenceEqual([2]));
            Assert(!File.ReadAllText(path).Contains("PRIVATE_DOCUMENT_TEXT"));
        });
        check("Restoring a workspace selects the saved tab and reloads current file contents", () =>
        {
            File.WriteAllText(documentA, "# Updated on disk");
            var workspace = new DocumentWorkspace("github", 1);
            Assert(DocumentSession.RestoreAsync(workspace, snapshot).GetAwaiter().GetResult() == 0);
            Assert(workspace.Tabs.Count == 2 && workspace.Active.Document!.FilePath == documentB);
            Assert(workspace.Tabs[0].Document!.Text == "# Updated on disk");
            Assert(workspace.Tabs[0].History.Current!.View!.Anchor == "heading" && !workspace.Tabs[0].History.CanGoBack);
            var saved = DocumentSession.Capture(workspace);
            Assert(saved.ActiveTab == 1 && saved.Tabs[0].View!.Y == 400);
        });
        check("Unavailable session files are skipped without losing the saved active tab", () =>
        {
            var workspace = new DocumentWorkspace("github", 1);
            var missing = new SessionSnapshot(1, 2, [snapshot.Tabs[0], new(Path.Combine(folder, "removed.md")), snapshot.Tabs[1]]);
            Assert(DocumentSession.RestoreAsync(workspace, missing).GetAwaiter().GetResult() == 1);
            Assert(workspace.Tabs.Count == 2 && workspace.Active.Document!.FilePath == documentB);
            Assert(DocumentSession.RestoreAsync(workspace, missing with { ActiveTab = 1 }).GetAwaiter().GetResult() == 1);
            Assert(workspace.Active.Document!.FilePath == documentA);
        });
        check("A wholly unavailable session leaves the initial workspace usable", () =>
        {
            var workspace = new DocumentWorkspace("qiita", 1.5);
            var initial = workspace.Active;
            Assert(DocumentSession.RestoreAsync(workspace, new(1, 0, [new(Path.Combine(folder, "removed.md"))])).GetAwaiter().GetResult() == 1);
            Assert(ReferenceEquals(workspace.Active, initial));
        });
        check("An empty tab and its selection survive session restoration", () =>
        {
            var workspace = new DocumentWorkspace("github", 1);
            DocumentSession.RestoreAsync(workspace, new(1, 1, [snapshot.Tabs[0], new(null, "qiita", 2)])).GetAwaiter().GetResult();
            Assert(workspace.Tabs.Count == 2 && workspace.Active.Document == null && workspace.Active.Mode == "qiita" && workspace.Active.Zoom == 2);
            Assert(DocumentSession.Capture(workspace).ActiveTab == 1);
        });
        check("Cancellation leaves a workspace unchanged", () =>
        {
            var workspace = new DocumentWorkspace("github", 1);
            var initial = workspace.Active;
            using var cancellation = new CancellationTokenSource();
            cancellation.Cancel();
            Throws<OperationCanceledException>(() => DocumentSession.RestoreAsync(workspace, snapshot, cancellation.Token).GetAwaiter().GetResult());
            Assert(ReferenceEquals(workspace.Active, initial));
        });
        check("Malformed, oversized and unsupported session files fail without changing the saved valid session", () =>
        {
            DocumentSession.Save(path, snapshot);
            var before = File.ReadAllBytes(path);
            Throws<InvalidDataException>(() => DocumentSession.Save(path, snapshot with { Version = 2 }));
            Throws<InvalidDataException>(() => DocumentSession.Save(path, new(1, 0, [new("relative.md")])));
            Assert(before.SequenceEqual(File.ReadAllBytes(path)));
            var bad = Path.Combine(folder, "invalid.session.json");
            File.WriteAllText(bad, "{"); Throws<JsonException>(() => DocumentSession.Load(bad));
            File.WriteAllText(bad, "{\"version\":1,\"tabs\":null}"); Throws<InvalidDataException>(() => DocumentSession.Load(bad));
            File.WriteAllText(bad, "{\"version\":1,\"tabs\":[null]}"); Throws<InvalidDataException>(() => DocumentSession.Load(bad));
            File.WriteAllBytes(bad, new byte[DocumentSession.MaxBytes + 1]); Throws<InvalidDataException>(() => DocumentSession.Load(bad));
            Assert(DocumentSession.Load(Path.Combine(folder, "absent.session.json")) == null);
        });
        check("Session values are bounded before restoring UI controls", () =>
        {
            DocumentSession.Save(path, new(1, 999, [new(documentA, "bad", double.NaN, new string('x', 20_000), true,
                new ViewPosition(double.NaN, -1, Ratio: 5, DetailsState: new() { [new string('x', 4097)] = true }))]));
            var saved = DocumentSession.Load(path)!;
            Assert(saved.ActiveTab == 0 && saved.Tabs[0].Mode == "github" && saved.Tabs[0].Zoom == 1);
            Assert(saved.Tabs[0].SearchQuery.Length == 16_384 && saved.Tabs[0].View!.X == 0 && saved.Tabs[0].View!.Y == 0 && saved.Tabs[0].View!.Ratio == 1);
            Assert(saved.Tabs[0].View!.DetailsState!.Count == 0);
        });
        check("Concurrent session writers publish a complete snapshot and remove temporary files", () =>
        {
            Parallel.For(0, 12, index => DocumentSession.Save(path, snapshot with { ActiveTab = index % 2 }));
            var saved = DocumentSession.Load(path)!;
            Assert(saved.Tabs.Length == 2 && saved.ActiveTab is 0 or 1);
            Assert(Directory.GetFiles(folder, "session-viewer.session.json.*.tmp").Length == 0);
        });
        check("Opting out during another window's capture prevents later session and preference resurrection", () =>
        {
            var closingWindow = new UserSettings { RestoreSession = true, Theme = "dark" };
            var otherWindow = new UserSettings();
            DocumentSession.SetEnabled(settingsPath, otherWindow, true);
            Assert(DocumentSession.SaveIfEnabled(settingsPath, snapshot));
            // The closing window has already captured its snapshot; OFF arrives before publication.
            DocumentSession.SetEnabled(settingsPath, otherWindow, false);
            Assert(!File.Exists(path));
            Assert(!DocumentSession.SaveIfEnabled(settingsPath, snapshot));
            DocumentSession.SaveSettings(settingsPath, closingWindow);
            Assert(!File.Exists(path) && !UserSettings.Load(settingsPath).RestoreSession && !closingWindow.RestoreSession);
            Assert(UserSettings.Load(settingsPath).Theme == "dark");
        });
        check("Concurrent opt-out, snapshot publication and stale settings saves always retain OFF", () =>
        {
            for (var run = 0; run < 20; run++)
            {
                var closingWindow = new UserSettings { RestoreSession = true };
                var otherWindow = new UserSettings();
                DocumentSession.SetEnabled(settingsPath, otherWindow, true);
                Parallel.Invoke(
                    () => { DocumentSession.SaveIfEnabled(settingsPath, snapshot); DocumentSession.SaveSettings(settingsPath, closingWindow); },
                    () => DocumentSession.SetEnabled(settingsPath, otherWindow, false));
                Assert(!File.Exists(path) && !UserSettings.Load(settingsPath).RestoreSession);
            }
        });
        check("The session tab limit retains the active document", () =>
        {
            var workspace = new DocumentWorkspace("github", 1);
            for (var index = 0; index < DocumentSession.MaxTabs + 2; index++) workspace.Add();
            workspace.Active.SetDocument(new MarkdownDocument(documentB, "PRIVATE_DOCUMENT_TEXT", "UTF-8"));
            var saved = DocumentSession.Capture(workspace);
            Assert(saved.Tabs.Length == DocumentSession.MaxTabs && saved.Tabs[saved.ActiveTab].FilePath == documentB);
        });
    }
}
