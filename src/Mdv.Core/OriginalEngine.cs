using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Mdv.Core;

/// <summary>Retains one lazy Ruby worker per service until disposal.</summary>
public sealed class OriginalEngine : IDisposable
{
    private readonly OriginalEngineWorker _github;
    private readonly OriginalEngineWorker _qiita;

    public OriginalEngine(string root, string? ruby = null, string? gems = null, TimeSpan? timeout = null)
    {
        _github = new(root, ruby, gems, timeout);
        _qiita = new(root, ruby, gems, timeout);
    }

    public Task<OriginalRender> RenderAsync(string markdown, string mode, CancellationToken cancellationToken = default) =>
        mode switch
        {
            "github" => _github.RenderAsync(markdown, mode, cancellationToken),
            "qiita" => _qiita.RenderAsync(markdown, mode, cancellationToken),
            _ => throw new ArgumentException("Unknown Markdown mode", nameof(mode)),
        };

    // Reuse the normal protocol and serialization gate; an empty conversion loads
    // the selected service without waiting for WebView2 to become ready.
    public async Task WarmupAsync(string mode, CancellationToken cancellationToken = default) =>
        _ = await RenderAsync("", mode, cancellationToken);

    public static bool MayNeedQiitaHighlighting(string markdown)
    {
        // Only language-tagged blocks can receive borrowed Rouge tokens. Keep
        // ambiguous raw HTML and fence-like text conservative, including nesting.
        if (System.Text.RegularExpressions.Regex.IsMatch(markdown, @"<(?:pre|code)\b",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase)) return true;
        foreach (System.Text.RegularExpressions.Match match in System.Text.RegularExpressions.Regex.Matches(
            markdown, @"(?:`{3,}|~{3,})[ \t]*([^\s`~]+)"))
        {
            var language = match.Groups[1].Value.Split(':')[0].ToLowerInvariant();
            if (language is not ("" or "math" or "mermaid" or "text" or "plain" or "plaintext" or "txt")) return true;
        }
        return false;
    }

    // Caller cancels and awaits outstanding work before disposing.
    public void Dispose()
    {
        _github.Dispose();
        _qiita.Dispose();
    }
}

/// <summary>One persistent, serialized JSONL worker. Cancellation invalidates only this worker.</summary>
internal sealed class OriginalEngineWorker : IDisposable
{
    private readonly string _root, _ruby, _gems;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly TimeSpan _timeout;
    private Process? _process;
    private string? _mode;
    private bool _disposed;
    private int _id;
    private JsonElement _metadata;

    public OriginalEngineWorker(string root, string? ruby = null, string? gems = null, TimeSpan? timeout = null)
    {
        _root = Path.GetFullPath(root);
        _ruby = ruby ?? Path.Combine(_root, "ruby", "bin", "ruby.exe");
        _gems = gems ?? Path.Combine(_root, "gems");
        _timeout = timeout ?? TimeSpan.FromSeconds(30);
    }

    public async Task<OriginalRender> RenderAsync(string markdown, string mode, CancellationToken cancellationToken = default)
    {
        if (mode is not ("github" or "qiita")) throw new ArgumentException("Unknown Markdown mode", nameof(mode));
        if (markdown.Length > DocumentReader.MaxCharacters) throw new ArgumentException("Markdown is too large", nameof(markdown));
        await _gate.WaitAsync(cancellationToken);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(_timeout);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_process == null || _process.HasExited || _mode != mode)
            {
                Stop();
                if (!File.Exists(_ruby) || !File.Exists(Path.Combine(_root, "worker.rb")))
                    throw new IOException(UiLanguage.Text("公開実装の実行資材がありません。配布ファイルを再取得してください。", "Upstream engine assets are missing. Please download MDV again."));
                var start = new ProcessStartInfo(_ruby) { UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                    StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8,
                    StandardErrorEncoding = Encoding.UTF8, WorkingDirectory = _root };
                start.ArgumentList.Add("-rbundler/setup"); start.ArgumentList.Add(Path.Combine(_root, "worker.rb")); start.ArgumentList.Add(mode); start.ArgumentList.Add("--desktop");
                foreach (var key in start.Environment.Keys.Where(k => k.StartsWith("BUNDLE_", StringComparison.OrdinalIgnoreCase) || k is "RUBYOPT" or "RUBYLIB" or "GEM_HOME" or "GEM_PATH").ToArray())
                    start.Environment.Remove(key);
                if (OperatingSystem.IsWindows()) start.Environment["PATH"] = Path.GetDirectoryName(_ruby) + Path.PathSeparator + Environment.SystemDirectory;
                start.Environment["BUNDLE_GEMFILE"] = Path.Combine(_root, "Gemfile");
                start.Environment["BUNDLE_PATH"] = _gems;
                start.Environment["BUNDLE_FROZEN"] = "true";
                start.Environment["BUNDLE_IGNORE_CONFIG"] = "true";
                _process = Process.Start(start) ?? throw new IOException(UiLanguage.Text("公開実装を起動できませんでした。", "Unable to start the upstream engine."));
                // Drain stderr without buffering unbounded diagnostics or blocking stdout.
                _ = DrainAsync(_process.StandardError);
                using var ready = await ReadMessageAsync(_process.StandardOutput, deadline.Token);
                var root = ready.RootElement;
                var metadata = root.GetProperty("metadata");
                var lockHash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(Path.Combine(_root, "Gemfile.lock"), deadline.Token))).ToLowerInvariant();
                if (root.GetProperty("type").GetString() != "ready" || metadata.GetProperty("protocol").GetInt32() != 1 ||
                    metadata.GetProperty("mode").GetString() != mode || metadata.GetProperty("host_profile").GetString() != "desktop" || metadata.GetProperty("lock_sha256").GetString() != lockHash)
                    throw new IOException(UiLanguage.Text("公開実装の起動情報・依存バージョンが一致しません。", "Upstream engine startup metadata or dependency versions do not match."));
                _metadata = metadata.Clone(); _mode = mode;
            }
            var id = ++_id;
            var line = JsonSerializer.Serialize(new { id, markdown });
            if (Encoding.UTF8.GetByteCount(line) > 24 * 1024 * 1024) throw new IOException(UiLanguage.Text("公開実装への要求が大きすぎます。", "The upstream engine request is too large."));
            await _process.StandardInput.WriteLineAsync(line.AsMemory(), deadline.Token);
            await _process.StandardInput.FlushAsync(deadline.Token);
            using var response = await ReadMessageAsync(_process.StandardOutput, deadline.Token);
            var value = response.RootElement;
            if (value.GetProperty("id").GetInt32() != id) throw new IOException(UiLanguage.Text("公開実装の応答IDが一致しません。", "The upstream engine response ID does not match."));
            if (!value.GetProperty("ok").GetBoolean()) throw new IOException(UiLanguage.Text("公開実装の変換エラー: ", "Upstream engine conversion error: ") + value.GetProperty("error").GetProperty("message").GetString());
            return new OriginalRender(value.GetProperty("html").GetString() ?? throw new IOException(UiLanguage.Text("公開実装のHTMLがありません。", "The upstream engine returned no HTML.")), _metadata);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        { Stop(); throw new TimeoutException(UiLanguage.Text("公開実装の応答が制限時間内に完了しませんでした。", "The upstream engine response timed out.")); }
        catch { Stop(); throw; }
        finally { _gate.Release(); }
    }

    private static async Task<JsonDocument> ReadMessageAsync(StreamReader reader, CancellationToken token)
    {
        using var bytes = new MemoryStream();
        var buffer = new byte[8192];
        while (true)
        {
            var count = await reader.BaseStream.ReadAsync(buffer.AsMemory(), token);
            if (count == 0) throw new IOException(UiLanguage.Text("公開実装が応答前に終了しました。実行資材と依存ライブラリを確認してください。", "The upstream engine exited before responding. Check its assets and dependencies."));
            var newline = Array.IndexOf(buffer, (byte)'\n', 0, count);
            bytes.Write(buffer, 0, newline < 0 ? count : newline);
            if (bytes.Length > 64 * 1024 * 1024) throw new IOException(UiLanguage.Text("公開実装の応答が大きすぎます。", "The upstream engine response is too large."));
            if (newline >= 0)
            {
                if (newline != count - 1) throw new IOException(UiLanguage.Text("公開実装から予期しない追加応答を受信しました。", "Received an unexpected additional response from the upstream engine."));
                return JsonDocument.Parse(bytes.ToArray());
            }
        }
    }
    private static async Task DrainAsync(StreamReader reader)
    {
        try { var buffer = new char[4096]; while (await reader.ReadAsync(buffer) != 0) { } }
        catch (Exception error) when (error is IOException or ObjectDisposedException) { }
    }
    private void Stop()
    {
        var process = _process; _process = null; _mode = null;
        if (process == null) return;
        try { if (!process.HasExited) { process.Kill(entireProcessTree: true); process.WaitForExit(2000); } }
        catch (InvalidOperationException) { }
        finally { process.Dispose(); }
    }
    // Caller cancels and awaits outstanding work before disposing.
    public void Dispose() { _disposed = true; Stop(); }
}

public sealed record OriginalRender(string Html, JsonElement Metadata);
