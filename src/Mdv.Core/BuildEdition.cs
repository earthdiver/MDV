namespace Mdv.Core;

public static class BuildEdition
{
#if MDV_CUSTOM
    public static string Id => "custom";
    public static string DisplayName => UiLanguage.Text("独自エンジン版", "Custom engine edition");
    public static bool HasCustom => true;
    public static bool HasUpstream => false;
#else
    public static string Id => "dual";
    public static string DisplayName => UiLanguage.Text("両エンジン同梱版", "Dual engine edition");
    public static bool HasCustom => true;
    public static bool HasUpstream => true;
#endif
    public static bool UsesMemoryAssets => !HasUpstream;
    public static bool CanSwitch => HasCustom && HasUpstream;
    public static string DefaultEngine => HasUpstream ? "original" : "legacy";
    public static string ResolveEngine(string? engine) => engine switch
    {
        "legacy" when HasCustom => "legacy",
        "original" when HasUpstream => "original",
        _ => DefaultEngine,
    };
}
