using Mdv.Core;
using System.Formats.Tar;
using System.IO.Compression;
using System.Security.Cryptography;

static class PayloadCacheTests
{
    private static void Assert(bool condition) { if (!condition) throw new Exception("Payload cache assertion failed."); }
    internal static void Run(Action<string, Action> check, string folder)
    {
        string Create(string root, char name)
        {
            var hash = new string(name, 64);
            var path = Path.Combine(root, hash);
            Directory.CreateDirectory(path);
            File.WriteAllText(Path.Combine(path, ".complete"), hash);
            File.WriteAllText(Path.Combine(path, ".in-use"), "");
            Directory.CreateDirectory(Path.Combine(path, "Renderer"));
            File.WriteAllText(Path.Combine(path, "Renderer", "index.html"), "preview");
            return path;
        }
        byte[] Archive()
        {
            using var output = new MemoryStream();
            using (var compressed = new BrotliStream(output, CompressionLevel.Fastest, leaveOpen: true))
            using (var tar = new TarWriter(compressed, leaveOpen: true))
                foreach (var name in new[] { "Renderer/index.html", "WebView2Runtime/msedgewebview2.exe" })
                {
                    using var contents = new MemoryStream("asset"u8.ToArray());
                    tar.WriteEntry(new PaxTarEntry(TarEntryType.RegularFile, name) { DataStream = contents });
                }
            return output.ToArray();
        }
        check("A fresh extraction holds its lease until the host releases it", () =>
        {
            var root = Path.Combine(folder, "cache-extract-lease", "payload-v2");
            var bytes = Archive();
            var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            using var archive = new MemoryStream(bytes);
            string path;
            using (var lease = PayloadCache.ExtractAndLease(archive, root, hash, PayloadCompression.Brotli))
            {
                path = lease.Path;
                Assert(File.ReadAllText(Path.Combine(path, "Renderer", "index.html")) == "asset");
                Assert(PayloadCache.DeleteUnused(root, folder, [path], _ => false).Deleted == 0);
            }
            Assert(PayloadCache.DeleteUnused(root, folder, [path], _ => false).Deleted == 1);
        });
        check("First extraction rejects a linked cache root before writing any files", () =>
        {
            var target = Path.Combine(folder, "cache-empty-link-target");
            Directory.CreateDirectory(target);
            var link = Path.Combine(folder, "cache-empty-link");
            try { Directory.CreateSymbolicLink(link, target); }
            catch (Exception error) when (OperatingSystem.IsWindows() && error is IOException or UnauthorizedAccessException) { return; }
            try
            {
                var bytes = Archive();
                using var archive = new MemoryStream(bytes);
                var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
                RejectLease(() => PayloadCache.ExtractAndLease(archive, link, hash, PayloadCompression.Brotli));
                Assert(!Directory.EnumerateFileSystemEntries(target).Any());
            }
            finally { Directory.Delete(link); }
        });
        check("Cache cleanup protects current and leased versions, including multiple windows", () =>
        {
            var root = Path.Combine(folder, "cache-cleanup");
            var current = Create(root, 'a');
            var used = Create(root, 'b');
            var unused = Create(root, 'c');
            using (var first = PayloadCache.AcquireLease(used))
            {
                using (var second = PayloadCache.AcquireLease(used))
                {
                    var entries = PayloadCache.Inspect(root, current, _ => false);
                    Assert(entries.Single(entry => entry.Path == current).State == PayloadCacheState.Current);
                    Assert(entries.Single(entry => entry.Path == used).State == PayloadCacheState.InUse);
                    Assert(entries.Single(entry => entry.Path == unused).Bytes == 71);
                }
                var result = PayloadCache.DeleteUnused(root, current, [current, used, unused], _ => false);
                Assert(result.Deleted == 1 && result.Skipped == 2 && result.FreedBytes == 71);
                Assert(Directory.Exists(current) && Directory.Exists(used) && !Directory.Exists(unused));
            }
            Assert(PayloadCache.DeleteUnused(root, current, [used], _ => false).Deleted == 1);
        });
        check("Cache cleanup rechecks leases acquired after the storage dialog was opened", () =>
        {
            var root = Path.Combine(folder, "cache-late-lease");
            var path = Create(root, 'a');
            var candidates = PayloadCache.Inspect(root, folder, _ => false).Select(entry => entry.Path).ToArray();
            using var lease = PayloadCache.AcquireLease(path);
            var result = PayloadCache.DeleteUnused(root, folder, candidates, _ => false);
            Assert(result.Deleted == 0 && result.Skipped == 1 && Directory.Exists(path));
        });
        check("Surviving child processes protect payloads after their host's lease closes", () =>
        {
            var root = Path.Combine(folder, "cache-legacy");
            var path = Create(root, 'a');
            Assert(PayloadCache.Inspect(root, folder, _ => true).Single().State == PayloadCacheState.InUse);
            Assert(PayloadCache.DeleteUnused(root, folder, [path], _ => true).Deleted == 0);
            Assert(Directory.Exists(path));
        });
        check("Untracked legacy payloads are kept even when no runtime process is visible", () =>
        {
            var root = Path.Combine(folder, "cache-untracked");
            var path = Create(root, 'a');
            File.Delete(Path.Combine(path, ".in-use"));
            Assert(PayloadCache.Inspect(root, folder, _ => false).Single().State == PayloadCacheState.Untracked);
            Assert(PayloadCache.DeleteUnused(root, folder, [path], _ => false).Deleted == 0);
            Assert(Directory.Exists(path));
        });
        check("Cache cleanup excludes incomplete caches, unrelated folders, and paths outside its root", () =>
        {
            var root = Path.Combine(folder, "cache-invalid");
            var invalid = Create(root, 'a');
            File.WriteAllText(Path.Combine(invalid, ".complete"), "wrong");
            var pending = Path.Combine(root, new string('b', 64) + ".pending-123");
            Directory.CreateDirectory(pending);
            var other = Path.Combine(root, "documents");
            Directory.CreateDirectory(other);
            File.WriteAllText(Path.Combine(other, "notes.md"), "keep");
            var outside = Create(Path.Combine(folder, "outside-cache"), 'c');
            var entries = PayloadCache.Inspect(root, folder, _ => false);
            Assert(entries.Count == 1 && entries[0].State == PayloadCacheState.Unavailable);
            Assert(PayloadCache.DeleteUnused(root, folder, [invalid, pending, other, outside], _ => false).Deleted == 0);
            Assert(new[] { invalid, pending, other, outside }.All(Directory.Exists));
        });
        check("Cache cleanup rejects linked content instead of following it", () =>
        {
            var root = Path.Combine(folder, "cache-links");
            var path = Create(root, 'a');
            var outside = Path.Combine(folder, "cache-link-target");
            Directory.CreateDirectory(outside);
            File.WriteAllText(Path.Combine(outside, "keep.md"), "keep");
            var link = Path.Combine(path, "linked");
            try { Directory.CreateSymbolicLink(link, outside); }
            catch (Exception error) when (OperatingSystem.IsWindows() && error is IOException or UnauthorizedAccessException)
            { return; } // Windows hosts without Developer Mode may not create symlinks.
            try
            {
                Assert(PayloadCache.Inspect(root, folder, _ => false).Single().State == PayloadCacheState.Unavailable);
                Assert(PayloadCache.DeleteUnused(root, folder, [path], _ => false).Deleted == 0);
                Assert(File.ReadAllText(Path.Combine(outside, "keep.md")) == "keep");
            }
            finally { Directory.Delete(link); }
        });
        foreach (var existingTarget in new[] { false, true })
        {
            check($"Payload leases reject {(existingTarget ? "existing" : "dangling")} file links without touching their targets", () =>
            {
                var root = Path.Combine(folder, "cache-lease-link-" + existingTarget);
                var path = Create(root, 'a');
                Directory.CreateDirectory(Path.Combine(path, "WebView2Runtime"));
                File.WriteAllText(Path.Combine(path, "WebView2Runtime", "msedgewebview2.exe"), "runtime");
                var target = Path.Combine(folder, "lease-link-target-" + existingTarget);
                if (existingTarget) File.WriteAllText(target, "keep");
                var link = Path.Combine(path, ".in-use");
                File.Delete(link);
                try { File.CreateSymbolicLink(link, target); }
                catch (Exception error) when (OperatingSystem.IsWindows() && error is IOException or UnauthorizedAccessException)
                { return; }
                try
                {
                    RejectLease(() => PayloadCache.AcquireLease(path));
                    // Reusing an already extracted payload must validate its lease
                    // too, even though the archive itself does not need to be read.
                    using var archive = new MemoryStream([]);
                    RejectLease(() => PayloadCache.ExtractAndLease(archive, root, new string('a', 64), PayloadCompression.Brotli));
                    Assert(File.Exists(target) == existingTarget);
                    if (existingTarget) Assert(File.ReadAllText(target) == "keep");
                    Assert(PayloadCache.DeleteUnused(root, folder, [path], _ => false).Deleted == 0);
                }
                finally { File.Delete(link); }
            });
        }
        check("Cached extraction rejects linked completion markers before acquiring a lease", () =>
        {
            var root = Path.Combine(folder, "cache-marker-link");
            var path = Create(root, 'a');
            Directory.CreateDirectory(Path.Combine(path, "WebView2Runtime"));
            File.WriteAllText(Path.Combine(path, "WebView2Runtime", "msedgewebview2.exe"), "runtime");
            var target = Path.Combine(folder, "marker-link-target");
            File.WriteAllText(target, new string('a', 64));
            var marker = Path.Combine(path, ".complete");
            File.Delete(marker);
            try { File.CreateSymbolicLink(marker, target); }
            catch (Exception error) when (OperatingSystem.IsWindows() && error is IOException or UnauthorizedAccessException)
            { return; }
            try
            {
                using var archive = new MemoryStream([]);
                RejectLease(() => PayloadCache.ExtractAndLease(archive, root, new string('a', 64), PayloadCompression.Brotli));
                Assert(File.ReadAllText(target) == new string('a', 64));
            }
            finally { File.Delete(marker); }
        });
        check("Cached extraction rejects linked parent directories", () =>
        {
            var root = Path.Combine(folder, "cache-parent-link-target");
            var path = Create(root, 'a');
            Directory.CreateDirectory(Path.Combine(path, "WebView2Runtime"));
            File.WriteAllText(Path.Combine(path, "WebView2Runtime", "msedgewebview2.exe"), "runtime");
            var link = Path.Combine(folder, "cache-parent-link");
            try { Directory.CreateSymbolicLink(link, root); }
            catch (Exception error) when (OperatingSystem.IsWindows() && error is IOException or UnauthorizedAccessException)
            { return; }
            try
            {
                using var archive = new MemoryStream([]);
                RejectLease(() => PayloadCache.ExtractAndLease(archive, link, new string('a', 64), PayloadCompression.Brotli));
                Assert(File.ReadAllText(Path.Combine(path, "Renderer", "index.html")) == "preview");
            }
            finally { Directory.Delete(link); }
        });
    }

    private static void RejectLease(Func<PayloadCache.Lease> acquire)
    {
        try { using var lease = acquire(); }
        catch (IOException) { return; }
        throw new Exception("Linked payload unexpectedly acquired a lease.");
    }
}
