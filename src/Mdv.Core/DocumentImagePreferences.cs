namespace Mdv.Core;

public enum ImageSourceSelection { Off, Remote, Saved, Cdn }

/// <summary>Image choices follow each document and syntax mode throughout the session.</summary>
public sealed class DocumentImagePreferences
{
    private readonly Dictionary<string, Dictionary<string, ImageSourceSelection>> _documents = new(StringComparer.OrdinalIgnoreCase);

    public ImageSourceSelection Get(string documentPath, string mode, ImageSourceSelection initial = ImageSourceSelection.Off)
    {
        var modes = Modes(documentPath);
        if (!modes.TryGetValue(mode, out var selection)) modes[mode] = selection = initial;
        return selection;
    }

    public void Set(string documentPath, string mode, ImageSourceSelection selection)
    {
        if (mode is not ("github" or "qiita") || !Enum.IsDefined(selection) || (mode == "github" && selection == ImageSourceSelection.Cdn))
            throw new ArgumentException("Invalid image source selection.");
        Modes(documentPath)[mode] = selection;
    }

    private Dictionary<string, ImageSourceSelection> Modes(string path)
    {
        path = Path.GetFullPath(path);
        if (!_documents.TryGetValue(path, out var modes)) _documents[path] = modes = new(StringComparer.Ordinal);
        return modes;
    }
}
