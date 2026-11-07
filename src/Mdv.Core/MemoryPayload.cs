using System.Formats.Tar;
using System.Security.Cryptography;
using System.Text;

namespace Mdv.Core;

/// <summary>Verified, read-only bundled assets. No payload files are written to disk.</summary>
public sealed class MemoryPayload
{
    private readonly Dictionary<string, byte[]> _files;
    private MemoryPayload(Dictionary<string, byte[]> files) => _files = files;
    public IEnumerable<string> Names => _files.Keys;
    public bool Contains(string name) => _files.ContainsKey(name);
    public Stream? Open(string name) => _files.TryGetValue(name, out var bytes) ? new MemoryStream(bytes, writable: false) : null;
    public string ReadText(string name) => _files.TryGetValue(name, out var bytes) ? Encoding.UTF8.GetString(bytes) : throw new FileNotFoundException("Bundled asset is missing.", name);

    public static MemoryPayload Load(Stream archive, string expectedHash, PayloadCompression compression)
    {
        if (expectedHash.Length != 64 || !expectedHash.All(Uri.IsHexDigit)) throw new ArgumentException("Invalid payload hash.");
        if (!Convert.ToHexString(SHA256.HashData(archive)).Equals(expectedHash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("The bundled rendering assets are damaged.");
        archive.Position = 0;
        var files = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        long total = 0;
        using var decompressor = PortablePayload.OpenDecompressor(archive, compression);
        using var reader = new TarReader(decompressor);
        TarEntry? entry;
        while ((entry = reader.GetNextEntry()) != null)
        {
            var name = entry.Name;
            if (entry.EntryType != TarEntryType.RegularFile || !ValidName(name) || files.ContainsKey(name))
                throw new InvalidDataException("Invalid or duplicate bundled asset.");
            if (entry.Length < 0 || entry.Length > 64 * 1024 * 1024 || (total += entry.Length) > 256 * 1024 * 1024 || files.Count >= 20000)
                throw new InvalidDataException("Bundled assets exceed the memory limit.");
            var bytes = new byte[checked((int)entry.Length)];
            if (bytes.Length != 0) (entry.DataStream ?? throw new InvalidDataException("Missing asset data.")).ReadExactly(bytes);
            files.Add(name, bytes);
        }
        decompressor.CopyTo(Stream.Null); // Validate the compressed frame trailer/checksum.
        if (!files.ContainsKey("Renderer/index.html") || !files.ContainsKey("Renderer/bundle-manifest.json"))
            throw new InvalidDataException("Bundled rendering assets are missing.");
        return new(files);
    }

    public static bool ValidName(string name) => name.Length > 0 && !name.Contains('\\') && !name.Contains(':') &&
        !name.Any(char.IsControl) && !name.Split('/').Any(part => part is "" or "." or "..");

    public Stream? OpenRenderer(Uri uri)
    {
        if (uri.Scheme != "https" || uri.Host != "app.mdv.invalid" || !uri.IsDefaultPort || uri.UserInfo.Length != 0) return null;
        var name = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
        return ValidName(name) ? Open("Renderer/" + name) : null;
    }

    public static string ContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8", ".js" or ".mjs" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8", ".json" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml", ".png" => "image/png", ".jpg" or ".jpeg" => "image/jpeg",
        ".woff" => "font/woff", ".woff2" => "font/woff2", ".ttf" => "font/ttf", ".otf" => "font/otf",
        ".wasm" => "application/wasm", _ => "application/octet-stream",
    };
}
