using Mdv.Core;

namespace Mdv.App;

public partial class MainWindow
{
    private readonly DocumentImagePreferences _imagePreferences = new();

    private ImageSourceSelection ImageSelection(string mode)
    {
        if (_document == null) return ImageSourceSelection.Off;
        var saved = mode == "github" ? _settings.UseSavedGithubImages : _settings.UseSavedQiitaImages;
        var initial = saved ? ImageSourceSelection.Saved : _settings.AllowRemoteImages ? ImageSourceSelection.Remote : ImageSourceSelection.Off;
        return _imagePreferences.Get(_document.FilePath, mode, initial);
    }

    internal ImageSourceSelection CurrentImageSelection => ImageSelection(_settings.Mode);
    internal bool AllowRemoteImages => CurrentImageSelection == ImageSourceSelection.Remote;
    private bool UseSavedGithubImages => _settings.Mode == "github" && CurrentImageSelection == ImageSourceSelection.Saved;
    private bool UseSavedQiitaImages => _settings.Mode == "qiita" && CurrentImageSelection == ImageSourceSelection.Saved;

    internal void SetImageSelection(ImageSourceSelection selection)
    {
        if (_document == null) return;
        _imagePreferences.Set(_document.FilePath, _settings.Mode, selection);
        Render();
    }

    internal void SetRemoteImages(bool enabled)
    {
        if (enabled) SetImageSelection(ImageSourceSelection.Remote);
        else if (AllowRemoteImages) SetImageSelection(ImageSourceSelection.Off);
    }

    private void SetSavedImages(string mode, bool enabled)
    {
        if (_document == null) return;
        if (enabled || ImageSelection(mode) == ImageSourceSelection.Saved)
            _imagePreferences.Set(_document.FilePath, mode, enabled ? ImageSourceSelection.Saved : ImageSourceSelection.Off);
        Render();
    }
}
