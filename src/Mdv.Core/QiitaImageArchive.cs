using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Mdv.Core;

public sealed record QiitaSavedImage(string OriginalUrl, string ServiceUrl, string Hash, string ContentType, int Bytes, bool Direct = false);
public sealed record QiitaImageManifest(int Version, string ArticleUrl, DateTimeOffset SavedAt, QiitaSavedImage[] Images);

/// <summary>Explicit, per-document snapshots. Opening an archive never accesses the network.</summary>
public static class QiitaImageArchive
{
    public const long MaxTotalBytes = 256L * 1024 * 1024;
    public const int MaxImages = 128;
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly Regex HashPattern = new("^[a-f0-9]{64}$", RegexOptions.CultureInvariant);
    public static string PathFor(string documentPath, bool github = false) => Path.GetFullPath(documentPath) + (github ? ".mdv-github-images.zip" : ".mdv-qiita-images.zip");
    public static bool IsImageType(string type) => type is "image/png" or "image/jpeg" or "image/gif" or "image/webp" or "image/avif" or "image/svg+xml";
    public static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    private static void CheckArchivePath(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException("Linked Qiita image archives are not supported.");
    }

    public static QiitaImageManifest? Load(string documentPath, bool github = false)
    {
        var path = PathFor(documentPath, github);
        if (!File.Exists(path)) return null;
        CheckArchivePath(path);
        if (new FileInfo(path).Length > MaxTotalBytes + 1024 * 1024) throw new InvalidDataException("Qiita image archive exceeds 256 MiB.");
        using var zip = ZipFile.OpenRead(path);
        if (zip.Entries.Count > MaxImages + 1 || zip.Entries.Select(e => e.FullName).Distinct().Count() != zip.Entries.Count)
            throw new InvalidDataException("Invalid Qiita image archive entries.");
        var entry = zip.GetEntry("manifest.json");
        if (entry is null || entry.Length > 512 * 1024) throw new InvalidDataException("Invalid Qiita image manifest.");
        using var stream = entry.Open();
        var manifest = JsonSerializer.Deserialize<QiitaImageManifest>(stream, Json) ?? throw new InvalidDataException("Missing Qiita image manifest.");
        if (manifest.Version is not (1 or 2) || manifest.Images is not { Length: > 0 and <= MaxImages } || manifest.Images.Any(i => i is null) ||
            manifest.Images.Select(i => i.OriginalUrl).Distinct().Count() != manifest.Images.Length)
            throw new InvalidDataException("Invalid Qiita image manifest.");
        if (manifest.Version == 1 || manifest.Images.Any(i => !i.Direct) || !string.IsNullOrEmpty(manifest.ArticleUrl))
        {
            if (github) GithubImageImporter.DocumentUri(manifest.ArticleUrl);
            else QiitaImageImporter.ArticleUri(manifest.ArticleUrl);
        }
        long total = 0;
        foreach (var image in manifest.Images)
        {
            if (image.Hash is null || !HashPattern.IsMatch(image.Hash) || !IsImageType(image.ContentType) ||
                image.Bytes is <= 0 or > RemoteImageLoader.MaxBytes ||
                (image.Direct ? manifest.Version != 2 || image.OriginalUrl != image.ServiceUrl ||
                    !Uri.TryCreate(image.OriginalUrl, UriKind.Absolute, out var direct) || !RemoteImageLoader.IsAllowedUri(direct) || direct.AbsoluteUri != image.OriginalUrl :
                    github ? GithubImageImporter.ResolveImage(manifest.ArticleUrl, image.OriginalUrl)?.AbsoluteUri != image.ServiceUrl :
                    QiitaImageImporter.OriginalUrl(image.ServiceUrl) is not { } original || original != image.OriginalUrl) ||
                zip.GetEntry("images/" + image.Hash)?.Length != image.Bytes)
                throw new InvalidDataException("Invalid saved Qiita image.");
            total += image.Bytes;
        }
        if (total > MaxTotalBytes) throw new InvalidDataException("Qiita images exceed 256 MiB.");
        return manifest;
    }

    public static RemoteImage Read(string documentPath, QiitaSavedImage image, bool github = false)
    {
        if (!HashPattern.IsMatch(image.Hash) || image.Bytes is <= 0 or > RemoteImageLoader.MaxBytes) throw new InvalidDataException("Invalid saved image.");
        var path = PathFor(documentPath, github);
        CheckArchivePath(path);
        using var zip = ZipFile.OpenRead(path);
        var entry = zip.GetEntry("images/" + image.Hash);
        if (entry?.Length != image.Bytes) throw new InvalidDataException("Saved image is missing.");
        using var input = entry.Open();
        var bytes = new byte[image.Bytes];
        input.ReadExactly(bytes);
        if (input.ReadByte() != -1 || Hash(bytes) != image.Hash) throw new InvalidDataException("Saved image checksum mismatch.");
        return new RemoteImage(bytes, image.ContentType);
    }
}

public sealed class QiitaImageImporter : IDisposable
{
    private readonly HttpClient _client;
    private static readonly Regex ArticlePath = new("^/[A-Za-z0-9_-]+/items/[a-f0-9]{20}/?$", RegexOptions.CultureInvariant);
    // This extracts candidate URLs, not trusted HTML. Every candidate is then
    // restricted to Qiita's CDN and matched against this document's image URLs.
    private static readonly Regex Images = new("<img\\b(?:\"[^\"]*\"|'[^']*'|[^'\">])*>", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly Regex Source = new("\\ssrc\\s*=\\s*(?:\"(?<url>[^\"]*)\"|'(?<url>[^']*)'|(?<url>[^\\s>]+))", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly Regex SourceSet = new("\\ssrcset\\s*=\\s*(?:\"(?<url>[^\"]*)\"|'(?<url>[^']*)'|(?<url>[^\\s>]+))", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly Regex StandardDensity = new("(?:^|,\\s*)(?<url>\\S+)\\s+1x(?:\\s*,|\\s*$)", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

    public QiitaImageImporter(HttpMessageHandler? handler = null, string? userAgent = null)
    {
        _client = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false, AutomaticDecompression = DecompressionMethods.All });
        _client.Timeout = TimeSpan.FromSeconds(30);
        if (!string.IsNullOrWhiteSpace(userAgent)) _client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", userAgent);
    }

    public static Uri ArticleUri(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Host != "qiita.com" ||
            !uri.IsDefaultPort || uri.UserInfo.Length != 0 || !ArticlePath.IsMatch(uri.AbsolutePath))
            throw new ArgumentException(UiLanguage.Text("公開Qiita記事のURLを入力してください。", "Enter a public Qiita article URL."));
        return new Uri(uri.GetLeftPart(UriPartial.Path));
    }

    public static string? OriginalUrl(string? serviceUrl)
    {
        if (!Uri.TryCreate(serviceUrl, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
            uri.Host != "qiita-user-contents.imgix.net" || !uri.IsDefaultPort || uri.UserInfo.Length != 0) return null;
        var decoded = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
        return Uri.TryCreate(decoded, UriKind.Absolute, out var original) && original.Scheme is "https" or "http" && original.UserInfo.Length == 0
            ? original.AbsoluteUri : null;
    }

    public static Dictionary<string, string> FindImages(string html, IEnumerable<string> documentSources)
    {
        var wanted = documentSources.Where(s => Uri.TryCreate(s, UriKind.Absolute, out var u) && u.Scheme is "https" or "http")
            .Select(s => new Uri(s).AbsoluteUri).ToHashSet(StringComparer.Ordinal);
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (Match tag in Images.Matches(html))
        {
            var src = WebUtility.HtmlDecode(Source.Match(tag.Value).Groups["url"].Value);
            var original = OriginalUrl(src);
            if (original is null || !wanted.Contains(original)) continue;
            // Qiita's src is the full-size fallback. Browsers display the
            // signed 1x srcset variant (currently capped at 1400px) instead.
            // Preserve the published signature rather than inventing parameters.
            var srcset = WebUtility.HtmlDecode(SourceSet.Match(tag.Value).Groups["url"].Value);
            var standard = StandardDensity.Match(srcset).Groups["url"].Value;
            if (OriginalUrl(standard) == original) result[original] = standard;
            else result.TryAdd(original, src);
        }
        return result;
    }

    internal async Task<(byte[] Bytes, string Type)> FetchAsync(Uri uri, bool image, CancellationToken token)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        token = deadline.Token;
        for (var redirect = 0; ; redirect++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.TryAddWithoutValidation("Accept", image ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" : "text/html");
            using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            if (response.StatusCode is HttpStatusCode.MovedPermanently or HttpStatusCode.Found or HttpStatusCode.SeeOther or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect)
            {
                if (redirect >= 3 || response.Headers.Location is not { } location) throw new HttpRequestException("Invalid Qiita redirect.");
                var next = location.IsAbsoluteUri ? location : new Uri(uri, location);
                if (image ? OriginalUrl(next.AbsoluteUri) is null : ArticleUri(next.AbsoluteUri).AbsolutePath.TrimEnd('/').Split('/')[^1] != ArticleUri(uri.AbsoluteUri).AbsolutePath.TrimEnd('/').Split('/')[^1])
                    throw new HttpRequestException("Unexpected Qiita redirect.");
                uri = next; continue;
            }
            response.EnsureSuccessStatusCode();
            var type = response.Content.Headers.ContentType?.MediaType ?? "";
            if (image ? !QiitaImageArchive.IsImageType(type) : type != "text/html") throw new InvalidDataException("Unexpected Qiita content type.");
            var limit = image ? RemoteImageLoader.MaxBytes : 8 * 1024 * 1024;
            if (response.Content.Headers.ContentLength > limit) throw new InvalidDataException("Qiita response is too large.");
            using var output = new MemoryStream();
            await using var input = await response.Content.ReadAsStreamAsync(token);
            var buffer = new byte[65536];
            int read;
            while ((read = await input.ReadAsync(buffer, token)) != 0)
            {
                if (output.Length + read > limit) throw new InvalidDataException("Qiita response is too large.");
                await output.WriteAsync(buffer.AsMemory(0, read), token);
            }
            return (output.ToArray(), type);
        }
    }

    public async Task<Dictionary<string, string>> ResolveCdnImagesAsync(string articleUrl, IEnumerable<string> documentSources, CancellationToken cancellationToken = default, bool requireMatch = true)
    {
        var (html, _) = await FetchAsync(ArticleUri(articleUrl), false, cancellationToken);
        var sources = FindImages(System.Text.Encoding.UTF8.GetString(html), documentSources);
        if (requireMatch && sources.Count == 0) throw new InvalidDataException(UiLanguage.Text("記事内に一致する画像がありません。", "No matching images in the article."));
        return sources;
    }

    public async Task<QiitaImageManifest> ImportAsync(string documentPath, string articleUrl, IEnumerable<string> documentSources, CancellationToken cancellationToken = default)
    {
        var uri = ArticleUri(articleUrl);
        var (html, _) = await FetchAsync(uri, false, cancellationToken);
        var sources = FindImages(System.Text.Encoding.UTF8.GetString(html), documentSources);
        if (sources.Count == 0) throw new InvalidDataException(UiLanguage.Text("この記事に、開いている文書と一致する本家画像がありません。", "The article has no service images matching the open document."));
        if (sources.Count > QiitaImageArchive.MaxImages) throw new InvalidDataException("Too many Qiita images (maximum 128).");
        var path = QiitaImageArchive.PathFor(documentPath);
        // A failed/cancelled refresh must preserve the previous snapshot.
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var images = new List<QiitaSavedImage>();
            long total = 0;
            using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
            {
                var written = new HashSet<string>();
                foreach (var (original, service) in sources)
                {
                    var (bytes, type) = await FetchAsync(new Uri(service), true, cancellationToken);
                    total += bytes.Length;
                    if (bytes.Length == 0 || total > QiitaImageArchive.MaxTotalBytes) throw new InvalidDataException("Qiita images exceed size limits.");
                    var hash = QiitaImageArchive.Hash(bytes);
                    if (written.Add(hash))
                    {
                        await using var entry = zip.CreateEntry("images/" + hash, CompressionLevel.NoCompression).Open();
                        await entry.WriteAsync(bytes, cancellationToken);
                    }
                    images.Add(new(original, service, hash, type, bytes.Length));
                }
                var manifest = new QiitaImageManifest(1, uri.AbsoluteUri, DateTimeOffset.UtcNow, images.ToArray());
                await using var info = zip.CreateEntry("manifest.json", CompressionLevel.Fastest).Open();
                await JsonSerializer.SerializeAsync(info, manifest, QiitaImageArchive.Json, cancellationToken);
            }
            cancellationToken.ThrowIfCancellationRequested();
            File.Move(temporary, path, true);
            return QiitaImageArchive.Load(documentPath)!;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public void Dispose() => _client.Dispose();
}
