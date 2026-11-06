using System.IO.Compression;
using System.Text.Json;

namespace Mdv.Core;

public sealed record ImageImportFailure(string Source, string Reason, bool UsedPrevious = false);
public sealed record ImageImportResult(QiitaImageManifest? Manifest, ImageImportFailure[] Failures, int LocalImages, int ReusedImages = 0);

/// <summary>Explicit offline snapshots of authored images, with optional service URL resolution.</summary>
public sealed class DocumentImageImporter : IDisposable
{
    private readonly RemoteImageLoader _remote;
    private readonly GithubImageImporter _github;
    private readonly QiitaImageImporter _qiita;

    public DocumentImageImporter(string? userAgent = null, HttpMessageHandler? remoteHandler = null,
        HttpMessageHandler? githubHandler = null, HttpMessageHandler? qiitaHandler = null)
    {
        _remote = new RemoteImageLoader(remoteHandler);
        _github = new GithubImageImporter(githubHandler, userAgent);
        _qiita = new QiitaImageImporter(qiitaHandler, userAgent);
    }

    public async Task<ImageImportResult> ImportAsync(string documentPath, bool github, IEnumerable<string> documentSources,
        string? serviceDocumentUrl = null, CancellationToken cancellationToken = default)
    {
        var article = string.IsNullOrWhiteSpace(serviceDocumentUrl) ? "" :
            (github ? GithubImageImporter.DocumentUri(serviceDocumentUrl) : QiitaImageImporter.ArticleUri(serviceDocumentUrl)).AbsoluteUri;
        var sources = documentSources.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim())
            .Where(s => !s.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && !s.StartsWith('#'))
            .Select(s => Uri.TryCreate(s, UriKind.Absolute, out var uri) && RemoteImageLoader.IsAllowedUri(uri) ? uri.AbsoluteUri : s)
            .Distinct(StringComparer.Ordinal).ToArray();
        var cdn = !github && article.Length > 0
            ? await _qiita.ResolveCdnImagesAsync(article, sources, cancellationToken, requireMatch: false) : [];
        var failures = new List<ImageImportFailure>();
        var targets = new List<(string Source, string Url, bool Direct)>();
        var locals = 0;
        foreach (var source in sources)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (LocalAssets.ResolvePath(Path.GetDirectoryName(Path.GetFullPath(documentPath))!, source) != null)
            {
                locals++;
                continue;
            }
            if (cdn.TryGetValue(source, out var service)) targets.Add((source, service, false));
            else if (github && article.Length > 0 && GithubImageImporter.ResolveImage(article, source) is { } repositoryImage)
                targets.Add((source, repositoryImage.AbsoluteUri, false));
            else if (Uri.TryCreate(source, UriKind.Absolute, out var remote) && RemoteImageLoader.IsAllowedUri(remote))
                targets.Add((source, remote.AbsoluteUri, true));
            else failures.Add(new(source, UiLanguage.Text(
                github ? "ローカル画像が見つかりません。GitHubから取得する場合は文書URLを指定してください。" : "ローカル画像が見つからないか、対応する画像URLではありません。",
                github ? "Local image unavailable. Specify a GitHub document URL to resolve repository paths." : "Local image unavailable or unsupported image URL.")));
        }
        if (targets.Count > QiitaImageArchive.MaxImages) throw new InvalidDataException("Too many images (maximum 128).");
        var path = QiitaImageArchive.PathFor(documentPath, github);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var images = new List<QiitaSavedImage>();
            var downloaded = 0;
            var reused = 0;
            var manifestArticle = article;
            long total = 0;
            using (var file = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
            {
                var written = new HashSet<string>();
                QiitaImageManifest? previous = null;
                var previousLoaded = false;
                string? previousError = null;

                async Task WriteImageAsync(QiitaSavedImage saved, RemoteImage image)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (images.Count >= QiitaImageArchive.MaxImages) throw new InvalidDataException("Too many images (maximum 128).");
                    total += image.Bytes.Length;
                    if (total > QiitaImageArchive.MaxTotalBytes) throw new InvalidDataException("Images exceed 256 MiB.");
                    if (written.Add(saved.Hash))
                    {
                        await using var entry = zip.CreateEntry("images/" + saved.Hash, CompressionLevel.NoCompression).Open();
                        await entry.WriteAsync(image.Bytes, cancellationToken);
                    }
                    images.Add(saved);
                }

                async Task<ImageImportFailure> PreservePreviousAsync(ImageImportFailure failure)
                {
                    QiitaSavedImage? saved;
                    RemoteImage image;
                    try
                    {
                        if (!previousLoaded)
                        {
                            previousLoaded = true;
                            try { previous = await Task.Run(() => QiitaImageArchive.Load(documentPath, github), cancellationToken); }
                            catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or ArgumentException)
                            { previousError = error.Message; }
                        }
                        if (previousError != null) throw new InvalidDataException(previousError);
                        saved = previous?.Images.FirstOrDefault(i => i.OriginalUrl == failure.Source);
                        if (saved == null) return failure;
                        // The same relative source can name a different image after changing repositories.
                        if (!saved.Direct && github && article.Length > 0 &&
                            GithubImageImporter.ResolveImage(article, saved.OriginalUrl)?.AbsoluteUri != saved.ServiceUrl) return failure;
                        image = await Task.Run(() => QiitaImageArchive.Read(documentPath, saved, github), cancellationToken);
                    }
                    catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or ArgumentException)
                    {
                        return failure with { Reason = failure.Reason + "\n" + UiLanguage.Text(
                            "前回の保存画像も使用できません: ", "The previously saved image is also unavailable: ") + error.Message };
                    }
                    // Apply the same limits to reused and newly downloaded images. A limit failure
                    // aborts publication rather than silently dropping previously saved images.
                    await WriteImageAsync(saved, image);
                    if (!saved.Direct && manifestArticle.Length == 0) manifestArticle = previous!.ArticleUrl;
                    reused++;
                    return failure with { UsedPrevious = true };
                }

                // Unresolved relative paths can still have a valid snapshot from an earlier import.
                for (var i = 0; i < failures.Count; i++) failures[i] = await PreservePreviousAsync(failures[i]);
                foreach (var target in targets)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    RemoteImage image;
                    try
                    {
                        if (target.Direct) image = await _remote.LoadAsync(new Uri(target.Url), cancellationToken);
                        else
                        {
                            var fetched = github ? await _github.FetchAsync(new Uri(target.Url), cancellationToken) :
                                await _qiita.FetchAsync(new Uri(target.Url), true, cancellationToken);
                            image = new(fetched.Bytes, fetched.Type);
                        }
                        if (!QiitaImageArchive.IsImageType(image.ContentType) || image.Bytes.Length == 0)
                            throw new InvalidDataException("Unsupported or empty image.");
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
                    catch (Exception error) when (error is HttpRequestException or IOException or InvalidDataException or OperationCanceledException or ArgumentException)
                    {
                        failures.Add(await PreservePreviousAsync(new(target.Source, error.Message)));
                        continue;
                    }
                    var hash = QiitaImageArchive.Hash(image.Bytes);
                    await WriteImageAsync(new(target.Source, target.Url, hash, image.ContentType, image.Bytes.Length, target.Direct), image);
                    downloaded++;
                }
                // A completely failed refresh leaves the original archive and display choice intact.
                if (downloaded == 0) return new(null, failures.ToArray(), locals, reused);
                var manifest = new QiitaImageManifest(2, manifestArticle, DateTimeOffset.UtcNow, images.ToArray());
                var json = JsonSerializer.SerializeToUtf8Bytes(manifest, QiitaImageArchive.Json);
                if (json.Length > 512 * 1024) throw new InvalidDataException("Image manifest is too large.");
                await using var info = zip.CreateEntry("manifest.json", CompressionLevel.Fastest).Open();
                await info.WriteAsync(json, cancellationToken);
            }
            cancellationToken.ThrowIfCancellationRequested();
            File.Move(temporary, path, true);
            return new(QiitaImageArchive.Load(documentPath, github), failures.ToArray(), locals, reused);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public void Dispose() { _remote.Dispose(); _github.Dispose(); _qiita.Dispose(); }
}
