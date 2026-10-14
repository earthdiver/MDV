using System.IO.Compression;
using System.Net;
using System.Text.Json;

namespace Mdv.Core;

public sealed record QiitaCardImage(string Hash, string ContentType, int Bytes);
public sealed record QiitaSavedCard(string Url, string Title, string Origin, QiitaCardImage? Image);
public sealed record QiitaCardManifest(int Version, DateTimeOffset SavedAt, QiitaSavedCard[] Cards);

/// <summary>Per-document card snapshots. Reading never accesses the network.</summary>
public static class QiitaCardArchive
{
    public const int MaxCards = 128;
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static string PathFor(string document) => Path.GetFullPath(document) + ".mdv-qiita-cards.zip";
    internal static Uri Url(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && RemoteImageLoader.IsAllowedUri(uri)
        ? uri : throw new InvalidDataException("Invalid card URL.");
    private static ZipArchive Open(string document)
    {
        var path = PathFor(document);
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0 || new FileInfo(path).Length > QiitaImageArchive.MaxTotalBytes + 1024 * 1024)
            throw new InvalidDataException("Invalid Qiita card archive.");
        return ZipFile.OpenRead(path);
    }
    private static bool ValidImage(QiitaCardImage image) => image.Hash is { Length: 64 } && image.Hash.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f') &&
        QiitaImageArchive.IsImageType(image.ContentType) && image.Bytes is > 0 and <= RemoteImageLoader.MaxBytes;
    public static QiitaCardManifest? Load(string document)
    {
        if (!File.Exists(PathFor(document))) return null;
        using var zip = Open(document);
        if (zip.Entries.Count > MaxCards + 1 || zip.Entries.Select(e => e.FullName).Distinct().Count() != zip.Entries.Count)
            throw new InvalidDataException("Invalid card archive entries.");
        var entry = zip.GetEntry("manifest.json");
        if (entry is null || entry.Length > 1024 * 1024) throw new InvalidDataException("Invalid card manifest.");
        using var stream = entry.Open();
        var manifest = JsonSerializer.Deserialize<QiitaCardManifest>(stream, Json) ?? throw new InvalidDataException("Missing card manifest.");
        if (manifest.Version != 1 || manifest.Cards is not { Length: > 0 and <= MaxCards } || manifest.Cards.Any(c => c is null) ||
            manifest.Cards.Select(c => c.Url).Distinct().Count() != manifest.Cards.Length) throw new InvalidDataException("Invalid card manifest.");
        long total = 0;
        foreach (var card in manifest.Cards)
        {
            Url(card.Url); var origin = Url(card.Origin);
            if (origin.GetLeftPart(UriPartial.Authority) != card.Origin || card.Title is null || card.Title.Length > 16384)
                throw new InvalidDataException("Invalid saved card.");
            if (card.Image is { } image)
            {
                if (!ValidImage(image) || zip.GetEntry("images/" + image.Hash)?.Length != image.Bytes) throw new InvalidDataException("Invalid card image.");
                total += image.Bytes;
            }
        }
        if (total > QiitaImageArchive.MaxTotalBytes) throw new InvalidDataException("Card images exceed 256 MiB.");
        return manifest;
    }
    public static RemoteImage Read(string document, QiitaCardImage image)
    {
        if (!ValidImage(image)) throw new InvalidDataException("Invalid card image.");
        using var zip = Open(document);
        var entry = zip.GetEntry("images/" + image.Hash);
        if (entry?.Length != image.Bytes) throw new InvalidDataException("Missing card image.");
        using var stream = entry.Open(); var bytes = new byte[image.Bytes]; stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1 || QiitaImageArchive.Hash(bytes) != image.Hash) throw new InvalidDataException("Card image checksum mismatch.");
        return new(bytes, image.ContentType);
    }
}

/// <summary>Only invoked by an explicit import command; no cookies or scripts.</summary>
public sealed class QiitaCardImporter : IDisposable
{
    private readonly HttpClient _client;
    private readonly RemoteImageLoader _images;
    public QiitaCardImporter(HttpMessageHandler? handler = null, HttpMessageHandler? imageHandler = null, string? userAgent = null)
    {
        _client = new(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false, AutomaticDecompression = DecompressionMethods.All }) { Timeout = TimeSpan.FromSeconds(30) };
        if (!string.IsNullOrWhiteSpace(userAgent)) _client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", userAgent);
        _images = new(imageHandler);
    }
    public async Task<QiitaCardManifest> ImportAsync(string document, IEnumerable<string> sources, CancellationToken token = default)
    {
        var urls = sources.Select(s => QiitaCardArchive.Url(s).AbsoluteUri).Distinct().ToArray();
        if (urls.Length is 0 or > QiitaCardArchive.MaxCards) throw new InvalidDataException("Import requires 1–128 link cards.");
        var path = QiitaCardArchive.PathFor(document); var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var cards = new List<QiitaSavedCard>(); var hashes = new HashSet<string>(); long total = 0;
            using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
            {
                foreach (var url in urls)
                {
                    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token); deadline.CancelAfter(TimeSpan.FromSeconds(30));
                    using var response = await _client.GetAsync("https://qiita.com/api/ogp?url=" + Uri.EscapeDataString(url), HttpCompletionOption.ResponseHeadersRead, deadline.Token);
                    response.EnsureSuccessStatusCode();
                    if (response.Content.Headers.ContentType?.MediaType != "application/json" || response.Content.Headers.ContentLength > 1024 * 1024)
                        throw new InvalidDataException("Invalid Qiita card response.");
                    await using var input = await response.Content.ReadAsStreamAsync(deadline.Token);
                    using var buffer = new MemoryStream(); var chunk = new byte[8192]; int read;
                    while ((read = await input.ReadAsync(chunk, deadline.Token)) != 0)
                    {
                        if (buffer.Length + read > 1024 * 1024) throw new InvalidDataException("Card response is too large.");
                        buffer.Write(chunk, 0, read);
                    }
                    var data = JsonSerializer.Deserialize<Ogp>(buffer.ToArray(), QiitaCardArchive.Json) ?? throw new InvalidDataException("Missing card metadata.");
                    var origin = QiitaCardArchive.Url(data.Url).GetLeftPart(UriPartial.Authority);
                    var title = data.Title ?? "";
                    if (title.Length > 16384) throw new InvalidDataException("Card title is too long.");
                    QiitaCardImage? image = null;
                    if (!string.IsNullOrEmpty(data.Image))
                    {
                        // Keep a failed refresh atomic. Do not silently replace a saved thumbnail with a network failure.
                        var saved = await _images.LoadAsync(QiitaCardArchive.Url(data.Image), token);
                        if (!QiitaImageArchive.IsImageType(saved.ContentType) || saved.Bytes.Length == 0) throw new InvalidDataException("Invalid card thumbnail.");
                        total += saved.Bytes.Length;
                        if (total > QiitaImageArchive.MaxTotalBytes) throw new InvalidDataException("Card images exceed 256 MiB.");
                        var hash = QiitaImageArchive.Hash(saved.Bytes); image = new(hash, saved.ContentType, saved.Bytes.Length);
                        if (hashes.Add(hash))
                        {
                            await using var entry = zip.CreateEntry("images/" + hash, CompressionLevel.NoCompression).Open();
                            await entry.WriteAsync(saved.Bytes, token);
                        }
                    }
                    cards.Add(new(url, title, origin, image));
                }
                await using var info = zip.CreateEntry("manifest.json", CompressionLevel.Fastest).Open();
                await JsonSerializer.SerializeAsync(info, new QiitaCardManifest(1, DateTimeOffset.UtcNow, cards.ToArray()), QiitaCardArchive.Json, token);
            }
            token.ThrowIfCancellationRequested(); File.Move(temporary, path, true);
            return QiitaCardArchive.Load(document)!;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public void Dispose() { _client.Dispose(); _images.Dispose(); }
    private sealed record Ogp(string? Title, string Url, string? Image);
}
