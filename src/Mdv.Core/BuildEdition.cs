namespace Mdv.Core;

public static class BuildEdition
{
#if MDV_CUSTOM
    public static string Id => "custom";
    public static string DisplayName => UiLanguage.Text("独自エンジン版", "Custom engine edition");
    public static bool HasCustom => true;
    public static bool HasUpstream => false;
#elif MDV_UPSTREAM
    public static string Id => "upstream";
    public static string DisplayName => UiLanguage.Text("公開実装利用版", "Upstream engine edition");
    public static bool HasCustom => false;
    public static bool HasUpstream => true;
#else
    public static string Id => "dual";
    public static string DisplayName => UiLanguage.Text("両エンジン同梱版", "Dual engine edition");
    public static bool HasCustom => true;
    public static bool HasUpstream => true;
#endif
    public static bool CanSwitch => HasCustom && HasUpstream;
    public static string DefaultEngine => HasUpstream ? "original" : "legacy";
    public static string ResolveEngine(string? engine) => engine switch
    {
        "legacy" when HasCustom => "legacy",
        "original" when HasUpstream => "original",
        _ => DefaultEngine,
    };
}
