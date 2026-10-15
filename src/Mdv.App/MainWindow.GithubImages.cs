using System.IO;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Mdv.Core;

namespace Mdv.App;

public partial class MainWindow
{
    private bool _importingGithubImages;
    private QiitaImageManifest? _savedGithubManifest;
    private string? _savedGithubDocument;

    private async void ImportGithubImages_Click(object sender, RoutedEventArgs e) => await ImportDocumentImagesAsync(github: true);

    internal void SetSavedGithubImages(bool enabled) => SetSavedImages("github", enabled);

    private void SavedGithubImages_Click(object sender, RoutedEventArgs e) => SetSavedGithubImages(SavedGithubImagesMenu.IsChecked);

    private void DeleteGithubImages_Click(object sender, RoutedEventArgs e)
    {
        if (_document is not { } document) return;
        try { File.Delete(QiitaImageArchive.PathFor(document.FilePath, github: true)); Render(); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { MessageBox.Show(this, error.Message, "MDV", MessageBoxButton.OK, MessageBoxImage.Error); }
    }

    private async Task ServeSavedGithubImageAsync(Uri uri, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var core = Preview.CoreWebView2;
        var manifest = _savedGithubManifest;
        var document = _savedGithubDocument;
        var image = manifest?.Images.FirstOrDefault(i => uri.AbsolutePath == "/github-image/" + i.Hash);
        var deferral = e.GetDeferral();
        try
        {
            if (e.ResourceContext == CoreWebView2WebResourceContext.Image && _settings.Mode == "github" && UseSavedGithubImages &&
                image != null && document != null && document == _document?.FilePath)
            {
                var saved = await Task.Run(() => QiitaImageArchive.Read(document, image, github: true), _lifetime.Token);
                if (!_closed && UseSavedGithubImages && _settings.Mode == "github" && document == _document?.FilePath)
                    e.Response = core.Environment.CreateWebResourceResponse(new MemoryStream(saved.Bytes), 200, "OK",
                        $"Content-Type: {saved.ContentType}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'");
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or OperationCanceledException or ArgumentException) { }
        finally
        {
            try
            {
                if (!_closed) e.Response ??= core.Environment.CreateWebResourceResponse(new MemoryStream(), 404, "Saved image unavailable", "Content-Type: text/plain");
                deferral.Complete();
            }
            catch (Exception error) when (_closed && error is System.Runtime.InteropServices.COMException or InvalidOperationException) { }
        }
    }
}
