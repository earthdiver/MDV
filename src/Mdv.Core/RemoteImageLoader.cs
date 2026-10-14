using System.Net;

namespace Mdv.Core;

public sealed record RemoteImage(byte[] Bytes, string ContentType);

/// <summary>Fetch opted-in HTTP images without the preview's mixed-content URL upgrade.</summary>
public sealed class RemoteImageLoader : IDisposable
{
    public const int MaxBytes = 32 * 1024 * 1024;
    private readonly HttpClient _client;

    public RemoteImageLoader(HttpMessageHandler? handler = null)
    {
        _client = new HttpClient(handler ?? new HttpClientHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
            MaxConnectionsPerServer = 6,
            AutomaticDecompression = DecompressionMethods.All,
        }) { Timeout = Timeout.InfiniteTimeSpan };
    }

    public static bool IsAllowedUri(Uri uri) => uri.IsAbsoluteUri && uri.Scheme is "http" or "https" &&
        uri.UserInfo.Length == 0 && !uri.Host.Equals("mdv.invalid", StringComparison.OrdinalIgnoreCase) &&
        !uri.Host.EndsWith(".mdv.invalid", StringComparison.OrdinalIgnoreCase);

    public async Task<RemoteImage> LoadAsync(Uri uri, CancellationToken cancellationToken = default)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(20));
        for (var redirects = 0; ; redirects++)
        {
            if (!IsAllowedUri(uri)) throw new HttpRequestException("Unsupported image URL.");
            using var response = await _client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            if (response.StatusCode is HttpStatusCode.MovedPermanently or HttpStatusCode.Found or HttpStatusCode.SeeOther or
                HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect)
            {
                if (redirects >= 5 || response.Headers.Location is not { } location)
                    throw new HttpRequestException("Invalid image redirect.");
                uri = location.IsAbsoluteUri ? location : new Uri(uri, location);
                continue;
            }
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength > MaxBytes) throw new HttpRequestException("Image exceeds 32 MiB.");
            var contentType = response.Content.Headers.ContentType?.MediaType;
            if (contentType is null or "application/octet-stream") contentType = LocalAssets.ContentType(uri.AbsolutePath);
            if (!contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                throw new HttpRequestException("Response is not an image.");
            await using var stream = await response.Content.ReadAsStreamAsync(deadline.Token);
            using var buffer = new MemoryStream();
            var chunk = new byte[8192];
            int count;
            while ((count = await stream.ReadAsync(chunk, deadline.Token)) > 0)
            {
                if (buffer.Length + count > MaxBytes) throw new HttpRequestException("Image exceeds 32 MiB.");
                buffer.Write(chunk, 0, count);
            }
            return new RemoteImage(buffer.ToArray(), contentType);
        }
    }

    public void Dispose() => _client.Dispose();
}
