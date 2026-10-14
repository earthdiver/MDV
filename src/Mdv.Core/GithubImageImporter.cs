using System.IO.Compression;
using System.Net;
using System.Text.Json;

namespace Mdv.Core;

/// <summary>Snapshots public GitHub repository images without changing authored paths.</summary>
public sealed class GithubImageImporter : IDisposable
{
    private readonly HttpClient _client;
    public GithubImageImporter(HttpMessageHandler? handler = null, string? userAgent = null)
    {
        _client = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false, AutomaticDecompression = DecompressionMethods.All });
        if (!string.IsNullOrWhiteSpace(userAgent)) _client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", userAgent);
    }

    public static Uri DocumentUri(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https" || !uri.IsDefaultPort || uri.UserInfo.Length != 0)
            throw new ArgumentException("Enter a public GitHub blob URL or raw.githubusercontent.com URL.");
        var parts = uri.AbsolutePath.Split('/');
        if (uri.Host == "github.com" && parts.Length >= 6 && parts[3] == "blob" && parts.Skip(1).All(p => p.Length > 0))
            return new Uri("https://raw.githubusercontent.com/" + string.Join('/', parts.Skip(1).Where((_, i) => i != 2)));
        if (IsRawImage(uri)) return new Uri(uri.GetLeftPart(UriPartial.Path));
        throw new ArgumentException("Enter a public GitHub blob URL or raw.githubusercontent.com URL.");
    }

    private static bool IsRawImage(Uri uri) => uri.Scheme == "https" && uri.Host == "raw.githubusercontent.com" &&
        uri.IsDefaultPort && uri.UserInfo.Length == 0 && uri.AbsolutePath.Split('/').Length >= 5;

    public static Uri? ResolveImage(string documentUrl, string? source)
    {
        var document = DocumentUri(documentUrl);
        if (string.IsNullOrWhiteSpace(source) || source.Contains('\\')) return null;
        source = source.Trim();
        if (!source.StartsWith('/') && Uri.TryCreate(source, UriKind.Absolute, out var absolute))
        {
            if (IsRawImage(absolute)) return new Uri(absolute.GetLeftPart(UriPartial.Path));
            try { return DocumentUri(source); } catch (ArgumentException) { return null; }
        }
        if (source.StartsWith("//") || source.StartsWith('#') || source.Contains(':')) return null;
        var parts = document.AbsolutePath.Split('/');
        // Raw URLs with refs/heads or refs/tags use a two-segment ref prefix.
        var rootCount = parts.Length > 6 && parts[3] == "refs" && parts[4] is "heads" or "tags" ? 6 : 4;
        var root = "https://raw.githubusercontent.com" + string.Join('/', parts.Take(rootCount)) + "/";
        var resolved = new Uri(source.StartsWith('/') ? new Uri(root) : document, source.TrimStart('/'));
        return resolved.AbsoluteUri.StartsWith(root, StringComparison.Ordinal) ? new Uri(resolved.GetLeftPart(UriPartial.Path)) : null;
    }

    private async Task<(byte[] Bytes, string Type)> FetchAsync(Uri uri, CancellationToken token)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        token = deadline.Token;
        for (var redirect = 0; ; redirect++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.TryAddWithoutValidation("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8");
            using var response = await _client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
            if (response.StatusCode is HttpStatusCode.MovedPermanently or HttpStatusCode.Found or HttpStatusCode.SeeOther or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect)
            {
                if (redirect >= 3 || response.Headers.Location is not { } location) throw new HttpRequestException("Invalid GitHub redirect.");
                var next = location.IsAbsoluteUri ? location : new Uri(uri, location);
                if (!IsRawImage(next)) throw new HttpRequestException("Unexpected GitHub image redirect.");
                uri = next; continue;
            }
            response.EnsureSuccessStatusCode();
            var type = response.Content.Headers.ContentType?.MediaType ?? "";
            if (type == "application/octet-stream") type = LocalAssets.ContentType(uri.AbsolutePath);
            if (!QiitaImageArchive.IsImageType(type)) throw new InvalidDataException("Unexpected GitHub content type.");
            var limit = RemoteImageLoader.MaxBytes;
            if (response.Content.Headers.ContentLength > limit) throw new InvalidDataException("GitHub response is too large.");
            using var output = new MemoryStream();
            await using var input = await response.Content.ReadAsStreamAsync(token);
            var buffer = new byte[65536];
            int read;
            while ((read = await input.ReadAsync(buffer, token)) != 0)
            {
                if (output.Length + read > limit) throw new InvalidDataException("GitHub response is too large.");
                await output.WriteAsync(buffer.AsMemory(0, read), token);
            }
            return (output.ToArray(), type);
        }
    }

    public async Task<QiitaImageManifest> ImportAsync(string documentPath, string articleUrl, IEnumerable<string> documentSources, CancellationToken cancellationToken = default)
    {
        var uri = DocumentUri(articleUrl);
        var sources = documentSources.Distinct(StringComparer.Ordinal)
            .Select(source => (source, uri: ResolveImage(articleUrl, source)))
            .Where(item => item.uri != null).ToDictionary(item => item.source, item => item.uri!.AbsoluteUri);
        if (sources.Count == 0) throw new InvalidDataException("No repository images found in this document.");
        if (sources.Count > QiitaImageArchive.MaxImages) throw new InvalidDataException("Too many images (maximum 128).");
        var path = QiitaImageArchive.PathFor(documentPath, github: true);
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
                    var (bytes, type) = await FetchAsync(new Uri(service), cancellationToken);
                    total += bytes.Length;
                    if (bytes.Length == 0 || total > QiitaImageArchive.MaxTotalBytes) throw new InvalidDataException("GitHub images exceed size limits.");
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
            return QiitaImageArchive.Load(documentPath, github: true)!;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public void Dispose() => _client.Dispose();
}
