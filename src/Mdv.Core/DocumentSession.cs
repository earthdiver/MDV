using System.Text.Json;
using System.Text;
using System.Security.Cryptography;

namespace Mdv.Core;

public sealed record SessionTab(string? FilePath, string Mode = "github", double Zoom = 1,
    string SearchQuery = "", bool ShowSearch = false, ViewPosition? View = null);

public sealed record SessionSnapshot(int Version, int ActiveTab, SessionTab[] Tabs);

/// <summary>Optional portable reading state. Document contents and navigation history are never stored.</summary>
public static class DocumentSession
{
    public const int MaxTabs = 100;
    public const int MaxBytes = 4 * 1024 * 1024;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static string PathForSettings(string settingsPath) => Path.ChangeExtension(settingsPath, ".session.json");

    // All application INI writers preserve the latest opt-in under the same
    // cross-process lock used by snapshot publication and explicit opt-out.
    public static void SaveSettings(string settingsPath, UserSettings settings) => WithSettingsLock(settingsPath, () =>
    {
        settings.RestoreSession = UserSettings.Load(settingsPath).RestoreSession;
        settings.Save(settingsPath);
    });

    public static void SetEnabled(string settingsPath, UserSettings settings, bool enabled) => WithSettingsLock(settingsPath, () =>
    {
        settings.RestoreSession = enabled;
        settings.Save(settingsPath);
        if (!enabled) File.Delete(PathForSettings(settingsPath));
    });

    public static bool SaveIfEnabled(string settingsPath, SessionSnapshot snapshot)
    {
        var saved = false;
        WithSettingsLock(settingsPath, () =>
        {
            if (!UserSettings.Load(settingsPath).RestoreSession) return;
            Save(PathForSettings(settingsPath), snapshot);
            saved = true;
        });
        return saved;
    }

    private static void WithSettingsLock(string settingsPath, Action action)
    {
        var identity = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(settingsPath).ToUpperInvariant())));
        using var mutex = new Mutex(false, "MDV.Settings." + identity);
        var acquired = false;
        try
        {
            try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(5)); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) throw new IOException(UiLanguage.Text("別のMDVが設定を保存中です。もう一度お試しください。", "Another MDV window is saving settings. Please try again."));
            action();
        }
        finally { if (acquired) mutex.ReleaseMutex(); }
    }

    public static SessionSnapshot Capture(DocumentWorkspace workspace)
    {
        // Keep the active tab even when the workspace exceeds the persistence limit.
        var tabs = workspace.Tabs.Take(MaxTabs).ToList();
        if (!tabs.Contains(workspace.Active)) tabs[^1] = workspace.Active;
        return Normalize(new(1, tabs.IndexOf(workspace.Active), tabs.Select(tab => new SessionTab(
            tab.Document?.FilePath, tab.Mode, tab.Zoom, tab.SearchQuery, tab.ShowSearch, tab.History.Current?.View)).ToArray()));
    }

    public static SessionSnapshot? Load(string path)
    {
        if (!File.Exists(path)) return null;
        using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete);
        if (input.Length > MaxBytes) throw new InvalidDataException("The saved session exceeds 4 MiB.");
        var bytes = new byte[checked((int)input.Length)];
        input.ReadExactly(bytes);
        var snapshot = JsonSerializer.Deserialize<SessionSnapshot>(bytes, Json)
            ?? throw new InvalidDataException("The saved session is empty.");
        return Normalize(snapshot);
    }

    public static void Save(string path, SessionSnapshot snapshot)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(Normalize(snapshot), Json);
        if (bytes.Length > MaxBytes) throw new InvalidDataException("The saved session exceeds 4 MiB.");
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllBytes(temporary, bytes);
            // Concurrent windows publish complete snapshots; the last successful close wins.
            File.Move(temporary, path, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public static async Task<int> RestoreAsync(DocumentWorkspace workspace, SessionSnapshot snapshot,
        CancellationToken cancellationToken = default, Func<string, CancellationToken, Task<MarkdownDocument>>? readDocument = null)
    {
        readDocument ??= DocumentReader.ReadAsync;
        snapshot = Normalize(snapshot);
        var restored = new List<DocumentTab>();
        DocumentTab? active = null;
        var failed = 0;
        for (var index = 0; index < snapshot.Tabs.Length; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var saved = snapshot.Tabs[index];
            var tab = new DocumentTab(saved.Mode, saved.Zoom) { SearchQuery = saved.SearchQuery, ShowSearch = saved.ShowSearch };
            if (saved.FilePath != null)
            {
                try
                {
                    // Opening disconnected shares can block before ReadAsync first yields.
                    var document = await Task.Run(() => readDocument(saved.FilePath, cancellationToken), cancellationToken)
                        .WaitAsync(TimeSpan.FromSeconds(5), cancellationToken);
                    tab.SetDocument(document);
                    tab.History.Visit(document.FilePath);
                    if (saved.View != null) tab.History.SaveView(saved.View);
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException
                    or NotSupportedException or System.Text.DecoderFallbackException or TimeoutException)
                { failed++; continue; }
            }
            restored.Add(tab);
            if (index == snapshot.ActiveTab) active = tab;
        }
        cancellationToken.ThrowIfCancellationRequested();
        if (restored.Count > 0) workspace.Restore(restored, active ?? restored[0]);
        return failed;
    }

    private static SessionSnapshot Normalize(SessionSnapshot snapshot)
    {
        if (snapshot.Version != 1 || snapshot.Tabs is not { Length: > 0 and <= MaxTabs } || snapshot.Tabs.Any(tab => tab == null))
            throw new InvalidDataException("Unsupported saved session format.");
        var tabs = snapshot.Tabs.Select(tab => tab with
        {
            Mode = tab.Mode is "qiita" ? "qiita" : "github",
            Zoom = double.IsFinite(tab.Zoom) ? Math.Clamp(tab.Zoom, .5, 2.5) : 1,
            SearchQuery = Short(tab.SearchQuery, 16_384) ?? "",
            View = NormalizeView(tab.View),
        }).ToArray();
        // Relative paths would otherwise resolve differently after moving the EXE.
        if (tabs.Any(tab => tab.FilePath != null && (!Path.IsPathFullyQualified(tab.FilePath) || tab.FilePath.Length > 32_768 || tab.FilePath.Contains('\0'))))
            throw new InvalidDataException("The saved session contains an invalid document path.");
        return snapshot with { ActiveTab = Math.Clamp(snapshot.ActiveTab, 0, tabs.Length - 1), Tabs = tabs };
    }

    private static string? Short(string? value, int limit) => value is { Length: > 0 } ? value[..Math.Min(value.Length, limit)] : null;
    private static double Position(double value, bool signed = false) => double.IsFinite(value) ? Math.Clamp(value, signed ? -1e9 : 0, 1e9) : 0;
    private static ViewPosition? NormalizeView(ViewPosition? view) => view == null ? null : view with
    {
        X = Position(view.X), Y = Position(view.Y), Offset = Position(view.Offset, true), Anchor = Short(view.Anchor, 4096),
        Ratio = double.IsFinite(view.Ratio) ? Math.Clamp(view.Ratio, 0, 1) : 0,
        SourceX = Position(view.SourceX), SourceY = Position(view.SourceY),
        OpenDetails = view.OpenDetails?.Where(index => index is >= 0 and < 100_000).Distinct().Take(2048).ToArray(),
        DetailsState = view.DetailsState?.Where(pair => pair.Key.Length <= 4096).Take(2048).ToDictionary(pair => pair.Key, pair => pair.Value),
        ElementScroll = view.ElementScroll?.Where(pair => pair.Key.Length <= 4096 && pair.Value != null).Take(2048)
            .ToDictionary(pair => pair.Key, pair => new ElementScrollPosition(Position(pair.Value.X), Position(pair.Value.Y))),
    };
}
