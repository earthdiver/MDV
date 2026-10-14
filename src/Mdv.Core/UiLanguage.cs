using System.Globalization;

namespace Mdv.Core;

/// <summary>Application UI language, independent of document content and number formats.</summary>
public static class UiLanguage
{
    private static readonly CultureInfo SystemLanguage = CultureInfo.CurrentUICulture;
    public static string Current { get; private set; } = Resolve("auto", SystemLanguage);

    public static string Resolve(string? preference, CultureInfo systemLanguage) => preference switch
    {
        "ja" => "ja",
        "en" => "en",
        _ => systemLanguage.TwoLetterISOLanguageName == "ja" ? "ja" : "en",
    };

    public static void Set(string preference) => Current = Resolve(preference, SystemLanguage);
    public static string Text(string japanese, string english) => Current == "ja" ? japanese : english;
}
