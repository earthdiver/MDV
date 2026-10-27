using Mdv.Core;

if (args.Length is not (1 or 3)) throw new ArgumentException("Usage: Mdv.EngineProbe ROOT [RUBY GEMS]");
var root = Path.GetFullPath(args[0]);
var ruby = args.Length == 3 ? Path.GetFullPath(args[1]) : Path.Combine(root, "ruby", "bin", "ruby.exe");
var gems = args.Length == 3 ? Path.GetFullPath(args[2]) : Path.Combine(root, "gems");
void Assert(bool value, string message) { if (!value) throw new Exception(message); }
using (var engine = new OriginalEngine(root, ruby, gems))
{
    foreach (var mode in new[] { "github", "qiita", "github" })
    {
        var result = await engine.RenderAsync("# 日本語 🌸\n\n```mermaid\nflowchart LR\n A --> B\n```", mode);
        Assert(result.Html.Contains("日本語 🌸") && result.Html.Contains("mermaid"), "HTML transport");
        Assert(result.Metadata.GetProperty("mode").GetString() == mode, "Mode identity");
        var second = await engine.RenderAsync("**second**", mode);
        Assert(second.Html.Contains("<strong>second</strong>"), "Repeated render");
    }
    using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
    try { await engine.RenderAsync("cancel", "qiita", cancelled.Token); throw new Exception("Expected cancellation"); }
    catch (OperationCanceledException) { }
    Assert((await engine.RenderAsync("recovered", "qiita")).Html.Contains("recovered"), "Cancellation recovery");
}
// Mutated transport workers run in a temporary directory, with the real locked
// gems. Exercise timeout, cancellation during work, and identity rejection.
var temporary = Path.Combine(Path.GetTempPath(), "mdv-engine-probe-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(temporary);
try
{
    foreach (var name in new[] { "Gemfile", "Gemfile.lock" }) File.Copy(Path.Combine(root, name), Path.Combine(temporary, name));
    var worker = await File.ReadAllTextAsync(Path.Combine(root, "worker.rb"));
    // Instrument only the test copy: process IDs prove reuse across mode switches.
    var instrumented = worker.Replace("protocol: 1", "pid: Process.pid, protocol: 1")
        .Replace("markdown = request.fetch(\"markdown\")", "markdown = request.fetch(\"markdown\")\n    sleep 10 if markdown == 'probe-sleep'");
    await File.WriteAllTextAsync(Path.Combine(temporary, "worker.rb"), instrumented);
    var processes = new List<System.Diagnostics.Process>();
    try
    {
        using (var engine = new OriginalEngine(temporary, ruby, gems))
        {
            await engine.WarmupAsync("github");
            await engine.WarmupAsync("qiita");
            var ids = new Dictionary<string, int>();
            foreach (var mode in new[] { "github", "qiita", "github", "qiita" })
            {
                var result = await engine.RenderAsync("reuse", mode);
                var pid = result.Metadata.GetProperty("pid").GetInt32();
                if (ids.TryGetValue(mode, out var previous)) Assert(pid == previous, "Worker reused after switching modes");
                else { ids.Add(mode, pid); processes.Add(System.Diagnostics.Process.GetProcessById(pid)); }
            }
            Assert(ids["github"] != ids["qiita"], "Separate service workers");
            using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(700));
            try { await engine.RenderAsync("probe-sleep", "qiita", cancel.Token); throw new Exception("Expected cancellation"); }
            catch (OperationCanceledException) { }
            Assert(processes[1].HasExited, "Cancelled worker exited");
            Assert((await engine.RenderAsync("still alive", "github")).Metadata.GetProperty("pid").GetInt32() == ids["github"],
                "Cancellation preserves the other service worker");
            var recovered = await engine.RenderAsync("recovered", "qiita");
            var recoveredPid = recovered.Metadata.GetProperty("pid").GetInt32();
            Assert(recoveredPid != ids["qiita"], "Cancelled service restarts");
            processes.Add(System.Diagnostics.Process.GetProcessById(recoveredPid));
        }
        Assert(processes.All(process => process.HasExited), "Disposal stops all workers");
    }
    finally { foreach (var process in processes) process.Dispose(); }
    await File.WriteAllTextAsync(Path.Combine(temporary, "worker.rb"), worker.Replace("STDIN.each_line do |line|", "STDIN.each_line do |line|\n  sleep 10"));
    using (var engine = new OriginalEngine(temporary, ruby, gems, TimeSpan.FromSeconds(2)))
    {
        try { await engine.RenderAsync("timeout", "github"); throw new Exception("Expected timeout"); }
        catch (TimeoutException) { }
        using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(700));
        try { await engine.RenderAsync("cancel", "github", cancel.Token); throw new Exception("Expected cancellation"); }
        catch (OperationCanceledException) { }
        await File.WriteAllTextAsync(Path.Combine(temporary, "worker.rb"), worker);
        Assert((await engine.RenderAsync("restart", "github")).Html.Contains("restart"), "Worker restart");
    }
    foreach (var fault in new[] {
        worker.Replace("protocol: 1", "protocol: 99"),
        worker.Replace("id: request[\"id\"], ok: true", "id: request[\"id\"] + 1, ok: true"),
        worker.Replace("STDIN.each_line do |line|", "STDIN.each_line do |line|\n  exit 1"),
    })
    {
        await File.WriteAllTextAsync(Path.Combine(temporary, "worker.rb"), fault);
        using var engine = new OriginalEngine(temporary, ruby, gems);
        try { await engine.RenderAsync("fault", "github"); throw new Exception("Expected protocol/process rejection"); }
        catch (IOException) { }
    }

}
finally { Directory.Delete(temporary, true); }
Console.WriteLine("PASS original engine: UTF-8, modes, worker reuse, disposal, repeated requests, cancellation, timeout, restart, identity, request ID, crash");
