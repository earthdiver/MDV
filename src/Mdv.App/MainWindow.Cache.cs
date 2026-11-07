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
            Owner = this, Width = 850, Height = 500, MinWidth = 780, MinHeight = 350,
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
        var remove = new Button { Content = UiLanguage.Text("選択した資材を削除…", "Delete selected files…"), IsEnabled = false, Padding = new Thickness(12, 5, 12, 5) };
        var refresh = new Button { Content = UiLanguage.Text("更新", "Refresh"), Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(12, 5, 12, 5) };
        var close = new Button { Content = UiLanguage.Text("閉じる", "Close"), IsCancel = true, Margin = new Thickness(8, 0, 0, 0), Padding = new Thickness(12, 5, 12, 5) };
        var open = new Button { Content = UiLanguage.Text("フォルダを開く", "Open folder"), IsEnabled = false, Padding = new Thickness(12, 5, 12, 5) };
        buttons.Children.Add(open); buttons.Children.Add(remove); buttons.Children.Add(refresh); buttons.Children.Add(close);
        DockPanel.SetDock(buttons, Dock.Bottom);
        panel.Children.Add(buttons);
        var listing = new ListBox { SelectionMode = SelectionMode.Extended, Padding = new Thickness(10) };
        panel.Children.Add(listing);
        dialog.Content = panel;
        IReadOnlyList<PayloadCacheEntry> entries = [];
        var busy = false;
        var closed = false;
        dialog.Closed += (_, _) => closed = true;
        close.Click += (_, _) => dialog.Close();
        PayloadCacheEntry[] Selected() => listing.SelectedItems.Cast<ListBoxItem>().Select(item => (PayloadCacheEntry)item.Tag).ToArray();
        void UpdateButtons()
        {
            var selected = Selected();
            open.IsEnabled = !busy && selected.Length == 1;
            remove.IsEnabled = !busy && selected.Length > 0 && selected.All(entry => entry.State is PayloadCacheState.Unused or PayloadCacheState.Untracked);
        }
        listing.SelectionChanged += (_, _) => UpdateButtons();
        open.Click += (_, _) =>
        {
            var selected = Selected();
            if (busy || selected.Length != 1) return;
            try
            {
                if (!Directory.Exists(selected[0].Path)) throw new IOException(UiLanguage.Text("フォルダが見つかりません。更新してください。", "Folder not found. Refresh the list."));
                var start = new System.Diagnostics.ProcessStartInfo("explorer.exe") { UseShellExecute = true };
                start.ArgumentList.Add(selected[0].Path);
                System.Diagnostics.Process.Start(start)?.Dispose();
            }
            catch (Exception error) when (error is IOException or System.ComponentModel.Win32Exception)
            { MessageBox.Show(dialog, error.Message, dialog.Title, MessageBoxButton.OK, MessageBoxImage.Warning); }
        };

        static string Size(long bytes) => $"{bytes / 1_000_000_000d:0.00} GB ({bytes / 1_000_000d:N0} MB)";
        async Task RefreshAsync(string? result = null)
        {
            if (busy) return;
            busy = true;
            remove.IsEnabled = refresh.IsEnabled = open.IsEnabled = listing.IsEnabled = false;
            summary.Text = UiLanguage.Text("使用容量を確認しています…", "Checking storage…");
            try
            {
                entries = await Task.Run(() => PayloadCache.Inspect(_portable.CacheRoot, _portable.Assets)
                    .Concat(PayloadCache.Inspect(_portable.LegacyCacheRoot, _portable.Assets)
                        .Select(entry => entry with { State = entry.State == PayloadCacheState.Unused ? PayloadCacheState.Untracked : entry.State })).ToArray());
                if (closed) return;
                var available = entries.Where(entry => entry.State == PayloadCacheState.Unused).Sum(entry => entry.Bytes);
                summary.Text = (result == null ? "" : result + "\n") + UiLanguage.Text(
                    $"合計: {Size(entries.Sum(entry => entry.Bytes))}　削除可能: {Size(available)}",
                    $"Total: {Size(entries.Sum(entry => entry.Bytes))}   Removable: {Size(available)}");
                if (entries.Any(entry => entry.State == PayloadCacheState.Unavailable))
                    summary.Text += UiLanguage.Text("\n確認できないファイルは容量に含めず、削除しません。", "\nFiles that cannot be checked are excluded from totals and kept.");
                listing.Items.Clear();
                foreach (var entry in entries)
                {
                        var state = entry.State switch
                        {
                            PayloadCacheState.Current => UiLanguage.Text("このウィンドウで使用中", "Used by this window"),
                            PayloadCacheState.InUse => UiLanguage.Text("使用中（削除しません）", "In use (kept)"),
                            PayloadCacheState.Untracked => UiLanguage.Text("旧版・使用状況不明（確認後に削除可能）", "Older version or unknown usage (confirmation required)"),
                            PayloadCacheState.Unavailable => UiLanguage.Text("確認できません（削除しません）", "Unable to check (kept)"),
                            _ => UiLanguage.Text("未使用", "Unused"),
                        };
                        var date = entry.ModifiedUtc == DateTime.MinValue ? "" : entry.ModifiedUtc.ToLocalTime().ToString("g") + "  ·  ";
                        listing.Items.Add(new ListBoxItem { Tag = entry, Content = new TextBlock { Text = $"{date}{Size(entry.Bytes)}  ·  {state}\n{entry.Path}", TextWrapping = TextWrapping.Wrap }, ToolTip = entry.Path });
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            { if (!closed) summary.Text = UiLanguage.Text("展開ファイルを確認できません: ", "Unable to check extracted files: ") + error.Message; }
            finally { busy = false; if (!closed) { refresh.IsEnabled = listing.IsEnabled = true; UpdateButtons(); } }
        }

        remove.Click += async (_, _) =>
        {
            if (busy) return;
            var selected = Selected();
            if (selected.Length == 0 || selected.Any(entry => entry.State is not (PayloadCacheState.Unused or PayloadCacheState.Untracked))) return;
            var confirmation = UiLanguage.Text("選択した資材を削除します。\n", "Delete the selected extracted files.\n") + string.Join("\n", selected.Select(entry => entry.Path));
            if (selected.Any(entry => entry.State == PayloadCacheState.Untracked))
                confirmation += UiLanguage.Text("\n\n旧版の使用状況は完全には確認できません。他のMDVをすべて終了し、削除中は起動しないでください。削除後、次回起動時に再展開します。", "\n\nOlder versions cannot be fully tracked. Close all other MDV windows and do not start them during deletion. Files will be extracted again on the next launch.");
            if (MessageBox.Show(dialog, confirmation, dialog.Title, MessageBoxButton.OKCancel, MessageBoxImage.Warning, MessageBoxResult.Cancel) != MessageBoxResult.OK) return;
            busy = true;
            remove.IsEnabled = refresh.IsEnabled = open.IsEnabled = listing.IsEnabled = false;
            summary.Text = UiLanguage.Text("選択した資材を削除しています…", "Deleting selected files…");
            string result;
            try
            {
                var deleted = await Task.Run(() =>
                {
                    var results = selected.GroupBy(entry => Path.GetDirectoryName(entry.Path)!).Select(group =>
                        PayloadCache.DeleteUnused(group.Key, _portable.Assets, group.Select(entry => entry.Path), allowUntracked: true)).ToArray();
                    return new PayloadCacheCleanup(results.Sum(item => item.Deleted), results.Sum(item => item.Skipped), results.Sum(item => item.FreedBytes));
                });
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
