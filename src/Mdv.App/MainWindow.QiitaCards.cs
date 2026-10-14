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
    private bool _importingQiitaCards;
    private QiitaCardManifest? _savedQiitaCardManifest;
    private string? _savedQiitaCardDocument;

    private async void ImportQiitaCards_Click(object sender, RoutedEventArgs e)
    {
        if (_document is not { } document || !NavigationReady || _settings.Mode != "qiita") return;
        try
        {
            var sources = JsonSerializer.Deserialize<string[]>(await Preview.CoreWebView2.ExecuteScriptAsync("window.mdv.getCardSources()")) ?? [];
            if (sources.Length == 0)
            {
                MessageBox.Show(this, UiLanguage.Text("この文書には取得対象のリンクカードがありません。", "This document has no link cards to import."), "MDV");
                return;
            }
            using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
            var token = cancellation.Token;
            var dialog = new Window { Owner = this, Title = UiLanguage.Text("Qiitaリンクカードを保存", "Save Qiita link cards"), Width = 620,
                SizeToContent = SizeToContent.Height, ResizeMode = ResizeMode.NoResize, WindowStartupLocation = WindowStartupLocation.CenterOwner };
            var panel = new StackPanel { Margin = new Thickness(20) };
            panel.Children.Add(new TextBlock { Text = UiLanguage.Text($"{sources.Length} 件のリンクカード情報とサムネイルをオンラインで取得し、Markdownと同じフォルダに保存します。保存後はオフラインで表示できます。", $"Download metadata and thumbnails for {sources.Length} link cards and save them beside the Markdown file for offline use."), TextWrapping = TextWrapping.Wrap });
            var status = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 12) };
            panel.Children.Add(status);
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            var start = new Button { Content = UiLanguage.Text("取得して保存", "Download and save"), IsDefault = true, Padding = new Thickness(12, 5, 12, 5) };
            var cancel = new Button { Content = UiLanguage.Text("キャンセル", "Cancel"), IsCancel = true, Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(12, 5, 12, 5) };
            buttons.Children.Add(start); buttons.Children.Add(cancel); panel.Children.Add(buttons); dialog.Content = panel;
            QiitaCardManifest? imported = null;
            var dismissed = false;
            dialog.Closed += (_, _) => { dismissed = true; cancellation.Cancel(); };
            start.Click += async (_, _) =>
            {
                start.IsEnabled = false;
                status.Text = UiLanguage.Text("リンクカードを取得しています…", "Downloading link cards…");
                try
                {
                    using var importer = new QiitaCardImporter(userAgent: Preview.CoreWebView2.Settings.UserAgent);
                    imported = await importer.ImportAsync(document.FilePath, sources, token);
                    if (!dismissed) dialog.DialogResult = true;
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested) { }
                catch (Exception error) when (error is HttpRequestException or IOException or UnauthorizedAccessException or ArgumentException or JsonException or OperationCanceledException)
                { if (!dismissed) status.Text = UiLanguage.Text("保存できませんでした: ", "Unable to save: ") + error.Message; }
                finally { if (!dismissed) start.IsEnabled = true; }
            };
            _importingQiitaCards = true; UpdateNavigationControls();
            if (dialog.ShowDialog() == true && imported != null)
            {
                SetSavedQiitaCards(true);
                MessageBox.Show(this, UiLanguage.Text($"{imported.Cards.Length} 件を保存しました。\n\n", $"Saved {imported.Cards.Length} link cards for offline use.\n\n") + QiitaCardArchive.PathFor(document.FilePath), "MDV");
            }
        }
        catch (Exception error) when (error is IOException or JsonException or InvalidOperationException)
        { MessageBox.Show(this, error.Message, "MDV", MessageBoxButton.OK, MessageBoxImage.Error); }
        finally { _importingQiitaCards = false; UpdateNavigationControls(); }
    }

    internal void SetSavedQiitaCards(bool enabled)
    {
        _settings.UseSavedQiitaCards = SavedQiitaCardsMenu.IsChecked = enabled;
        Render();
    }

    private void SavedQiitaCards_Click(object sender, RoutedEventArgs e) => SetSavedQiitaCards(SavedQiitaCardsMenu.IsChecked);

    private void DeleteQiitaCards_Click(object sender, RoutedEventArgs e)
    {
        if (_document is not { } document) return;
        try { File.Delete(QiitaCardArchive.PathFor(document.FilePath)); Render(); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        { MessageBox.Show(this, error.Message, "MDV", MessageBoxButton.OK, MessageBoxImage.Error); }
    }

    private async Task ServeSavedQiitaCardImageAsync(Uri uri, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var core = Preview.CoreWebView2;
        var manifest = _savedQiitaCardManifest;
        var document = _savedQiitaCardDocument;
        var image = manifest?.Cards.Select(c => c.Image).OfType<QiitaCardImage>().FirstOrDefault(i => uri.AbsolutePath == "/qiita-card-image/" + i.Hash);
        var deferral = e.GetDeferral();
        try
        {
            if (e.ResourceContext == CoreWebView2WebResourceContext.Image && _settings.Mode == "qiita" && _settings.UseSavedQiitaCards &&
                image != null && document != null && document == _document?.FilePath)
            {
                var saved = await Task.Run(() => QiitaCardArchive.Read(document, image), _lifetime.Token);
                if (!_closed && _settings.UseSavedQiitaCards && _settings.Mode == "qiita" && document == _document?.FilePath)
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
