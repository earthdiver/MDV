using System.IO;
using System.Windows;
using System.Windows.Controls;
using Mdv.Core;

namespace Mdv.App;

public partial class MainWindow
{
    private void Cache_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new Window
        {
            Title = UiLanguage.Text("MDV — 展開ファイルを管理", "MDV — Manage extracted files"),
            Owner = this, Width = 640, Height = 460, MinWidth = 500, MinHeight = 350,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Background = (System.Windows.Media.Brush)FindResource("WindowBrush"),
            Foreground = (System.Windows.Media.Brush)FindResource("TextBrush"),
        };
        var panel = new DockPanel { Margin = new Thickness(20) };
        var description = new TextBlock
        {
            Text = UiLanguage.Text("起動用ファイルの使用容量を確認し、未使用の版を削除できます。削除した版を再び起動すると、必要なファイルを展開し直します。",
                "Review startup file storage and remove unused versions. Starting a removed version extracts its files again."),
            TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 12),
        };
        DockPanel.SetDock(description, Dock.Top);
        panel.Children.Add(description);
        var summary = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 12) };
        DockPanel.SetDock(summary, Dock.Top);
        panel.Children.Add(summary);
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 12, 0, 0) };
        var remove = new Button { Content = UiLanguage.Text("未使用の展開ファイルを削除", "Delete unused extracted files"), IsEnabled = false, Padding = new Thickness(12, 5, 12, 5) };
        var refresh = new Button { Content = UiLanguage.Text("更新", "Refresh"), Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(12, 5, 12, 5) };
        var close = new Button { Content = UiLanguage.Text("閉じる", "Close"), IsCancel = true, Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(12, 5, 12, 5) };
        buttons.Children.Add(remove); buttons.Children.Add(refresh); buttons.Children.Add(close);
        DockPanel.SetDock(buttons, Dock.Bottom);
        panel.Children.Add(buttons);
        var listing = new TextBox { IsReadOnly = true, TextWrapping = TextWrapping.Wrap, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Padding = new Thickness(10) };
        panel.Children.Add(listing);
        dialog.Content = panel;
        IReadOnlyList<PayloadCacheEntry> entries = [];
        var busy = false;
        var closed = false;
        dialog.Closed += (_, _) => closed = true;
        close.Click += (_, _) => dialog.Close();

        static string Size(long bytes) => $"{bytes / 1_000_000_000d:0.00} GB ({bytes / 1_000_000d:N0} MB)";
        async Task RefreshAsync(string? result = null)
        {
            if (busy) return;
            busy = true;
            remove.IsEnabled = refresh.IsEnabled = false;
            summary.Text = UiLanguage.Text("使用容量を確認しています…", "Checking storage…");
            try
            {
                entries = await Task.Run(() => PayloadCache.Inspect(_portable.CacheRoot, _portable.Assets)
                    .Concat(PayloadCache.Inspect(_portable.LegacyCacheRoot, _portable.Assets)
                        .Select(entry => entry with { State = entry.State == PayloadCacheState.Unavailable ? entry.State : PayloadCacheState.Untracked })).ToArray());
                if (closed) return;
                var available = entries.Where(entry => entry.State == PayloadCacheState.Unused).Sum(entry => entry.Bytes);
                summary.Text = (result == null ? "" : result + "\n") + UiLanguage.Text(
                    $"合計: {Size(entries.Sum(entry => entry.Bytes))}　削除可能: {Size(available)}",
                    $"Total: {Size(entries.Sum(entry => entry.Bytes))}   Removable: {Size(available)}");
                if (entries.Any(entry => entry.State == PayloadCacheState.Unavailable))
                    summary.Text += UiLanguage.Text("\n確認できないファイルは容量に含めず、削除しません。", "\nFiles that cannot be checked are excluded from totals and kept.");
                listing.Text = entries.Count == 0 ? UiLanguage.Text("展開ファイルはありません。", "No extracted files.") :
                    string.Join("\n\n", entries.Select(entry =>
                    {
                        var state = entry.State switch
                        {
                            PayloadCacheState.Current => UiLanguage.Text("このウィンドウで使用中", "Used by this window"),
                            PayloadCacheState.InUse => UiLanguage.Text("使用中（削除しません）", "In use (kept)"),
                            PayloadCacheState.Untracked => UiLanguage.Text("旧版・使用状況不明（削除しません）", "Older version or unknown usage (kept)"),
                            PayloadCacheState.Unavailable => UiLanguage.Text("確認できません（削除しません）", "Unable to check (kept)"),
                            _ => UiLanguage.Text("未使用", "Unused"),
                        };
                        var date = entry.ModifiedUtc == DateTime.MinValue ? "" : entry.ModifiedUtc.ToLocalTime().ToString("g") + "  ·  ";
                        return $"{date}{Size(entry.Bytes)}  ·  {state}";
                    }));
                remove.IsEnabled = entries.Any(entry => entry.State == PayloadCacheState.Unused);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            { if (!closed) summary.Text = UiLanguage.Text("展開ファイルを確認できません: ", "Unable to check extracted files: ") + error.Message; }
            finally { busy = false; if (!closed) refresh.IsEnabled = true; }
        }

        remove.Click += async (_, _) =>
        {
            if (busy) return;
            busy = true;
            remove.IsEnabled = refresh.IsEnabled = false;
            summary.Text = UiLanguage.Text("未使用の展開ファイルを削除しています…", "Deleting unused extracted files…");
            string result;
            try
            {
                var candidates = entries.Where(entry => entry.State == PayloadCacheState.Unused).Select(entry => entry.Path).ToArray();
                var deleted = await Task.Run(() => PayloadCache.DeleteUnused(_portable.CacheRoot, _portable.Assets, candidates));
                result = UiLanguage.Text($"{deleted.Deleted}件を削除しました（{Size(deleted.FreedBytes)}）。保護・削除できなかった項目: {deleted.Skipped}件。",
                    $"Deleted {deleted.Deleted} versions ({Size(deleted.FreedBytes)}). Kept or unable to delete: {deleted.Skipped}.");
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            { result = UiLanguage.Text("削除できません: ", "Unable to delete: ") + error.Message; }
            finally { busy = false; }
            if (!closed) await RefreshAsync(result);
        };
        refresh.Click += async (_, _) => await RefreshAsync();
        dialog.Loaded += async (_, _) => await RefreshAsync();
        dialog.ShowDialog();
    }
}
