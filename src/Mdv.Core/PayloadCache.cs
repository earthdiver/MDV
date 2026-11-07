using System.Diagnostics;

namespace Mdv.Core;

public enum PayloadCacheState { Unused, Current, InUse, Untracked, Unavailable }
public sealed record PayloadCacheEntry(string Path, long Bytes, DateTime ModifiedUtc, PayloadCacheState State);
public sealed record PayloadCacheCleanup(int Deleted, int Skipped, long FreedBytes);

/// <summary>Manages only completed MDV payloads, never browser profiles or .NET caches.</summary>
public static class PayloadCache
{
    private const string LeaseName = ".in-use";

    public sealed class Lease(string path, FileStream stream) : IDisposable
    {
        public string Path { get; } = path;
        public void Dispose() => stream.Dispose();
    }

    public static Lease ExtractAndLease(Stream archive, string cacheRoot, string hash, PayloadCompression compression)
    {
        ValidateHash(hash);
        // Extraction and the first lease are atomic with respect to cleanup. Extract's
        // existing named mutex is reentrant on this thread, including for older builds.
        using var mutex = new Mutex(false, "MDV.Payload." + hash.ToLowerInvariant());
        if (!Enter(mutex, TimeSpan.FromMinutes(2))) throw new IOException("Timed out waiting for the payload cache.");
        try
        {
            CheckParents(System.IO.Path.GetFullPath(cacheRoot));
            var path = PortablePayload.Extract(archive, cacheRoot, hash, compression);
            return OpenLease(path);
        }
        finally { mutex.ReleaseMutex(); }
    }

    public static Lease AcquireLease(string path)
    {
        path = System.IO.Path.GetFullPath(path);
        var hash = System.IO.Path.GetFileName(path);
        ValidateHash(hash);
        using var mutex = new Mutex(false, "MDV.Payload." + hash.ToLowerInvariant());
        if (!Enter(mutex, TimeSpan.FromSeconds(2))) throw new IOException("The payload cache is busy.");
        try
        {
            ValidatePayload(System.IO.Path.GetDirectoryName(path)!, path);
            return OpenLease(path);
        }
        finally { mutex.ReleaseMutex(); }
    }

    private static Lease OpenLease(string path)
    {
        ValidatePayload(System.IO.Path.GetDirectoryName(path)!, path);
        var file = System.IO.Path.Combine(path, LeaseName);
        // CreateNew does not follow an existing dangling link. Validate existing
        // entries as well before opening a shared lifetime handle.
        if (!File.Exists(file)) { using var created = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.None); }
        if (File.GetAttributes(file).HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Linked payload leases cannot be used.");
        return new(path, new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read));
    }

    public static IReadOnlyList<PayloadCacheEntry> Inspect(string cacheRoot, string currentPath,
        Func<string, bool>? usedByProcess = null)
    {
        cacheRoot = System.IO.Path.GetFullPath(cacheRoot);
        if (!Directory.Exists(cacheRoot)) return [];
        CheckParents(cacheRoot);
        var entries = new List<PayloadCacheEntry>();
        foreach (var path in Directory.EnumerateDirectories(cacheRoot))
        {
            if (!IsHash(System.IO.Path.GetFileName(path))) continue;
            try
            {
                ValidatePayload(cacheRoot, path);
                var bytes = Measure(path);
                using var mutex = new Mutex(false, "MDV.Payload." + System.IO.Path.GetFileName(path));
                var state = PayloadCacheState.InUse;
                if (Enter(mutex, TimeSpan.Zero))
                {
                    try { state = SamePath(path, currentPath) ? PayloadCacheState.Current :
                        IsInUse(path, usedByProcess) ? PayloadCacheState.InUse :
                        !File.Exists(System.IO.Path.Combine(path, LeaseName)) ? PayloadCacheState.Untracked : PayloadCacheState.Unused; }
                    finally { mutex.ReleaseMutex(); }
                }
                entries.Add(new(path, bytes, Directory.GetLastWriteTimeUtc(path), state));
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            { entries.Add(new(path, 0, DateTime.MinValue, PayloadCacheState.Unavailable)); }
        }
        return entries.OrderByDescending(entry => entry.ModifiedUtc).ToArray();
    }

    public static PayloadCacheCleanup DeleteUnused(string cacheRoot, string currentPath,
        IEnumerable<string> candidates, Func<string, bool>? usedByProcess = null, bool allowUntracked = false)
    {
        cacheRoot = System.IO.Path.GetFullPath(cacheRoot);
        CheckParents(cacheRoot);
        var deleted = 0;
        var skipped = 0;
        long bytes = 0;
        foreach (var candidate in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var path = System.IO.Path.GetFullPath(candidate);
            var hash = System.IO.Path.GetFileName(path);
            if (!IsHash(hash) || SamePath(path, currentPath)) { skipped++; continue; }
            using var mutex = new Mutex(false, "MDV.Payload." + hash.ToLowerInvariant());
            if (!Enter(mutex, TimeSpan.Zero)) { skipped++; continue; }
            try
            {
                // Recheck every condition after the dialog was displayed, under the
                // same lock used by startup. Failed checks leave the directory alone.
                ValidatePayload(cacheRoot, path);
                var size = Measure(path);
                if ((!allowUntracked && !File.Exists(System.IO.Path.Combine(path, LeaseName))) || IsInUse(path, usedByProcess)) { skipped++; continue; }
                Directory.Delete(path, recursive: true);
                deleted++;
                bytes += size;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            { skipped++; }
            finally { mutex.ReleaseMutex(); }
        }
        return new(deleted, skipped, bytes);
    }

    private static bool IsInUse(string path, Func<string, bool>? usedByProcess)
    {
        var file = System.IO.Path.Combine(path, LeaseName);
        if (File.Exists(file))
        {
            try { using var probe = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return true; }
        }
        return (usedByProcess ?? HasRunningRuntime)(path);
    }

    private static bool HasRunningRuntime(string path)
    {
        if (!OperatingSystem.IsWindows()) return false;
        // A child process can outlive the host's shutdown timeout and lease.
        // Inaccessible process paths are treated conservatively.
        var prefix = path + System.IO.Path.DirectorySeparatorChar;
        foreach (var name in new[] { "msedgewebview2", "ruby", "rubyw" })
        {
            var processes = Process.GetProcessesByName(name);
            try
            {
                foreach (var process in processes)
                {
                    try
                    {
                        if (process.HasExited) continue;
                        var executable = process.MainModule?.FileName;
                        if (executable == null || executable.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return true;
                    }
                    catch (InvalidOperationException) { /* Process exited during enumeration. */ }
                    catch (System.ComponentModel.Win32Exception) { return true; }
                }
            }
            finally { foreach (var process in processes) process.Dispose(); }
        }
        return false;
    }

    private static void ValidatePayload(string root, string path)
    {
        if (!SamePath(System.IO.Path.GetDirectoryName(path)!, root)) throw new IOException("Not a payload cache directory.");
        CheckParents(path);
        var hash = System.IO.Path.GetFileName(path);
        var marker = System.IO.Path.Combine(path, ".complete");
        if (!IsHash(hash) || !File.Exists(marker) || new FileInfo(marker).Length != 64 ||
            File.GetAttributes(marker).HasFlag(FileAttributes.ReparsePoint) || File.ReadAllText(marker) != hash)
            throw new IOException("Not a completed payload cache.");
    }

    private static long Measure(string path)
    {
        long bytes = 0;
        foreach (var entry in new DirectoryInfo(path).EnumerateFileSystemInfos())
        {
            if (entry.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Linked cache files cannot be removed.");
            bytes = checked(bytes + (entry is DirectoryInfo ? Measure(entry.FullName) : ((FileInfo)entry).Length));
        }
        return bytes;
    }

    private static void CheckParents(string path)
    {
        for (var directory = new DirectoryInfo(path); directory != null; directory = directory.Parent)
        {
            FileAttributes attributes;
            try { attributes = File.GetAttributes(directory.FullName); }
            catch (Exception error) when (error is FileNotFoundException or DirectoryNotFoundException) { continue; }
            if (attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Linked cache directories cannot be managed.");
        }
    }

    private static bool SamePath(string left, string right) => string.Equals(
        System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(left)),
        System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(right)), StringComparison.OrdinalIgnoreCase);
    private static bool IsHash(string hash) => hash.Length == 64 && hash.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
    private static void ValidateHash(string hash)
    { if (hash.Length != 64 || !hash.All(Uri.IsHexDigit)) throw new ArgumentException("Invalid payload hash."); }
    private static bool Enter(Mutex mutex, TimeSpan timeout)
    {
        try { return mutex.WaitOne(timeout); }
        catch (AbandonedMutexException) { return true; }
    }
}
