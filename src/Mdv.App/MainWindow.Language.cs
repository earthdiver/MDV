using System.IO;
using System.Windows;
using System.Windows.Controls;
using Mdv.Core;

namespace Mdv.App;

public partial class MainWindow
{
    private void ApplyLanguage()
    {
        Resources["TextFileMenu"] = UiLanguage.Text("ファイル(_F)", "_File");
        Resources["TextNewTabMenu"] = UiLanguage.Text("新しいタブ(_T)", "New _tab");
        Resources["TextOpenMenu"] = UiLanguage.Text("開く(_O)…", "_Open…");
        Resources["TextRecentFilesMenu"] = UiLanguage.Text("最近開いたファイル(_R)", "_Recent files");
        Resources["TextReloadMenu"] = UiLanguage.Text("再読み込み(_R)", "_Reload");
        Resources["TextCloseTabMenu"] = UiLanguage.Text("タブを閉じる(_W)", "Close tab (_W)");
        Resources["TextPrintMenu"] = UiLanguage.Text("印刷(_P)…", "_Print…");
        Resources["TextSavePdfMenu"] = UiLanguage.Text("PDFに保存(_E)…", "Save as PDF (_E)…");
        Resources["TextExitMenu"] = UiLanguage.Text("終了(_X)", "E_xit");
        Resources["TextViewMenu"] = UiLanguage.Text("表示(_V)", "_View");
        Resources["TextBackMenu"] = UiLanguage.Text("戻る(_B)", "_Back");
        Resources["TextForwardMenu"] = UiLanguage.Text("進む(_N)", "Forward (_N)");
        Resources["TextNextTab"] = UiLanguage.Text("次のタブ", "Next tab");
        Resources["TextPreviousTab"] = UiLanguage.Text("前のタブ", "Previous tab");
        Resources["TextFindMenu"] = UiLanguage.Text("文書内を検索(_F)", "_Find in document");
        Resources["TextOutlineMenu"] = UiLanguage.Text("目次(_T)", "_Table of contents");
        Resources["TextSourceMenu"] = UiLanguage.Text("ソースを表示(_S)", "Show _source");
        Resources["TextUpstreamMenu"] = UiLanguage.Text("公開実装エンジンを使用", "Use upstream engine");
        Resources["TextDarkMenu"] = UiLanguage.Text("ダークテーマ(_D)", "_Dark theme");
        Resources["TextRemoteImagesMenu"] = UiLanguage.Text("外部画像を読み込む(_I)", "Load remote _images");
        Resources["TextQiitaImagesMenu"] = UiLanguage.Text("Qiita本家の画像", "Qiita service images");
        Resources["TextImportQiitaImages"] = UiLanguage.Text("記事から取得・保存…", "Download and save from article…");
        Resources["TextUseSavedQiitaImages"] = UiLanguage.Text("保存した本家の画像を使用", "Use saved service images");
        Resources["TextDeleteQiitaImages"] = UiLanguage.Text("この文書の保存画像を削除", "Delete saved images for this document");
        Resources["TextQiitaCardsMenu"] = UiLanguage.Text("Qiitaリンクカード", "Qiita link cards");
        Resources["TextImportQiitaCards"] = UiLanguage.Text("オンラインで取得・保存…", "Download and save online…");
        Resources["TextUseSavedQiitaCards"] = UiLanguage.Text("保存したリンクカードを使用", "Use saved link cards");
        Resources["TextDeleteQiitaCards"] = UiLanguage.Text("この文書の保存カードを削除", "Delete saved cards for this document");
        Resources["TextZoomIn"] = UiLanguage.Text("拡大", "Zoom in");
        Resources["TextZoomOut"] = UiLanguage.Text("縮小", "Zoom out");
        Resources["TextZoomReset"] = UiLanguage.Text("標準の倍率", "Reset zoom");
        Resources["TextHelpMenu"] = UiLanguage.Text("ヘルプ(_H)", "_Help");
        Resources["TextOpenSample"] = UiLanguage.Text("サンプルを開く", "Open sample");
        Resources["TextCompatibilityMenu"] = UiLanguage.Text("互換性・対応範囲", "Compatibility");
        Resources["TextAbout"] = UiLanguage.Text("MDVについて", "About MDV");
        Resources["TextLicenses"] = UiLanguage.Text("同梱ライセンス", "Bundled licenses");
        Resources["TextBackTooltip"] = UiLanguage.Text("戻る (Alt+←)", "Back (Alt+←)");
        Resources["TextBack"] = UiLanguage.Text("戻る", "Back");
        Resources["TextForwardTooltip"] = UiLanguage.Text("進む (Alt+→)", "Forward (Alt+→)");
        Resources["TextForward"] = UiLanguage.Text("進む", "Forward");
        Resources["TextGitHubTooltip"] = UiLanguage.Text("GitHub形式 (Ctrl+1)", "GitHub mode (Ctrl+1)");
        Resources["TextQiitaTooltip"] = UiLanguage.Text("Qiita形式 (Ctrl+2)", "Qiita mode (Ctrl+2)");
        Resources["TextOpenFile"] = UiLanguage.Text("ファイルを開く", "Open file");
        Resources["TextOpenFileTooltip"] = UiLanguage.Text("Ctrl+O / ファイルをドロップ", "Ctrl+O / Drop files");
        Resources["TextNewTabTooltip"] = UiLanguage.Text("新しいタブ (Ctrl+T)", "New tab (Ctrl+T)");
        Resources["TextNewTab"] = UiLanguage.Text("新しいタブ", "New tab");
        Resources["TextDocumentTabs"] = UiLanguage.Text("開いている文書のタブ", "Open document tabs");
        Resources["TextCloseTabTooltip"] = UiLanguage.Text("タブを閉じる (Ctrl+W)", "Close tab (Ctrl+W)");
        Resources["TextCloseTab"] = UiLanguage.Text("タブを閉じる", "Close tab");
        Resources["TextFind"] = UiLanguage.Text("検索", "Find");
        Resources["TextSearchInput"] = UiLanguage.Text("文書内の検索語", "Search text in document");
        Resources["TextPrevious"] = UiLanguage.Text("前へ", "Previous");
        Resources["TextNext"] = UiLanguage.Text("次へ", "Next");
        Resources["TextClose"] = UiLanguage.Text("閉じる", "Close");
        Resources["TextStarting"] = UiLanguage.Text("起動中…", "Starting…");
        Resources["TextCompatibility"] = UiLanguage.Text("対応範囲", "Compatibility");
        Resources["TextOutline"] = UiLanguage.Text("目次", "Table of contents");
        Resources["TextOutlineHint"] = UiLanguage.Text("見出しから移動できます", "Select a heading to navigate");
        Resources["TextSourceHeader"] = UiLanguage.Text("MARKDOWN ソース · 読み取り専用", "MARKDOWN SOURCE · READ ONLY");
        Resources["TextSourceLabel"] = UiLanguage.Text("Markdownソース", "Markdown source");
        Resources["TextEmptyHint"] = UiLanguage.Text("Markdownファイルを開くか、ここにドロップしてください。", "Open a Markdown file or drop it here.");
        Resources["TextMultiSelectTooltip"] = UiLanguage.Text("Ctrl+O（複数選択できます）", "Ctrl+O (multiple selection supported)");
        Resources["TextPreviewError"] = UiLanguage.Text("プレビューを開始できませんでした", "Unable to start preview");
        Resources["LanguageMenuLabel"] = UiLanguage.Text("言語(_L)", "_Language");
        Resources["AutoLanguageLabel"] = UiLanguage.Text("自動（システム設定）", "Automatic (system language)");
        AutoLanguageMenu.IsChecked = _settings.Language == "auto";
        JapaneseLanguageMenu.IsChecked = _settings.Language == "ja";
        EnglishLanguageMenu.IsChecked = _settings.Language == "en";
        foreach (var tab in _workspace.Tabs) tab.RefreshLanguage();
        Title = "MDV — " + BuildEdition.DisplayName;
    }

    private async void Language_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not MenuItem { Tag: string language }) return;
        // Serialize with navigation so a render cannot restore another tab's view.
        await RunNavigationAsync(async () =>
        {
            var previous = _settings.Language;
            _settings.Language = language;
            try { _settings.Save(_settingsPath); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                _settings.Language = previous;
                ApplyLanguage();
                MessageBox.Show(this, error.Message, UiLanguage.Text("MDV — 設定の保存に失敗", "MDV — Failed to save settings"), MessageBoxButton.OK, MessageBoxImage.Warning);
                return false;
            }
            _pendingView = await SaveActiveTabAsync();
            UiLanguage.Set(language);
            ApplyLanguage();
            DisplayActiveTab();
            Render();
            await WaitForRenderAsync();
            return true;
        });
    }
}
