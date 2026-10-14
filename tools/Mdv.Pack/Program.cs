using System.IO.Compression;
using System.Formats.Tar;
using System.Security.Cryptography;
using System.Diagnostics;
using Mdv.Core;

if (args.Length == 3 && args[0] == "--verify")
{
    VerifyPayload(Path.GetFullPath(args[1]), Path.GetFullPath(args[2]));
    return 0;
}
if (args.Length is not (2 or 3))
{
    Console.Error.WriteLine("Usage: Mdv.Pack <payload-directory> <output.br|output.zst> [quality: Brotli 0-11/default 11, Zstd 1-22/default 3]");
    Console.Error.WriteLine("       Mdv.Pack --verify <payload-directory> <output.br|output.zst>");
    return 1;
}
var source = Path.GetFullPath(args[0]);
var destination = Path.GetFullPath(args[1]);
var codec = Codec(destination);
var quality = args.Length == 3 ? int.Parse(args[2], System.Globalization.CultureInfo.InvariantCulture) : codec == PayloadCompression.Brotli ? 11 : 3;
if (quality < (codec == PayloadCompression.Brotli ? 0 : 1) || quality > (codec == PayloadCompression.Brotli ? 11 : 22)) throw new ArgumentOutOfRangeException(nameof(quality));
foreach (var name in new[] { "Renderer/index.html", "Samples/welcome.md", "WebView2Runtime/msedgewebview2.exe", "LICENSE" })
    if (!File.Exists(Path.Combine(source, name))) throw new FileNotFoundException("Missing payload file: " + name);
Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
var temporary = destination + ".tmp";
var timer = Stopwatch.StartNew();
long originalBytes = 0;
try
{
    if (File.Exists(temporary)) File.Delete(temporary);
    using (var output = File.Create(temporary))
    // Keep the complete Fixed Version WebView2 distribution, including locale
    // data and software rendering fallbacks. Spend build time on lossless
    // compression instead of removing files needed on other Windows systems.
    using (var compressor = Compress(output, codec, quality))
    using (var archive = new TarWriter(compressor, TarEntryFormat.Pax))
    {
        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
        {
            using var input = File.OpenRead(file);
            var entry = new PaxTarEntry(TarEntryType.RegularFile, Path.GetRelativePath(source, file).Replace('\\', '/'),
                new Dictionary<string, string> { ["atime"] = "1767225600", ["ctime"] = "1767225600" })
            {
                ModificationTime = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero),
                DataStream = input,
            };
            archive.WriteEntry(entry);
            originalBytes += input.Length;
        }
    }
    VerifyPayload(source, temporary, codec);
    File.Move(temporary, destination, true);
    using var stream = File.OpenRead(destination);
    File.WriteAllText(destination + ".sha256", Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant());
}
finally { if (File.Exists(temporary)) File.Delete(temporary); }
Console.WriteLine($"Embedded payload: {originalBytes / 1048576d:F1} -> {new FileInfo(destination).Length / 1048576d:F1} MiB ({codec} quality {quality}, {timer.Elapsed.TotalSeconds:F1}s)");
return 0;

static PayloadCompression Codec(string path) => Path.GetExtension(path) switch {
    ".br" => PayloadCompression.Brotli, ".zst" => PayloadCompression.Zstandard,
    _ => throw new ArgumentException("Use .br or .zst for the payload file.") };

static Stream Compress(Stream output, PayloadCompression codec, int quality)
{
    if (codec == PayloadCompression.Brotli) return new BrotliStream(output, new BrotliCompressionOptions { Quality = quality });
    var stream = new ZstdSharp.CompressionStream(output, quality);
    stream.SetParameter(ZstdSharp.Unsafe.ZSTD_cParameter.ZSTD_c_checksumFlag, 1);
    stream.SetParameter(ZstdSharp.Unsafe.ZSTD_cParameter.ZSTD_c_windowLog, 27);
    return stream;
}

static void VerifyPayload(string source, string compressed, PayloadCompression? codec = null)
{
    var remaining = Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories)
        .ToDictionary(path => Path.GetRelativePath(source, path).Replace('\\', '/'), StringComparer.Ordinal);
    var count = remaining.Count;
    using var input = File.OpenRead(compressed);
    using var decompressor = PortablePayload.OpenDecompressor(input, codec ?? Codec(compressed));
    using var reader = new TarReader(decompressor);
    TarEntry? entry;
    while ((entry = reader.GetNextEntry()) != null)
    {
        if (entry.EntryType != TarEntryType.RegularFile || !remaining.Remove(entry.Name, out var original))
            throw new InvalidDataException("Unexpected or duplicated payload entry: " + entry.Name);
        using var file = File.OpenRead(original);
        var restored = entry.DataStream ?? Stream.Null;
        if (entry.Length != file.Length || !SHA256.HashData(file).AsSpan().SequenceEqual(SHA256.HashData(restored)))
            throw new InvalidDataException("Payload content differs: " + entry.Name);
    }
    decompressor.CopyTo(Stream.Null);
    if (remaining.Count != 0) throw new InvalidDataException("Payload files are missing.");
    Console.WriteLine($"Verified all {count} payload files against their originals (SHA-256).");
}
