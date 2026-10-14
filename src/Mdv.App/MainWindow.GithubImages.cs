using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Mdv.Core;

namespace Mdv.App;

public partial class MainWindow
{
    private bool _importingGithubImages;
    private QiitaImageManifest? _savedGithubManifest;
    private string? _savedGithubDocument;

    private async void ImportGithubImages_Click(object sender, RoutedEventArgs e)
    {
        if (_document is not { } document || !NavigationReady || _settings.Mode != "github") return;
        try
        {
            var sources = JsonSerializer.Deserialize<string[]>(await Preview.CoreWebView2.ExecuteScriptAsync("window.mdv.getImageSources()")) ?? [];
            if (sources.Length == 0)
            {
                MessageBox.Show(this, UiLanguage.Text("この文書には取得対象の外部画像がありません。", "This document has no remote images to import."), "MDV");
                return;
            }
            using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
            var token = cancellation.Token;
            var dialog = new Window { Owner = this, Title = UiLanguage.Text("GitHubの画像を保存", "Save GitHub repository images"), Width = 620,
                SizeToContent = SizeToContent.Height, ResizeMode = ResizeMode.NoResize, WindowStartupLocation = WindowStartupLocation.CenterOwner };
            var panel = new StackPanel { Margin = new Thickness(20) };
            panel.Children.Add(new TextBlock { Text = UiLanguage.Text("この文書の公開GitHub URL（blob形式、またはraw URL）を入力してください。相対パスの画像を取得し、Markdownと同じフォルダに保存します。", "Enter this document's public GitHub document URL (blob or raw URL). Relative images will be downloaded and saved beside the Markdown file."), TextWrapping = TextWrapping.Wrap });
            var url = new TextBox { Margin = new Thickness(0, 12, 0, 12), MinWidth = 540 };
            System.Windows.Automation.AutomationProperties.SetName(url, UiLanguage.Text("GitHub文書URL", "GitHub document URL"));
            try { url.Text = QiitaImageArchive.Load(document.FilePath, github: true)?.ArticleUrl ?? ""; }
            catch (Exception error) when (error is IOException or JsonException or ArgumentException or UnauthorizedAccessException) { }
            panel.Children.Add(url);
            var status = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 12) };
            panel.Children.Add(status);
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            var start = new Button { Content = UiLanguage.Text("取得して保存", "Download and save"), IsDefault = true, Padding = new Thickness(12, 5, 12, 5) };
            var cancel = new Button { Content = UiLanguage.Text("キャンセル", "Cancel"), IsCancel = true, Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(12, 5, 12, 5) };
            buttons.Children.Add(start); buttons.Children.Add(cancel); panel.Children.Add(buttons); dialog.Content = panel;
            QiitaImageManifest? imported = null;
            var dismissed = false;
            dialog.Closed += (_, _) => { dismissed = true; cancellation.Cancel(); };
            start.Click += async (_, _) =>
            {
                start.IsEnabled = url.IsEnabled = false;
                status.Text = UiLanguage.Text("画像を取得しています…", "Downloading images…");
                try
                {
                    using var importer = new GithubImageImporter(userAgent: Preview.CoreWebView2.Settings.UserAgent);
                    imported = await importer.ImportAsync(document.FilePath, url.Text.Trim(), sources, token);
                    if (!dismissed) dialog.DialogResult = true;
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested) { }
                catch (Exception error) when (error is HttpRequestException or IOException or UnauthorizedAccessException or ArgumentException or JsonException or OperationCanceledException)
                { if (!dismissed) status.Text = UiLanguage.Text("保存できませんでした: ", "Unable to save: ") + error.Message; }
                finally { if (!dismissed) start.IsEnabled = url.IsEnabled = true; }
            };
            _importingGithubImages = true; UpdateNavigationControls();
            dialog.Loaded += (_, _) => url.Focus();
            if (dialog.ShowDialog() == true && imported != null)
            {
                SetSavedGithubImages(true);
                MessageBox.Show(this, UiLanguage.Text($"{imported.Images.Length} 枚を保存しました。\n保存済み画像はオフラインでも表示できます。対象外の画像は原画像のままです。\n\n", $"Saved {imported.Images.Length} images for offline use. Unmatched images retain their original source.\n\n") + QiitaImageArchive.PathFor(document.FilePath, github: true), "MDV");
            }
        }
        catch (Exception error) when (error is IOException or JsonException or InvalidOperationException)
        { MessageBox.Show(this, error.Message, "MDV", MessageBoxButton.OK, MessageBoxImage.Error); }
        finally { _importingGithubImages = false; UpdateNavigationControls(); }
    }

    internal void SetSavedGithubImages(bool enabled)
    {
        _settings.UseSavedGithubImages = SavedGithubImagesMenu.IsChecked = enabled;
        Render();
    }

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
            if (e.ResourceContext == CoreWebView2WebResourceContext.Image && _settings.Mode == "github" && _settings.UseSavedGithubImages &&
                image != null && document != null && document == _document?.FilePath)
            {
                var saved = await Task.Run(() => QiitaImageArchive.Read(document, image, github: true), _lifetime.Token);
                if (!_closed && _settings.UseSavedGithubImages && _settings.Mode == "github" && document == _document?.FilePath)
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
