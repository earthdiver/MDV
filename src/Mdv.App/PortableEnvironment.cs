using System.Diagnostics;
using System.IO;
using System.Reflection;
using Mdv.Core;

namespace Mdv.App;

internal sealed class PortableEnvironment
{
    internal string Assets { get; private set; } = AppContext.BaseDirectory;
    internal string UserData { get; } = Path.Combine(Path.GetTempPath(), "MDV", "sessions", Guid.NewGuid().ToString("N"));
    internal bool Bundled { get; private set; }
    internal MemoryPayload? MemoryAssets { get; private set; }
    internal TimeSpan PreparationTime { get; private set; }
    // Older hosts never acquire a lease. Keep their cache separate, even when
    // the payload hash is identical, so they cannot race managed cache cleanup.
    internal string CacheRoot => Path.Combine(Path.GetTempPath(), "MDV", "payload-v2");
    internal string LegacyCacheRoot => Path.Combine(Path.GetTempPath(), "MDV", "payload");
    private PayloadCache.Lease? _payloadLease;

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
            Bundled = true;
            if (BuildEdition.UsesMemoryAssets)
            {
                MemoryAssets = await Task.Run(() => MemoryPayload.Load(payload, hash, compression));
                // A stable virtual path gives bundled samples normal tab/history identities.
                // This directory is never created.
                Assets = Path.Combine(AppContext.BaseDirectory, ".mdv-bundled");
            }
            else
            {
                _payloadLease = await Task.Run(() => PayloadCache.ExtractAndLease(payload, CacheRoot, hash, compression));
                Assets = _payloadLease.Path;
            }
        }
        else if (!File.Exists(Path.Combine(Assets, "Renderer", "index.html")))
            throw new IOException(UiLanguage.Text("描画資材がありません。開発時は npm run build を実行してください。", "Rendering assets are missing. Run npm run build for development."));
        using var rendererManifest = System.Text.Json.JsonDocument.Parse(ReadText("Renderer/bundle-manifest.json"));
        if (rendererManifest.RootElement.GetProperty("edition").GetString() != BuildEdition.Id)
            throw new IOException(UiLanguage.Text("アプリと表示資材の配布版が一致しません。同じ版でビルドし直してください。", "The application and renderer editions do not match. Rebuild both with the same edition."));
        Directory.CreateDirectory(UserData);
        // Per-process overrides prevent a pre-existing environment variable from moving MDV's
        // profile elsewhere. Clear any inherited fixed-runtime override for Evergreen discovery.
        Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", UserData);
        Environment.SetEnvironmentVariable("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", null);
        PreparationTime = Stopwatch.GetElapsedTime(started);
    }

    internal string ReadText(string name) => MemoryAssets?.ReadText(name) ?? File.ReadAllText(Path.Combine(Assets, name));
    internal IEnumerable<string> AssetNames => MemoryAssets?.Names ?? Directory.EnumerateFiles(Assets, "*", SearchOption.AllDirectories).Select(path => Path.GetRelativePath(Assets, path).Replace('\\', '/'));
    internal bool IsMemorySample(string path) => MemoryAssets != null &&
        Path.GetRelativePath(Assets, Path.GetFullPath(path)).Replace('\\', '/') is var name && name.StartsWith("Samples/", StringComparison.Ordinal) && MemoryAssets.Contains(name);
    internal MarkdownDocument? ReadMemorySample(string path) => IsMemorySample(path)
        ? new MarkdownDocument(Path.GetFullPath(path), ReadText(Path.GetRelativePath(Assets, path).Replace('\\', '/')), "UTF-8") : null;

    internal string? ResolveSampleLink(string document, string href, bool imagesOnly = false)
    {
        if (!IsMemorySample(document)) return null;
        var name = Uri.UnescapeDataString(href.Split('?', '#')[0]);
        if (!MemoryPayload.ValidName(name)) return null;
        var path = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(document)!, name));
        return IsMemorySample(path) && (!imagesOnly || LocalAssets.ContentType(path) != "application/octet-stream") ? path : null;
    }
    internal Stream? OpenSampleAsset(string path) => IsMemorySample(path)
        ? MemoryAssets!.Open(Path.GetRelativePath(Assets, path).Replace('\\', '/')) : null;

    internal async Task CleanupAsync(uint? browserProcessId)
    {
        try
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
        finally { _payloadLease?.Dispose(); _payloadLease = null; MemoryAssets = null; }
    }
}
