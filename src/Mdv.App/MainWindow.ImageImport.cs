using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using Mdv.Core;

namespace Mdv.App;

public partial class MainWindow
{
    private async Task ImportDocumentImagesAsync(bool github)
    {
        if (_document is not { } document || !NavigationReady || _settings.Mode != (github ? "github" : "qiita")) return;
        try
        {
            var sources = JsonSerializer.Deserialize<string[]>(await Preview.CoreWebView2.ExecuteScriptAsync("window.mdv.getImageSources()")) ?? [];
            if (sources.Length == 0)
            {
                MessageBox.Show(this, UiLanguage.Text("この文書には保存対象の画像がありません。", "This document has no images to save."), "MDV");
                return;
            }
            using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
            var dialog = new Window { Owner = this, Title = UiLanguage.Text("画像を取得・保存", "Download and save images"), Width = 640,
                SizeToContent = SizeToContent.Height, ResizeMode = ResizeMode.NoResize, WindowStartupLocation = WindowStartupLocation.CenterOwner };
            var panel = new StackPanel { Margin = new Thickness(20) };
            panel.Children.Add(new TextBlock { Text = UiLanguage.Text(
                "文書内の外部画像を取得し、Markdownの隣に保存します。URL入力は不要です。ローカル画像はそのまま使用します。",
                "Download this document's remote images and save them beside the Markdown. No document URL is required. Local images keep their existing files."), TextWrapping = TextWrapping.Wrap });
            var service = new CheckBox { Content = github ? UiLanguage.Text("GitHubから相対パス画像も取得", "Also resolve repository images from GitHub") :
                UiLanguage.Text("Qiita本家のCDN画像を取得", "Use Qiita's published CDN images"), Margin = new Thickness(0, 12, 0, 0) };
            panel.Children.Add(service);
            var label = new TextBlock { Text = github ? UiLanguage.Text("GitHub文書URL（上の項目を選ぶ場合のみ）", "GitHub document URL (only for the option above)") :
                UiLanguage.Text("Qiita記事URL（上の項目を選ぶ場合のみ）", "Qiita article URL (only for the option above)"), Margin = new Thickness(0, 8, 0, 0) };
            panel.Children.Add(label);
            var url = new TextBox { IsEnabled = false, Margin = new Thickness(0, 4, 0, 12) };
            System.Windows.Automation.AutomationProperties.SetName(url, label.Text);
            try { url.Text = QiitaImageArchive.Load(document.FilePath, github)?.ArticleUrl ?? ""; }
            catch (Exception error) when (error is IOException or JsonException or ArgumentException or UnauthorizedAccessException) { }
            service.Checked += (_, _) => { url.IsEnabled = true; url.Focus(); };
            service.Unchecked += (_, _) => url.IsEnabled = false;
            panel.Children.Add(url);
            var status = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 12) };
            panel.Children.Add(status);
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            var start = new Button { Content = UiLanguage.Text("取得して保存", "Download and save"), IsDefault = true, Padding = new Thickness(12, 5, 12, 5) };
            var cancel = new Button { Content = UiLanguage.Text("キャンセル", "Cancel"), IsCancel = true, Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(12, 5, 12, 5) };
            buttons.Children.Add(start); buttons.Children.Add(cancel); panel.Children.Add(buttons); dialog.Content = panel;
            ImageImportResult? result = null;
            var dismissed = false;
            dialog.Closed += (_, _) => { dismissed = true; cancellation.Cancel(); };
            start.Click += async (_, _) =>
            {
                var useService = service.IsChecked == true;
                if (useService && string.IsNullOrWhiteSpace(url.Text))
                {
                    status.Text = UiLanguage.Text("選択した取得方法には文書・記事URLが必要です。", "The selected service option requires a document or article URL.");
                    url.Focus(); return;
                }
                start.IsEnabled = service.IsEnabled = url.IsEnabled = false;
                status.Text = UiLanguage.Text("画像を取得しています…", "Downloading images…");
                try
                {
                    using var importer = new DocumentImageImporter(userAgent: Preview.CoreWebView2.Settings.UserAgent);
                    result = await importer.ImportAsync(document.FilePath, github, sources, useService ? url.Text.Trim() : null, cancellation.Token);
                    if (!dismissed) dialog.DialogResult = true;
                }
                catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
                catch (Exception error) when (error is HttpRequestException or IOException or UnauthorizedAccessException or ArgumentException or JsonException or OperationCanceledException)
                { if (!dismissed) status.Text = UiLanguage.Text("保存できませんでした: ", "Unable to save: ") + error.Message; }
                finally
                {
                    if (!dismissed) { start.IsEnabled = service.IsEnabled = true; url.IsEnabled = service.IsChecked == true; }
                }
            };
            if (github) _importingGithubImages = true; else _importingQiitaImages = true;
            UpdateNavigationControls();
            if (dialog.ShowDialog() == true && result != null)
            {
                if (result.Manifest != null)
                {
                    if (github) SetSavedGithubImages(true); else SetSavedQiitaImages(true);
                }
                ShowImageImportResult(document.FilePath, github, result);
            }
        }
        catch (Exception error) when (error is IOException or JsonException or InvalidOperationException)
        { MessageBox.Show(this, error.Message, "MDV", MessageBoxButton.OK, MessageBoxImage.Error); }
        finally
        {
            if (github) _importingGithubImages = false; else _importingQiitaImages = false;
            UpdateNavigationControls();
        }
    }

    private void ShowImageImportResult(string documentPath, bool github, ImageImportResult result)
    {
        var count = result.Manifest?.Images.Length ?? 0;
        var summary = UiLanguage.Text($"保存: {count} 枚 / ローカル画像: {result.LocalImages} 枚 / 未取得: {result.Failures.Length} 枚",
            $"Saved: {count} / Local images: {result.LocalImages} / Not saved: {result.Failures.Length}");
        summary += "\n\n" + (count > 0 ? QiitaImageArchive.PathFor(documentPath, github) :
            UiLanguage.Text("保存画像は更新していません。以前の保存画像と表示設定は維持します。", "No snapshot was updated. Previous saved images and display settings are retained."));
        if (count > 0) summary += "\n\n" + UiLanguage.Text("保存画像の使用を有効にしました。取得できなかった外部画像は表示しません。", "Saved images are now enabled. Remote images that were not saved are not displayed.");
        foreach (var failure in result.Failures) summary += "\n\n" + failure.Source + "\n" + failure.Reason;
        var dialog = new Window { Owner = this, Title = UiLanguage.Text("画像の保存結果", "Image download results"), Width = 680, Height = 440,
            WindowStartupLocation = WindowStartupLocation.CenterOwner };
        var panel = new DockPanel { Margin = new Thickness(16) };
        var close = new Button { Content = UiLanguage.Text("閉じる", "Close"), IsCancel = true, IsDefault = true,
            HorizontalAlignment = HorizontalAlignment.Right, Padding = new Thickness(16, 5, 16, 5), Margin = new Thickness(0, 12, 0, 0) };
        close.Click += (_, _) => dialog.Close();
        DockPanel.SetDock(close, Dock.Bottom); panel.Children.Add(close);
        panel.Children.Add(new TextBox { Text = summary, IsReadOnly = true, TextWrapping = TextWrapping.Wrap, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        dialog.Content = panel; dialog.ShowDialog();
    }
}
