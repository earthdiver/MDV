using System.IO;
using System.Text.Json;
using System.Windows;
using Mdv.Core;

namespace Mdv.App;

public partial class MainWindow
{
    private string SessionPath => DocumentSession.PathForSettings(_settingsPath);
    private string? _sessionNotice;
    private bool _sessionRestored;

    private async Task<bool> RestoreSessionAsync()
    {
        if (!_settings.RestoreSession || _arguments.Contains("--smoke-test") || _arguments.Any(argument => !argument.StartsWith('-'))) return false;
        try
        {
            var snapshot = await Task.Run(() => DocumentSession.Load(SessionPath), _lifetime.Token);
            if (snapshot == null) return false;
            var original = _workspace.Active;
            _updatingTabControls = true;
            try
            {
                var missing = await DocumentSession.RestoreAsync(_workspace, snapshot, _lifetime.Token, (path, token) => _portable.ReadMemorySample(path) is { } sample ? Task.FromResult(sample) : DocumentReader.ReadAsync(path, token));
                if (missing > 0) _sessionNotice = UiLanguage.Text($"前回の文書 {missing} 件を開けなかったため、省略しました。", $"Skipped {missing} unavailable document(s) from the previous session.");
            }
            finally { _updatingTabControls = false; }
            if (ReferenceEquals(original, _workspace.Active)) return false;
            _pendingView = _history.Current?.View;
            DisplayActiveTab();
            return true;
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested) { return false; }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or ArgumentException or NotSupportedException)
        {
            _sessionNotice = UiLanguage.Text("前回のタブを復元できませんでした: ", "Unable to restore the previous session: ") + error.Message;
            return false;
        }
    }

    private void RestoreSession_Click(object sender, RoutedEventArgs e)
    {
        try { DocumentSession.SetEnabled(_settingsPath, _settings, RestoreSessionMenu.IsChecked); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // The INI may already contain OFF if deleting an old snapshot failed.
            try { _settings.RestoreSession = UserSettings.Load(_settingsPath).RestoreSession; }
            catch (Exception readError) when (readError is IOException or UnauthorizedAccessException) { }
            MessageBox.Show(this, UiLanguage.Text("復元設定または保存したタブ情報を更新できませんでした。\n\n", "Unable to update the restore setting or saved tab information.\n\n") + error.Message,
                UiLanguage.Text("MDV — タブ情報の更新に失敗", "MDV — Failed to update saved tabs"), MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        RestoreSessionMenu.IsChecked = _settings.RestoreSession;
    }

    private async Task SaveSessionOnCloseAsync()
    {
        // Native verification must never restore or overwrite a reader's session.
        if (_arguments.Contains("--smoke-test")) return;
        try
        {
            if (!UserSettings.Load(_settingsPath).RestoreSession || !FirstRender.Task.IsCompletedSuccessfully) return;
            if (!await _navigationGate.WaitAsync(TimeSpan.FromSeconds(2))) return;
            try
            {
                // A rendering failure or stalled WebView must not prevent closing the app.
                try
                {
                    var view = await CaptureViewAsync().WaitAsync(TimeSpan.FromSeconds(2));
                    if (view != null) _history.SaveView(view);
                }
                catch (Exception error) when (error is TimeoutException or JsonException or InvalidOperationException or System.Runtime.InteropServices.COMException) { }
                _workspace.Active.SearchQuery = FindInput.Text;
                _workspace.Active.ShowSearch = FindBar.Visibility == Visibility.Visible;
                var snapshot = DocumentSession.Capture(_workspace);
                // Recheck the opt-in at publication, after asynchronous view capture.
                // An opt-out in another window shares this lock and deletes any older snapshot.
                await Task.Run(() => DocumentSession.SaveIfEnabled(_settingsPath, snapshot));
            }
            finally { _navigationGate.Release(); }
        }
        catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or ArgumentException or NotSupportedException)
        {
            MessageBox.Show(this, UiLanguage.Text("タブと閲覧位置を保存できませんでした。\n\n", "Unable to save tabs and reading positions.\n\n") + error.Message,
                UiLanguage.Text("MDV — タブ情報の保存に失敗", "MDV — Failed to save tabs"), MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }
}
