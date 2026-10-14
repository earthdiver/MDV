using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using Mdv.Core;

namespace Mdv.App;

internal sealed class PortableEnvironment
{
    internal string Assets { get; private set; } = AppContext.BaseDirectory;
    internal string? Runtime { get; private set; }
    internal string UserData { get; } = Path.Combine(Path.GetTempPath(), "MDV", "sessions", Guid.NewGuid().ToString("N"));
    internal bool Bundled => Runtime != null;
    internal TimeSpan PreparationTime { get; private set; }

    internal async Task PrepareAsync()
    {
        var started = Stopwatch.GetTimestamp();
        var assembly = Assembly.GetExecutingAssembly();
        using var zstdPayload = assembly.GetManifestResourceStream("Mdv.PortablePayload.zst");
        using var brotliPayload = assembly.GetManifestResourceStream("Mdv.PortablePayload.br");
        var payload = zstdPayload ?? brotliPayload;
        if (payload != null)
        {
            using var hashStream = assembly.GetManifestResourceStream("Mdv.PortablePayload.sha256") ?? throw new InvalidDataException(UiLanguage.Text("描画資材の検証情報がありません。", "Rendering asset verification data is missing."));
            using var reader = new StreamReader(hashStream);
            var hash = (await reader.ReadToEndAsync()).Trim();
            var compression = zstdPayload != null ? PayloadCompression.Zstandard : PayloadCompression.Brotli;
            Assets = await Task.Run(() => PortablePayload.Extract(payload, Path.Combine(Path.GetTempPath(), "MDV", "payload"), hash, compression));
            Runtime = Path.Combine(Assets, "WebView2Runtime");
            // Fixed Version 120+ requires these read/execute ACLs for its Windows 10 sandbox.
            if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000))
            {
                var directory = new DirectoryInfo(Runtime);
                var security = directory.GetAccessControl();
                foreach (var sid in new[] { "S-1-15-2-1", "S-1-15-2-2" })
                    security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid), FileSystemRights.ReadAndExecute,
                        InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
                directory.SetAccessControl(security);
            }
        }
        else if (!File.Exists(Path.Combine(Assets, "Renderer", "index.html")))
            throw new IOException(UiLanguage.Text("描画資材がありません。開発時は npm run build を実行してください。", "Rendering assets are missing. Run npm run build for development."));
        using var rendererManifest = System.Text.Json.JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(Assets, "Renderer", "bundle-manifest.json")));
        if (rendererManifest.RootElement.GetProperty("edition").GetString() != BuildEdition.Id)
            throw new IOException(UiLanguage.Text("アプリと表示資材の配布版が一致しません。同じ版でビルドし直してください。", "The application and renderer editions do not match. Rebuild both with the same edition."));
        Directory.CreateDirectory(UserData);
        // Per-process overrides prevent a pre-existing environment variable from moving MDV's
        // profile elsewhere. The distributed build always chooses its own Fixed Version runtime.
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", UserData);
        if (Runtime != null) Environment.SetEnvironmentVariable("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", Runtime);
        PreparationTime = Stopwatch.GetElapsedTime(started);
    }

    internal async Task CleanupAsync(uint? browserProcessId)
    {
        if (browserProcessId is { } id)
        {
            try
            {
                using var process = Process.GetProcessById(checked((int)id));
                await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(8));
            }
            catch (Exception error) when (error is ArgumentException or InvalidOperationException or TimeoutException) { }
        }
        for (var attempt = 0; attempt < 5; attempt++)
        {
            try { if (Directory.Exists(UserData)) Directory.Delete(UserData, true); return; }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { await Task.Delay(150); }
        }
    }
}
