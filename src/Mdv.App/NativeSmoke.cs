using System.IO;
using Mdv.Core;
using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;

namespace Mdv.App;

/// <summary>Opt-in integration check run by scripts/smoke-windows.ps1 and Windows CI.</summary>
internal static class NativeSmoke
{
    private static async Task CheckServicePresentation(MainWindow window, List<string> checks, string engine, string mode)
    {
        await WaitFor(window, "document.querySelector('#document h1 > .mdv-heading-link') !== null");
        var expression = mode == "qiita"
            ? "getComputedStyle(document.querySelector('.qiita .code-frame')).backgroundColor === 'rgb(29, 32, 32)' && getComputedStyle(document.querySelector('.qiita sup a'), '::before').content === '\"[\"'"
            : "getComputedStyle(document.querySelector('.github pre')).fontSize === '13.6px' && getComputedStyle(document.querySelector('.github')).lineHeight === '24px'";
        await WaitFor(window, expression);
        if (mode == "qiita")
        {
            await WaitFor(window, "document.fonts.check('17px FontAwesome') && getComputedStyle(document.querySelector('.mdv-heading-link .fa')).fontFamily === 'FontAwesome' && getComputedStyle(document.querySelector('.footnotes p')).margin === '0px' && getComputedStyle(document.querySelector('.highlight'), '::-webkit-scrollbar').height === '8px'");
            checks.Add(engine + " qiita MDV CSS and Font Awesome icon font, footnote spacing and code scrollbar verified");
        }
        if (mode == "github")
        {
            await WaitFor(window, "document.querySelector('h1 .octicon-link path') !== null && document.querySelector('clipboard-copy.copy-code .octicon-copy') !== null && !document.getElementById('github-primer').disabled");
            checks.Add(engine + " github official Primer, Octicons and clipboard component loaded");
        }
        checks.Add(engine + " " + mode + " service styles and heading links loaded in WebView2");
    }

    private static string ReportPath(string[] args) => Path.GetFullPath(args[Array.IndexOf(args, "--smoke-test") + 1]);

    internal static async Task RunAsync(MainWindow window, string[] args)
    {
        var checks = new List<string>();
        try
        {
            await window.FirstRender.Task.WaitAsync(TimeSpan.FromSeconds(45));
            using var currentProcess = Process.GetCurrentProcess();
            var startupMilliseconds = (DateTime.UtcNow - currentProcess.StartTime.ToUniversalTime()).TotalMilliseconds;
            checks.Add("WPF window and WebView2 ready");
            if (!window.Portable.Bundled) throw new InvalidOperationException("The portable test requires an embedded Fixed Version runtime.");
            using var browser = Process.GetProcessById(checked((int)window.Preview.CoreWebView2.BrowserProcessId));
            var browserPath = browser.MainModule?.FileName ?? throw new IOException("Browser process path is unavailable.");
            if (!string.Equals(Path.GetDirectoryName(browserPath), window.Portable.Runtime, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The installed WebView2 runtime was used instead of the embedded runtime.");
            checks.Add("Embedded Fixed Version runtime is actually running");
            if (!File.Exists(window.SettingsPath) || Path.GetDirectoryName(window.SettingsPath) != Path.GetDirectoryName(Environment.ProcessPath))
                throw new IOException("INI was not created beside the executable.");
            checks.Add("INI created beside the executable");
            if (Array.IndexOf(args, "--smoke-wsl-directory") is var wslIndex && wslIndex >= 0)
            {
                await CheckWslReload(window, args[wslIndex + 1], checks);
                await FinishAsync();
                return;
            }
            if (args.Contains("--smoke-restart"))
            {
                if (window.Settings.Mode != "qiita" || window.Settings.Theme != "dark" || window.Settings.Zoom != 1.3 ||
                    !window.Settings.ShowSource || window.Settings.ShowOutline || window.Settings.Language != "en") throw new InvalidOperationException("INI settings were not restored.");
                await WaitFor(window, "document.documentElement.dataset.theme === 'dark' && document.querySelector('.qiita :is(.qiita-note-warn,.note.warn)') !== null");
                await WaitFor(window, "document.documentElement.lang === 'en'");
                checks.Add("Moved and renamed EXE restored its adjacent INI, including English language");
                await FinishAsync();
                return;
            }
            var sampleName = window.Workspace.Active.Document!.FileName;
            var sampleAnchor = sampleName == "welcome.md" ? "共通の記法" : "common-syntax";
            foreach (var language in new[] { "en", "ja" })
            {
                var menu = language == "en" ? window.EnglishLanguageMenu : window.JapaneseLanguageMenu;
                menu.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
                await WaitForNavigation(window);
                await WaitFor(window, "document.documentElement.lang === '" + language + "'");
                if (UserSettings.Load(window.SettingsPath).Language != language ||
                    (string)window.Resources["LanguageMenuLabel"] != (language == "ja" ? "言語(_L)" : "_Language"))
                    throw new InvalidOperationException("Language selection was not applied and saved immediately.");
            }
            checks.Add("Japanese and English UI changes apply immediately and persist to INI");
            var expectedEngine = BuildEdition.DefaultEngine;
            if (window.Settings.Engine != expectedEngine) throw new InvalidOperationException("Wrong default engine for edition.");
            if ((window.OriginalEngineMenu.Visibility == Visibility.Visible) != BuildEdition.CanSwitch) throw new InvalidOperationException("Wrong engine menu visibility.");
            foreach (var requested in new[] { "original", "legacy" }) {
                window.SetEngine(requested);
                if (window.Settings.Engine != BuildEdition.ResolveEngine(requested)) throw new InvalidOperationException("Edition allowed unavailable engine.");
            }
            window.SetEngine(BuildEdition.HasCustom ? "legacy" : "original");
            await WaitForNavigation(window);
            checks.Add("Edition identity, default engine, menu and unavailable-engine normalization verified: " + BuildEdition.Id);
            await WaitFor(window, "document.querySelector('.github .markdown-alert-note') !== null");
            checks.Add("GitHub alerts rendered");
            await CheckServicePresentation(window, checks, window.Settings.Engine, "github");
            await WaitFor(window, "document.querySelector('.diagram svg') !== null");
            await WaitFor(window, "[...document.querySelectorAll('.diagram svg text, .diagram svg .nodeLabel')].some(node => node.textContent.trim().length > 0)");
            checks.Add("Mermaid rendered offline");
            await WaitFor(window, BuildEdition.HasCustom ? "document.querySelector('.katex') !== null" : "document.querySelector('mjx-container') !== null");
            checks.Add("Math rendered offline");
            await WaitFor(window, "[...document.querySelectorAll('img')].some(img => img.complete && img.naturalWidth > 0)");
            checks.Add("Local image served by native host");
            await CheckHttpImage(window, checks);
            if (Directory.Exists(Path.Combine(window.Portable.Assets, "OriginalEngines")))
            {
                window.SetEngine("original");
                foreach (var mode in new[] { "github", "qiita" })
                {
                    window.SetMode(mode);
                    await WaitFor(window, "document.querySelector('.original-body." + mode + " mjx-container') !== null && document.querySelector('.original-body .diagram svg') !== null");
                    await WaitForNavigation(window);
                    await WaitFor(window, "[...document.querySelectorAll('img')].some(img => img.complete && img.naturalWidth > 0)");
                    await WaitFor(window, "window.mdv.find('Markdown').total > 0");
                    await WaitFor(window, "window.mdv.scrollToAnchor('" + sampleAnchor + "')");
                    checks.Add("Original " + mode + " rendered via C# worker, with math, diagrams, images, search and anchors");
                    await CheckServicePresentation(window, checks, "original", mode);
                }
                var originalPdf = Path.ChangeExtension(ReportPath(args), ".original.pdf");
                Directory.CreateDirectory(Path.GetDirectoryName(originalPdf)!);
                if (!await window.Preview.CoreWebView2.PrintToPdfAsync(originalPdf)) throw new IOException("Original PrintToPdf failed");
                window.SetEngine("legacy");
                await WaitFor(window, "document.querySelector('.qiita :is(.qiita-note-warn,.note.warn)') !== null");
                await WaitForNavigation(window);
                checks.Add("Upstream PDF export and return to edition-supported engine");
            }
            window.SetMode("qiita");
            await WaitFor(window, "document.querySelector('.qiita :is(.qiita-note-warn,.note.warn)') !== null && document.querySelector('.diagram svg') !== null");
            checks.Add("Native Qiita switch rendered notes and diagrams");
            await CheckServicePresentation(window, checks, window.Settings.Engine, "qiita");
            await WaitFor(window, "window.mdv.find('Markdown').total > 0");
            checks.Add("Document search");
            await WaitFor(window, "window.mdv.scrollToAnchor('" + sampleAnchor + "')");
            checks.Add("Japanese heading navigation");
            await window.Preview.CoreWebView2.ExecuteScriptAsync("window.mdv.find(''); window.scrollTo(0,0);");
            var reportPath = ReportPath(args);
            Directory.CreateDirectory(Path.GetDirectoryName(reportPath)!);
            await using (var stream = File.Create(Path.ChangeExtension(reportPath, ".png")))
                await window.Preview.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
            var pdf = Path.ChangeExtension(reportPath, ".pdf");
            if (!await window.Preview.CoreWebView2.PrintToPdfAsync(pdf)) throw new IOException("PrintToPdf failed");
            checks.Add("PDF export");
            var watchedPath = Path.Combine(Path.GetDirectoryName(reportPath)!, "watch-test.md");
            await File.WriteAllTextAsync(watchedPath, "# Before\n\n[次の文書](next.md#destination)");
            var paragraphs = string.Concat(Enumerable.Range(1, 70).Select(i => $"段落 {i}: 閲覧位置を確認するための文章です。\n\n"));
            await File.WriteAllTextAsync(Path.Combine(Path.GetDirectoryName(reportPath)!, "next.md"), "# Next\n\n" + paragraphs + "## Destination\n\n" + paragraphs);
            await window.OpenDocumentAsync(watchedPath, remember: false);
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Before'");
            checks.Add("Open a local Markdown file");
            var watchedBody = paragraphs + "## 読書位置\n\n[次の文書](next.md#destination)\n\n" + paragraphs;
            await File.WriteAllTextAsync(watchedPath, "# After\n\n" + watchedBody);
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'After'");
            await WaitForNavigation(window);
            checks.Add("File watcher updates preview");
            window.OutlineList.SelectedIndex = 0;
            await WaitFor(window, "Math.abs(document.querySelector('h1').getBoundingClientRect().top - parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)) < 3");
            var headingY = await ScrollY(window);
            window.OutlineList.UpdateLayout();
            var outlineItem = (ListBoxItem)window.OutlineList.ItemContainerGenerator.ContainerFromIndex(0);
            for (var repeat = 0; repeat < 2; repeat++)
            {
                await window.Preview.CoreWebView2.ExecuteScriptAsync("window.scrollTo(0,600)");
                await CheckScroll(window, 600);
                outlineItem.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, Environment.TickCount, MouseButton.Left)
                    { RoutedEvent = Mouse.PreviewMouseDownEvent });
                await CheckScroll(window, headingY);
            }
            window.OutlineList.SelectedIndex = 1;
            await WaitFor(window, "window.scrollY > 1000");
            checks.Add("Outline re-clicks return to the selected heading; selection changes still navigate");
            window.SourceMenu.IsChecked = true;
            window.SourceMenu.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
            await Task.Delay(100);
            window.SourceText.ScrollToVerticalOffset(420);
            await window.Preview.CoreWebView2.ExecuteScriptAsync("window.mdv.scrollToAnchor('読書位置'); window.scrollBy(0,160)");
            var sourceY = window.SourceText.VerticalOffset;
            var beforeY = await ScrollY(window);
            if (sourceY < 300 || beforeY < 1000) throw new InvalidOperationException("Navigation fixture did not scroll both panes.");
            await window.Preview.CoreWebView2.ExecuteScriptAsync("document.querySelector('a[href=\"next.md#destination\"]').click()");
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Next'");
            await WaitForNavigation(window);
            await WaitFor(window, "window.scrollY > 1000");
            checks.Add("Relative Markdown link handled by native host");
            await window.Preview.CoreWebView2.ExecuteScriptAsync("window.scrollBy(0,180)");
            var nextY = await ScrollY(window);
            window.BackButton.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'After'");
            await WaitForNavigation(window);
            await CheckScroll(window, beforeY);
            if (Math.Abs(window.SourceText.VerticalOffset - sourceY) > 3 || !window.ForwardButton.IsEnabled)
                throw new InvalidOperationException($"Source position or forward button was not restored: expected={sourceY}, actual={window.SourceText.VerticalOffset}, forward={window.ForwardButton.IsEnabled}.");
            checks.Add("Back toolbar restores the previous document, preview and source positions");
            await window.Preview.CoreWebView2.ExecuteScriptAsync("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }))");
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Next'");
            await WaitForNavigation(window);
            await CheckScroll(window, nextY);
            checks.Add("Alt+Right from preview restores the forward document and position");
            File.Delete(watchedPath);
            if (await window.NavigateHistoryAsync(-1)) throw new InvalidOperationException("Missing history target unexpectedly opened.");
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Next'");
            await CheckScroll(window, nextY);
            if (!window.BackButton.IsEnabled || window.ForwardButton.IsEnabled) throw new InvalidOperationException("Failed navigation changed history.");
            checks.Add("Missing history target leaves current document, position and history intact");
            await File.WriteAllTextAsync(watchedPath, "# After\n\n" + watchedBody);
            if (!await window.NavigateHistoryAsync(-1)) throw new InvalidOperationException("Back did not recover after recreating the file.");
            await File.WriteAllTextAsync(watchedPath, "# Reloaded\n\n" + watchedBody);
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Reloaded'");
            await WaitForNavigation(window);
            await CheckScroll(window, beforeY);
            if (!window.ForwardButton.IsEnabled) throw new InvalidOperationException("File watcher cleared forward history.");
            await window.OpenDocumentAsync(watchedPath, remember: false);
            if (!window.ForwardButton.IsEnabled) throw new InvalidOperationException("Reopening current file cleared forward history.");
            await window.NavigateHistoryAsync(-1);
            if (window.FileTitle.Text != sampleName || window.BackButton.IsEnabled) throw new InvalidOperationException("Reload inserted duplicate history entries.");
            checks.Add("Automatic reload and reopening the same file preserve history without duplicates");
            await window.NavigateHistoryAsync(1);
            var branchPath = Path.Combine(Path.GetDirectoryName(reportPath)!, "branch.md");
            await File.WriteAllTextAsync(branchPath, "# Branch\n\nNew history branch.");
            await window.OpenDocumentAsync(branchPath, remember: false);
            if (window.ForwardButton.IsEnabled) throw new InvalidOperationException("New navigation retained a stale forward branch.");
            if (await window.OpenDocumentAsync(branchPath + ".missing", quiet: true, anchor: "destination"))
                throw new InvalidOperationException("Missing document unexpectedly opened.");
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Branch'");
            await window.NavigateHistoryAsync(-1);
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Reloaded'");
            await CheckScroll(window, beforeY);
            checks.Add("New visits replace the forward branch; failed file opens do not create history");
            await CheckTabs(window, watchedPath, watchedBody, branchPath, checks);
            var arrowPath = Path.Combine(Path.GetDirectoryName(reportPath)!, "flowchart-root.md");
            await File.WriteAllTextAsync(arrowPath, "```mermaid\nflowchart LR\nA[Root]:::root --> B[Child]\nA --> C[Other]\nclassDef root fill:#BCE2E8,stroke:#7FB8BF;\n```\n");
            await window.OpenDocumentAsync(arrowPath, remember: false);
            await WaitForNavigation(window);
            await WaitFor(window, "document.querySelectorAll('.diagram .flowchart-link').length === 4 && [...document.querySelectorAll('.diagram .flowchart-link')].every(path => getComputedStyle(path).fill === 'none')");
            await WaitFor(window, "getComputedStyle(document.querySelector('.diagram-screen .node.root .label-container')).fill === 'rgb(188, 226, 232)'");
            checks.Add("Authored Mermaid root class preserves node colors without filling arrows in screen/print SVGs");

            if (File.Exists(Path.Combine(window.Portable.Assets, "OriginalEngines", "worker.rb")))
            {
                var highlightPath = Path.Combine(Path.GetDirectoryName(reportPath)!, "highlight-case.md");
                await File.WriteAllTextAsync(highlightPath, "# Highlight\n\n[Link](https://example.com)\n\n```PowerShell:MixedCase.ps1\nfunction Get-Example { $s.ToString() }\n```\n");
                await window.OpenDocumentAsync(highlightPath, remember: false);
                foreach (var selected in BuildEdition.CanSwitch ? new[] { "legacy", "original" } : new[] { BuildEdition.DefaultEngine })
                {
                    window.SetEngine(selected);
                    window.SetMode("qiita");
                    await WaitForNavigation(window);
                    await WaitFor(window, "[...document.querySelectorAll('pre code .nf')].some(n => n.textContent === 'ToString' && getComputedStyle(n).color === 'rgb(139, 223, 76)')");
                    if (selected == "legacy") await WaitFor(window, "document.querySelector('code[data-mdv-highlighter=rouge]') !== null");
                    checks.Add(selected + " Qiita mixed-case PowerShell method highlighting uses Rouge in WebView2");
                    await using (var stream = File.Create(Path.Combine(Path.GetDirectoryName(reportPath)!, "highlight-" + selected + ".png")))
                        await window.Preview.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                    window.SetMode("github");
                    await WaitForNavigation(window);
                    await WaitFor(window, "getComputedStyle(document.querySelector('#document p a')).textDecorationLine === 'underline'");
                    checks.Add(selected + " GitHub body links are underlined without hover in WebView2");
                }
                window.SetEngine("legacy");

            }

            await CheckPerDocumentImageSelection(window, checks, Path.GetDirectoryName(reportPath)!);
            await CheckDocumentImageImport(window, checks, Path.GetDirectoryName(reportPath)!);
            await CheckSavedGithubImages(window, checks, Path.GetDirectoryName(reportPath)!);
            await CheckSavedQiitaImages(window, checks, Path.GetDirectoryName(reportPath)!);
            await CheckQiitaCdnImages(window, checks, Path.GetDirectoryName(reportPath)!);
            await CheckSavedQiitaCards(window, checks, Path.GetDirectoryName(reportPath)!);

            // The tab checks end on an empty tab, where printing is disabled.
            // Open a document before checking enabled and disabled menu colors.
            await window.OpenDocumentAsync(Path.Combine(window.Portable.Assets, "Samples", "welcome.md"), remember: false);
            await WaitForNavigation(window);
            window.SetMode("qiita");
            window.DarkMenu.IsChecked = true;
            window.DarkMenu.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
            window.SourceMenu.IsChecked = true;
            window.SourceMenu.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
            window.OutlineMenu.IsChecked = false;
            window.OutlineMenu.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
            window.SetZoom(1.3);
            await WaitFor(window, "document.documentElement.dataset.theme === 'dark'");
            await CheckMenuThemes(window, checks);
            window.EnglishLanguageMenu.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
            await WaitForNavigation(window);
            checks.Add("Native settings changed for restart verification");
            await FinishAsync();

            async Task FinishAsync()
            {
                var path = ReportPath(args);
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                await File.WriteAllTextAsync(path, JsonSerializer.Serialize(new { success = true, checks,
                    settingsPath = window.SettingsPath, runtime = window.Portable.Runtime, userData = window.Portable.UserData,
                    browserPath, assets = window.Portable.Assets, startupMilliseconds,
                    payloadPreparationMilliseconds = window.Portable.PreparationTime.TotalMilliseconds }, new JsonSerializerOptions { WriteIndented = true }));
                window.Close();
            }
        }
        catch (Exception error) { Fail(args, error, checks); }
    }

    private static async Task CheckWslReload(MainWindow window, string directory, List<string> checks)
    {
        var parts = directory.TrimEnd('\\').Split('\\', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 3 || parts[0] is not ("wsl.localhost" or "wsl$"))
            throw new ArgumentException("Use a WSL UNC directory for --smoke-wsl-directory.");
        var name = "mdv-watch-" + Guid.NewGuid().ToString("N") + ".md";
        var path = Path.Combine(directory, name);
        var linuxPath = "/" + string.Join('/', parts.Skip(2)) + "/" + name;
        async Task Edit(string code)
        {
            var start = new ProcessStartInfo("wsl.exe") { UseShellExecute = false, CreateNoWindow = true };
            foreach (var arg in new[] { "--distribution", parts[1], "--", "python3", "-c",
                "import pathlib,sys,os; p=pathlib.Path(sys.argv[1]); " + code, linuxPath }) start.ArgumentList.Add(arg);
            using var process = Process.Start(start)!;
            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(15));
            if (process.ExitCode != 0) throw new IOException("WSL test edit failed.");
        }
        try
        {
            await Edit("p.write_text('# Before')");
            await window.OpenDocumentAsync(path, remember: false);
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Before'");
            await Edit("s=p.stat(); p.write_text('# Edited'); os.utime(p, ns=(s.st_atime_ns, s.st_mtime_ns))");
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Edited'");
            checks.Add("Linux-side edit with identical size and timestamp automatically refreshed");
            await Edit("q=p.with_suffix('.tmp'); q.write_text('# Replaced'); q.replace(p)");
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Replaced'");
            checks.Add("Linux-side atomic save automatically refreshed");
            await Edit("p.unlink()");
            await Task.Delay(2500);
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Replaced'");
            await Edit("p.write_text('# Restored')");
            await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Restored'");
            checks.Add("Missing file preserves preview and resumes after recreation");
            await WaitForNavigation(window);
            var request = await window.Preview.CoreWebView2.ExecuteScriptAsync("window.mdv.requestId");
            await Task.Delay(4500);
            if (request != await window.Preview.CoreWebView2.ExecuteScriptAsync("window.mdv.requestId"))
                throw new InvalidOperationException("Unchanged WSL document was rendered again.");
            if (window.Workspace.Active.History.CanGoForward) throw new InvalidOperationException("Polling changed history.");
            checks.Add("Unchanged WSL document does not trigger rendering");
        }
        finally { await Edit("p.unlink(missing_ok=True); p.with_suffix('.tmp').unlink(missing_ok=True)"); }
    }

    private static async Task CheckTabs(MainWindow window, string watchedPath, string watchedBody, string branchPath, List<string> checks)
    {
        var first = window.Workspace.Active;
        window.SetZoom(1.15);
        window.FindBar.Visibility = Visibility.Visible;
        window.FindInput.Text = "段落";
        await WaitFor(window, "CSS.highlights.get('mdv-search')?.size > 0");
        window.SourceText.ScrollToVerticalOffset(460);
        await window.Preview.CoreWebView2.ExecuteScriptAsync("window.mdv.scrollToAnchor('読書位置'); window.scrollBy(0,140)");
        var firstY = await ScrollY(window);
        var sourceY = window.SourceText.VerticalOffset;
        await window.Preview.CoreWebView2.ExecuteScriptAsync("document.querySelector('a[href=\"next.md#destination\"]').dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true }))");
        await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Next'");
        await WaitForNavigation(window);
        var second = window.Workspace.Active;
        if (window.Workspace.Tabs.Count != 2 || ReferenceEquals(first, second) || window.BackButton.IsEnabled ||
            !first.History.CanGoForward || window.FindBar.Visibility != Visibility.Collapsed)
            throw new InvalidOperationException("Ctrl+click did not create an independent tab.");
        checks.Add("Ctrl+click creates a tab and leaves the originating history intact");

        window.SetMode("github");
        await WaitForNavigation(window);
        window.SetZoom(.9);
        await window.Preview.CoreWebView2.ExecuteScriptAsync("window.mdv.scrollToAnchor('destination'); window.scrollBy(0,210)");
        var secondY = await ScrollY(window);
        await window.OpenDocumentAsync(branchPath, remember: false);
        await window.NavigateHistoryAsync(-1);
        await CheckScroll(window, secondY);
        window.DocumentTabs.SelectedItem = first;
        await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Reloaded'");
        await WaitForNavigation(window);
        await CheckScroll(window, firstY);
        if (window.Settings.Mode != "qiita" || Math.Abs(window.Preview.ZoomFactor - 1.15) > .001 ||
            window.FindInput.Text != "段落" || window.FindBar.Visibility != Visibility.Visible ||
            Math.Abs(window.SourceText.VerticalOffset - sourceY) > 3 || !window.ForwardButton.IsEnabled)
            throw new InvalidOperationException("Tab selection did not restore mode, zoom, search, source position or history.");
        await window.NavigateHistoryAsync(1);
        if (second.History.Current?.FilePath != Path.Combine(Path.GetDirectoryName(watchedPath)!, "next.md") || !second.History.CanGoForward)
            throw new InvalidOperationException("Navigation in the first tab changed the second tab's history.");
        await window.NavigateHistoryAsync(-1);
        checks.Add("Native tab selection restores preview/source positions, mode, zoom, search and independent history");

        var nextPath = Path.Combine(Path.GetDirectoryName(watchedPath)!, "next.md");
        await window.OpenDocumentAsync(nextPath, newTab: true);
        await CheckScroll(window, secondY);
        if (window.Workspace.Tabs.Count != 2 || !ReferenceEquals(window.Workspace.Active, second) ||
            window.Settings.Mode != "github" || Math.Abs(window.Preview.ZoomFactor - .9) > .001)
            throw new InvalidOperationException("Reopening a document duplicated its tab or lost its settings.");
        checks.Add("Reopening an existing file selects its tab without duplication");

        await File.WriteAllTextAsync(watchedPath, "# Tab refreshed\n\n" + watchedBody);
        await window.SelectTabAsync(first);
        await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Tab refreshed'");
        await CheckScroll(window, firstY);
        await window.SelectTabAsync(second);
        File.Delete(watchedPath);
        await window.SelectTabAsync(first);
        await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Tab refreshed'");
        await CheckScroll(window, firstY);
        if (!window.StatusText.Text.Contains("前回読み込んだ内容")) throw new InvalidOperationException("Missing inactive file lost its retained content.");
        checks.Add("Inactive tabs refresh changed files and retain their content when files disappear");

        if (await window.OpenDocumentAsync(branchPath + ".missing", newTab: true, quiet: true) || window.Workspace.Tabs.Count != 2 ||
            !ReferenceEquals(window.Workspace.Active, first)) throw new InvalidOperationException("Failed open created or switched a tab.");
        await File.WriteAllTextAsync(watchedPath, "# Tab refreshed\n\n" + watchedBody);
        await window.OpenFilesAsync([watchedPath, branchPath, nextPath]);
        if (window.Workspace.Tabs.Count != 3 || !ReferenceEquals(window.Workspace.Active, second))
            throw new InvalidOperationException("Opening multiple files did not reuse existing tabs.");
        checks.Add("Multi-file opening reuses existing tabs and failed opens leave tabs unchanged");

        await window.CloseTabAsync(first);
        await CheckScroll(window, secondY);
        if (!ReferenceEquals(window.Workspace.Active, second) || window.Workspace.Tabs.Count != 2)
            throw new InvalidOperationException("Closing an inactive tab changed the active document.");
        await TabKey(window, "Tab");
        await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Branch'");
        await WaitForNavigation(window);
        await TabKey(window, "Tab", shift: true);
        await WaitFor(window, "document.querySelector('h1')?.textContent.trim() === 'Next'");
        await WaitForNavigation(window);
        await CheckScroll(window, secondY);
        checks.Add("Ctrl+Tab and Ctrl+Shift+Tab cycle tabs after an inactive tab closes");

        var branch = window.Workspace.Find(branchPath)!;
        window.DocumentTabs.UpdateLayout();
        var item = (ListBoxItem)window.DocumentTabs.ItemContainerGenerator.ContainerFromItem(branch);
        var close = Descendants(item).OfType<Button>().Single();
        close.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        await WaitForNavigation(window);
        if (window.Workspace.Tabs.Count != 1 || !ReferenceEquals(window.Workspace.Active, second))
            throw new InvalidOperationException("The tab close button activated the tab being closed.");
        checks.Add("An inactive tab's close button leaves the current document selected");

        await TabKey(window, "t");
        await WaitFor(window, "document.querySelector('#document').textContent === ''");
        await WaitForNavigation(window);
        if (window.Workspace.Tabs.Count != 2 || window.EmptyPanel.Visibility != Visibility.Visible ||
            window.BackButton.IsEnabled || window.PrintMenu.IsEnabled || window.SourceText.Text.Length != 0)
            throw new InvalidOperationException("Ctrl+T did not create a clean empty tab.");
        await window.OpenFilesAsync([watchedPath]);
        if (window.Workspace.Tabs.Count != 2 || window.BackButton.IsEnabled || window.EmptyPanel.Visibility != Visibility.Collapsed)
            throw new InvalidOperationException("Opening a file did not reuse the empty tab.");
        await window.CloseTabAsync(second);
        await TabKey(window, "w");
        await WaitFor(window, "document.querySelector('#document').textContent === ''");
        await WaitForNavigation(window);
        if (window.Workspace.Tabs.Count != 1 || window.Workspace.Active.Document != null || window.Workspace.Active.History.Current != null ||
            window.EmptyPanel.Visibility != Visibility.Visible || window.ForwardButton.IsEnabled)
            throw new InvalidOperationException("Closing the last tab did not leave a fresh empty tab.");
        checks.Add("Ctrl+T creates a reusable empty tab and Ctrl+W safely closes the last document");
    }

    private static async Task CheckMenuThemes(MainWindow window, List<string> checks)
    {
        var fileMenu = (MenuItem)window.MainMenu.Items[0];
        foreach (var dark in new[] { false, true })
        {
            window.DarkMenu.IsChecked = dark;
            window.DarkMenu.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
            await WaitForNavigation(window);
            fileMenu.IsSubmenuOpen = true;
            await window.Dispatcher.InvokeAsync(() => { }, System.Windows.Threading.DispatcherPriority.ApplicationIdle);
            window.PrintMenu.ApplyTemplate();
            var gesture = (TextBlock)window.PrintMenu.Template.FindName("Gesture", window.PrintMenu);
            var frame = (Border)window.PrintMenu.Template.FindName("Frame", window.PrintMenu);
            var popup = (System.Windows.Controls.Primitives.Popup)fileMenu.Template.FindName("PART_Popup", fileMenu);
            RequireColor(window.PrintMenu.Foreground, "TextBrush");
            RequireColor(gesture.Foreground, "TextBrush");
            RequireColor(frame.Background, window.PrintMenu.IsHighlighted ? "SelectionBrush" : "PanelBrush");
            RequireColor(((Border)popup.Child).Background, "PanelBrush");
            var enabled = window.PrintMenu.IsEnabled;
            try
            {
                window.PrintMenu.IsEnabled = false;
                RequireColor(window.PrintMenu.Foreground, "MutedBrush");
                RequireColor(gesture.Foreground, "MutedBrush");
            }
            finally { window.PrintMenu.IsEnabled = enabled; fileMenu.IsSubmenuOpen = false; }
        }
        checks.Add("Light/dark menus preserve header, shortcut, disabled and popup colors");

        static void RequireColor(Brush actual, string key)
        {
            if (actual is not SolidColorBrush solid || solid.Color != ((SolidColorBrush)Application.Current.Resources[key]).Color)
                throw new InvalidOperationException("Menu color does not match " + key);
        }
    }

    private static async Task CheckHttpImage(MainWindow window, List<string> checks)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var serve = Task.Run(async () =>
        {
            using var client = await listener.AcceptTcpClientAsync(deadline.Token);
            await using var stream = client.GetStream();
            using var reader = new StreamReader(stream, Encoding.ASCII, leaveOpen: true);
            if (await reader.ReadLineAsync(deadline.Token) != "GET /image.gif HTTP/1.1")
                throw new IOException("Native image request did not reach the HTTP endpoint.");
            while (await reader.ReadLineAsync(deadline.Token) is { Length: > 0 }) { }
            var bytes = Convert.FromBase64String("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");
            await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Type: image/gif\r\nContent-Length: {bytes.Length}\r\nConnection: close\r\n\r\n"), deadline.Token);
            await stream.WriteAsync(bytes, deadline.Token);
        }, deadline.Token);
        var previous = window.CurrentImageSelection;
        try
        {
            window.SetRemoteImages(true);
            await WaitForNavigation(window);
            var url = $"https://document.mdv.invalid/remote-image/{Uri.EscapeDataString($"http://127.0.0.1:{port}/image.gif")}";
            await window.Preview.CoreWebView2.ExecuteScriptAsync("{ const image = document.createElement('img'); image.id = 'mdv-http-smoke'; image.src = " +
                JsonSerializer.Serialize(url) + "; document.querySelector('#document').prepend(image); }");
            await WaitFor(window, "document.getElementById('mdv-http-smoke')?.naturalWidth === 1");
            await serve;
            checks.Add("HTTP-only image loaded through the native image route");
        }
        finally
        {
            window.SetImageSelection(previous);
            await WaitForNavigation(window);
            deadline.Cancel();
            await window.Preview.CoreWebView2.ExecuteScriptAsync("document.getElementById('mdv-http-smoke')?.remove()");
        }
    }

    private static Task TabKey(MainWindow window, string key, bool shift = false) =>
        window.Preview.CoreWebView2.ExecuteScriptAsync("document.dispatchEvent(new KeyboardEvent('keydown', " +
            JsonSerializer.Serialize(new { key, ctrlKey = true, shiftKey = shift, bubbles = true }) + "))");

    private static IEnumerable<DependencyObject> Descendants(DependencyObject root)
    {
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(root); index++)
        {
            var child = VisualTreeHelper.GetChild(root, index);
            yield return child;
            foreach (var descendant in Descendants(child)) yield return descendant;
        }
    }

    private static async Task WaitForNavigation(MainWindow window)
    {
        for (var attempt = 0; attempt < 200; attempt++)
        {
            if (window.NavigationReady) return;
            await Task.Delay(50);
        }
        throw new InvalidOperationException("Navigation did not finish.");
    }

    private static async Task CheckPerDocumentImageSelection(MainWindow window, List<string> checks, string folder)
    {
        const string source = "https://example.com/per-document.png";
        var cdn = "https://qiita-user-contents.imgix.net/" + Uri.EscapeDataString(source) + "?w=1400&s=document-fixture";
        var previousEngine = window.Settings.Engine;
        void ServeFixture(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            if (e.Request.Uri != source && e.Request.Uri != cdn) return;
            if (e.Response != null) return; // A request from a tab being left may already be blocked.
            var pixels = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=");
            e.Response = window.Preview.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(pixels), 200, "OK", "Content-Type: image/png");
        }
        window.Preview.CoreWebView2.WebResourceRequested += ServeFixture;
        try
        {
            foreach (var engine in BuildEdition.CanSwitch ? new[] { "legacy", "original" } : new[] { BuildEdition.DefaultEngine })
            {
                var first = Path.Combine(folder, "image-preferences-first-" + engine + ".md");
                var second = Path.Combine(folder, "image-preferences-second-" + engine + ".md");
                var third = Path.Combine(folder, "image-preferences-third-" + engine + ".md");
                foreach (var path in new[] { first, second, third }) await File.WriteAllTextAsync(path, "![Image](" + source + ")");
                using (var importer = new DocumentImageImporter(remoteHandler: new SavedImageTestHandler("")))
                    await importer.ImportAsync(first, true, [source]);
                await window.OpenDocumentAsync(first, remember: false, newTab: true);
                window.SetEngine(engine); window.SetMode("qiita");
                window.SetQiitaCdnImages(first, new() { [source] = cdn });
                await WaitForNavigation(window);
                var firstTab = window.Workspace.Active;
                await window.OpenDocumentAsync(second, remember: false, newTab: true);
                window.SetMode("qiita"); window.SetRemoteImages(true);
                await WaitForNavigation(window);
                var secondTab = window.Workspace.Active;
                await window.SelectTabAsync(firstTab);
                await WaitFor(window, "document.querySelector('#document img').naturalWidth === 1");
                if (window.CurrentImageSelection != ImageSourceSelection.Cdn || !window.QiitaCdnImagesMenu.IsChecked || window.RemoteImagesMenu.IsChecked)
                    throw new IOException("Qiita CDN choice did not survive switching documents.");
                window.SetMode("github"); window.SetSavedGithubImages(true);
                await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('#document img').src.includes('/github-image/') && document.querySelector('#document img').naturalWidth === 1");
                await window.SelectTabAsync(secondTab);
                if (window.CurrentImageSelection != ImageSourceSelection.Remote || !window.RemoteImagesMenu.IsChecked)
                    throw new IOException("The second document lost its remote-image choice.");
                window.SetMode("github"); window.SetRemoteImages(true);
                await WaitForNavigation(window);
                await window.OpenDocumentAsync(third, remember: false);
                window.SetImageSelection(ImageSourceSelection.Off);
                await WaitForNavigation(window);
                await window.NavigateHistoryAsync(-1);
                await WaitForNavigation(window);
                if (window.Workspace.Active.Document?.FilePath != second || window.CurrentImageSelection != ImageSourceSelection.Remote)
                    throw new IOException("History navigation did not restore the document's image choice.");
                await window.SelectTabAsync(firstTab);
                if (window.CurrentImageSelection != ImageSourceSelection.Saved || !window.SavedGithubImagesMenu.IsChecked || window.RemoteImagesMenu.IsChecked)
                    throw new IOException("GitHub saved-image choice did not survive switching documents.");
                window.SetMode("qiita"); await WaitForNavigation(window);
                await window.OpenDocumentAsync(first, remember: false);
                if (window.CurrentImageSelection != ImageSourceSelection.Cdn || !window.QiitaCdnImagesMenu.IsChecked)
                    throw new IOException("Reload or syntax changes lost the document's Qiita image choice.");
                checks.Add(engine + " image choices follow each document and syntax mode across tabs, history and reload");
                window.SetImageSelection(ImageSourceSelection.Off);
                await WaitForNavigation(window);
            }
        }
        finally
        {
            window.Preview.CoreWebView2.WebResourceRequested -= ServeFixture;
            window.SetEngine(previousEngine);
        }
    }

    private static async Task CheckDocumentImageImport(MainWindow window, List<string> checks, string folder)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var pixels = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=");
        await File.WriteAllBytesAsync(Path.Combine(folder, "local-import.png"), pixels);
        var expected = BuildEdition.CanSwitch ? 4 : 2;
        var serve = Task.Run(async () =>
        {
            for (var request = 0; request < expected; request++)
            {
                using var client = await listener.AcceptTcpClientAsync(deadline.Token);
                await using var stream = client.GetStream();
                using var reader = new StreamReader(stream, Encoding.ASCII, leaveOpen: true);
                while (await reader.ReadLineAsync(deadline.Token) is { Length: > 0 }) { }
                await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {pixels.Length}\r\nConnection: close\r\n\r\n"), deadline.Token);
                await stream.WriteAsync(pixels, deadline.Token);
            }
        }, deadline.Token);
        var remote = window.Settings.AllowRemoteImages;
        var savedGithub = window.Settings.UseSavedGithubImages;
        var savedQiita = window.Settings.UseSavedQiitaImages;
        var previousEngine = window.Settings.Engine;
        try
        {
            foreach (var github in new[] { true, false })
            foreach (var engine in BuildEdition.CanSwitch ? new[] { "legacy", "original" } : new[] { BuildEdition.DefaultEngine })
            {
                window.Settings.AllowRemoteImages = false;
                var path = Path.Combine(folder, $"no article URL-{github}-{engine}.md");
                await File.WriteAllTextAsync(path, $"![Remote](http://127.0.0.1:{port}/image.png)\n\n![Local](local-import.png)\n\n![Missing](missing-import.png)");
                await window.OpenDocumentAsync(path, remember: false);
                window.SetMode(github ? "github" : "qiita"); window.SetEngine(engine);
                await WaitForNavigation(window);
                var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                var stage = 0;
                var timer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(50) };
                timer.Tick += (_, _) =>
                {
                    var dialog = window.OwnedWindows.Cast<Window>().FirstOrDefault(w => w.IsVisible);
                    if (dialog == null) return;
                    try
                    {
                        var fields = Descendants(dialog).OfType<TextBox>().ToArray();
                        if (stage == 0)
                        {
                            var option = Descendants(dialog).OfType<CheckBox>().SingleOrDefault();
                            if (option == null || fields.Length == 0) return;
                            if (option.IsChecked == true || fields[0].IsEnabled || fields[0].Text.Length != 0)
                                throw new IOException("Saving images unexpectedly requires a service URL by default.");
                            option.IsChecked = true;
                            if (!fields[0].IsEnabled) throw new IOException("Optional service URL field was not enabled.");
                            option.IsChecked = false;
                            stage = 1;
                            Descendants(dialog).OfType<Button>().Single(b => b.IsDefault).RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
                        }
                        else if (stage == 1 && fields.Any(f => f.IsReadOnly))
                        {
                            var text = fields.Single(f => f.IsReadOnly).Text;
                            if (!text.Contains("missing-import.png")) throw new IOException("Download results did not list the unresolved image.");
                            timer.Stop(); dialog.Close(); completion.TrySetResult(true);
                        }
                    }
                    catch (Exception error) { timer.Stop(); dialog.Close(); completion.TrySetException(error); }
                };
                timer.Start();
                try
                {
                    ((MenuItem)(github ? window.GithubImagesMenu : window.QiitaImagesMenu).Items[0]).RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
                    await completion.Task.WaitAsync(TimeSpan.FromSeconds(15));
                }
                finally { timer.Stop(); }
                await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('#document img').naturalWidth === 1 && document.querySelector('#document img').src.includes('-image/')");
                var manifest = QiitaImageArchive.Load(path, github)!;
                if (manifest.ArticleUrl.Length != 0 || manifest.Images.Length != 1 || !manifest.Images[0].Direct || window.RemoteImagesMenu.IsChecked)
                    throw new IOException("URL-free image snapshot or offline selection was incorrect.");
                checks.Add(engine + " " + (github ? "GitHub" : "Qiita") + " save dialog needs no article URL, reports missing images and displays the direct snapshot offline");
            }
            await serve;
        }
        finally
        {
            deadline.Cancel();
            window.Settings.UseSavedGithubImages = savedGithub;
            window.Settings.UseSavedQiitaImages = savedQiita;
            window.Settings.AllowRemoteImages = remote;
            window.SetEngine(previousEngine);
        }
    }

    private static async Task CheckSavedGithubImages(MainWindow window, List<string> checks, string folder)
    {
        const string source = "https://raw.githubusercontent.com/example/repo/main/image.png";
        var path = Path.Combine(folder, "saved GitHub images.md");
        await File.WriteAllTextAsync(path, "![Saved](" + source + ")");
        using (var importer = new GithubImageImporter(new SavedImageTestHandler("")))
            await importer.ImportAsync(path, "https://github.com/example/repo/blob/main/readme.md", [source]);
        var remote = window.Settings.AllowRemoteImages;
        var saved = window.Settings.UseSavedGithubImages;
        var previousEngine = window.Settings.Engine;
        var originalRequests = 0;
        void ServeFixture(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            if (e.Request.Uri != source) return;
            if (e.Response != null) throw new IOException("Selected GitHub original image was blocked.");
            originalRequests++;
            var bytes = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=");
            e.Response = window.Preview.CoreWebView2.Environment.CreateWebResourceResponse(
                new MemoryStream(bytes), 200, "OK", "Content-Type: image/png\r\nCache-Control: no-store");
        }
        window.Preview.CoreWebView2.WebResourceRequested += ServeFixture;
        try
        {
            window.Settings.AllowRemoteImages = false;
            await window.OpenDocumentAsync(path, remember: false);
            foreach (var engine in BuildEdition.CanSwitch ? new[] { "legacy", "original" } : new[] { BuildEdition.DefaultEngine })
            {
                window.SetEngine(engine); window.SetMode("github");
                window.SetRemoteImages(true);
                await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('#document img').naturalWidth === 1 && document.querySelector('#document img').src.startsWith('https://raw.githubusercontent.com/')");
                if (!window.RemoteImagesMenu.IsChecked || window.SavedGithubImagesMenu.IsChecked)
                    throw new IOException("Selecting GitHub original images did not disable saved images.");
                var before = originalRequests;
                window.SetSavedGithubImages(true);
                await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('#document img').naturalWidth === 1 && document.querySelector('#document img').src.includes('/github-image/')");
                if (!window.SavedGithubImagesMenu.IsChecked || window.RemoteImagesMenu.IsChecked || originalRequests != before)
                    throw new IOException("Selecting saved GitHub images did not disable remote image requests.");
                window.SetSavedGithubImages(false);
                await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('#document img.blocked-image') !== null");
                if (window.SavedGithubImagesMenu.IsChecked || window.RemoteImagesMenu.IsChecked)
                    throw new IOException("Both GitHub image options should be off.");
                checks.Add(engine + " GitHub saved and remote image menus are mutually exclusive and both can be disabled");
            }
        }
        finally
        {
            window.Preview.CoreWebView2.WebResourceRequested -= ServeFixture;
            window.Settings.UseSavedGithubImages = saved;
            window.Settings.AllowRemoteImages = remote;
            window.SetEngine(previousEngine);
        }
    }

    private static async Task CheckSavedQiitaImages(MainWindow window, List<string> checks, string folder)
    {
        const string original = "https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/1/offline.png";
        var service = "https://qiita-user-contents.imgix.net/" + Uri.EscapeDataString(original) + "?w=1400&q=75&s=fixture";
        var path = Path.Combine(folder, "saved Qiita images.md");
        await File.WriteAllTextAsync(path, "![Offline](" + original + ")");
        using (var importer = new QiitaImageImporter(new SavedImageTestHandler(service)))
            await importer.ImportAsync(path, "https://qiita.com/example/items/0123456789abcdef0123", [original]);
        var remote = window.Settings.AllowRemoteImages;
        var saved = window.Settings.UseSavedQiitaImages;
        var previousEngine = window.Settings.Engine;
        try
        {
            window.Settings.AllowRemoteImages = false;
            await window.OpenDocumentAsync(path, remember: false);
            foreach (var engine in BuildEdition.CanSwitch ? new[] { "legacy", "original" } : new[] { BuildEdition.DefaultEngine })
            {
                window.SetEngine(engine); window.SetMode("qiita"); window.SetSavedQiitaImages(true);
                await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('#document img').naturalWidth === 1 && document.querySelector('#document img').src.includes('/qiita-image/')");
                checks.Add(engine + " saved Qiita image loads through native archive route with remote images disabled");
                window.SetSavedQiitaImages(false); await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('#document img.blocked-image') !== null");
                window.SetSavedQiitaImages(true); window.SetMode("github"); await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('#document img.blocked-image') !== null");
                checks.Add(engine + " saved-image toggle restores originals and GitHub mode ignores Qiita snapshots");
            }
            window.SetMode("qiita"); await WaitForNavigation(window);
            ((MenuItem)window.QiitaImagesMenu.Items[2]).RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
            await WaitForNavigation(window);
            await WaitFor(window, "document.querySelector('#document img.blocked-image') !== null");
            if (File.Exists(QiitaImageArchive.PathFor(path))) throw new IOException("Saved Qiita images were not deleted.");
            checks.Add("Delete saved Qiita images removes only the document snapshot and restores original image handling");
        }
        finally { window.Settings.AllowRemoteImages = remote; window.SetSavedQiitaImages(saved); window.SetEngine(previousEngine); }
    }

    private static async Task CheckQiitaCdnImages(MainWindow window, List<string> checks, string folder)
    {
        const string original = "https://example.com/cdn-fixture.png";
        var service = "https://qiita-user-contents.imgix.net/" + Uri.EscapeDataString(original) + "?w=1400&s=fixture";
        var path = Path.Combine(folder, "Qiita CDN images.md");
        await File.WriteAllTextAsync(path, "<img src=\"" + original + "\" width=\"80\"> ");
        var remote = window.Settings.AllowRemoteImages;
        var previousEngine = window.Settings.Engine;
        var allowed = 0;
        var blocked = 0;
        void ServeFixture(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            if (e.Request.Uri != service && e.Request.Uri != original) return;
            if (e.Request.Uri == service)
            {
                if (e.Response == null) allowed++; else blocked++;
            }
            var bytes = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=");
            e.Response = window.Preview.CoreWebView2.Environment.CreateWebResourceResponse(
                new MemoryStream(bytes), 200, "OK", "Content-Type: image/png\r\nCache-Control: no-store");
        }
        window.Preview.CoreWebView2.WebResourceRequested += ServeFixture;
        try
        {
            window.Settings.AllowRemoteImages = false;
            await window.OpenDocumentAsync(path, remember: false);
            foreach (var engine in BuildEdition.CanSwitch ? new[] { "legacy", "original" } : new[] { BuildEdition.DefaultEngine })
            {
                window.SetEngine(engine); window.SetMode("qiita");
                // Use a distinct signed fixture per engine so WebView2's in-memory
                // image reuse cannot hide the native authorization request.
                service = "https://qiita-user-contents.imgix.net/" + Uri.EscapeDataString(original) + "?w=1400&s=fixture-" + engine;
                var before = allowed;
                window.SetQiitaCdnImages(path, new() { [original] = service });
                await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('#document img').naturalWidth === 1 && document.querySelector('#document img').src.includes('qiita-user-contents.imgix.net')");
                await WaitFor(window, "document.querySelector('#document img').getAttribute('width') === '80'");
                if (blocked != 0 || allowed <= before || !window.QiitaCdnImagesMenu.IsChecked || window.RemoteImagesMenu.IsChecked || window.SavedQiitaImagesMenu.IsChecked)
                    throw new IOException($"CDN authorization check failed: engine={engine}, allowed={allowed}, before={before}, blocked={blocked}, checked={window.QiitaCdnImagesMenu.IsChecked}.");
                window.SetMode("github"); await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('#document img.blocked-image') !== null");
                window.SetMode("qiita"); await WaitForNavigation(window);
                window.QiitaCdnImagesMenu.IsChecked = false;
                window.QiitaCdnImagesMenu.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
                await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('#document img.blocked-image') !== null");
                window.SetQiitaCdnImages(path, new() { [original] = service });
                window.SetSavedQiitaImages(true);
                await WaitForNavigation(window);
                if (!window.SavedQiitaImagesMenu.IsChecked || window.RemoteImagesMenu.IsChecked || window.QiitaCdnImagesMenu.IsChecked)
                    throw new IOException("Selecting saved images did not disable the other image sources.");
                window.SetQiitaCdnImages(path, new() { [original] = service });
                await WaitForNavigation(window);
                window.SetRemoteImages(true);
                await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('#document img').naturalWidth === 1 && document.querySelector('#document img').src === 'https://example.com/cdn-fixture.png'");
                if (!window.RemoteImagesMenu.IsChecked || window.SavedQiitaImagesMenu.IsChecked || window.QiitaCdnImagesMenu.IsChecked)
                    throw new IOException("Selecting original images did not disable the other image sources.");
                window.SetRemoteImages(false);
                await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('#document img.blocked-image') !== null");
                checks.Add(engine + " Qiita image source menus are mutually exclusive for CDN, saved and original images");
                checks.Add(engine + " Qiita CDN image loads through native authorization, preserves width, ignores GitHub mode and can be disabled");
            }
        }
        finally
        {
            window.Preview.CoreWebView2.WebResourceRequested -= ServeFixture;
            window.SetQiitaCdnImages(path, null);
            window.Settings.AllowRemoteImages = remote;
            window.SetEngine(previousEngine);
        }
    }

    private static async Task CheckSavedQiitaCards(MainWindow window, List<string> checks, string folder)
    {
        const string url = "https://example.com/offline-card";
        var path = Path.Combine(folder, "saved Qiita cards.md");
        await File.WriteAllTextAsync(path, url);
        using (var importer = new QiitaCardImporter(new SavedCardTestHandler(), new SavedImageTestHandler("")))
            await importer.ImportAsync(path, [url]);
        var remote = window.Settings.AllowRemoteImages;
        var saved = window.Settings.UseSavedQiitaCards;
        var previousEngine = window.Settings.Engine;
        try
        {
            window.Settings.AllowRemoteImages = false;
            await window.OpenDocumentAsync(path, remember: false);
            foreach (var engine in BuildEdition.CanSwitch ? new[] { "legacy", "original" } : new[] { BuildEdition.DefaultEngine })
            {
                window.SetEngine(engine); window.SetMode("qiita"); window.SetSavedQiitaCards(true);
                await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('.saved-card-title')?.textContent === 'Offline card title' && document.querySelector('.saved-link-card img')?.naturalWidth === 1");
                checks.Add(engine + " saved Qiita card and thumbnail load offline through native archive route");
                window.SetSavedQiitaCards(false); await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('.link-card') !== null && document.querySelector('.saved-link-card') === null");
                window.SetSavedQiitaCards(true); window.SetMode("github"); await WaitForNavigation(window);
                await WaitFor(window, "document.querySelector('.saved-link-card') === null");
                checks.Add(engine + " card toggle restores URL fallback and GitHub ignores Qiita cards");
            }
            window.SetMode("qiita"); await WaitForNavigation(window);
            ((MenuItem)window.QiitaCardsMenu.Items[2]).RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
            await WaitForNavigation(window);
            await WaitFor(window, "document.querySelector('.saved-link-card') === null");
            if (File.Exists(QiitaCardArchive.PathFor(path))) throw new IOException("Saved cards were not deleted.");
            checks.Add("Delete saved Qiita cards removes the snapshot and restores the offline URL fallback");
        }
        finally { window.Settings.AllowRemoteImages = remote; window.SetSavedQiitaCards(saved); window.SetEngine(previousEngine); }
    }

    private sealed class SavedCardTestHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(
                "{\"title\":\"Offline card title\",\"url\":\"https://example.com/\",\"image\":\"https://example.com/thumbnail.png\"}", Encoding.UTF8, "application/json") });
        }
    }

    private sealed class SavedImageTestHandler(string service) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            var response = new HttpResponseMessage(HttpStatusCode.OK);
            if (request.RequestUri!.Host == "qiita.com") response.Content = new StringContent("<img src=\"" + WebUtility.HtmlEncode(service) + "\">", Encoding.UTF8, "text/html");
            else
            {
                response.Content = new ByteArrayContent(Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII="));
                response.Content.Headers.ContentType = new("image/png");
            }
            return Task.FromResult(response);
        }
    }

    private static async Task<double> ScrollY(MainWindow window) =>
        JsonSerializer.Deserialize<double>(await window.Preview.CoreWebView2.ExecuteScriptAsync("window.scrollY"));

    private static Task CheckScroll(MainWindow window, double expected) =>
        WaitFor(window, $"Math.abs(window.scrollY - {expected.ToString("R", System.Globalization.CultureInfo.InvariantCulture)}) < 3");

    private static async Task WaitFor(MainWindow window, string expression)
    {
        for (var attempt = 0; attempt < 100; attempt++)
        {
            if (await window.Preview.CoreWebView2.ExecuteScriptAsync(expression) == "true") return;
            await Task.Delay(100);
        }
        var state = await window.Preview.CoreWebView2.ExecuteScriptAsync("JSON.stringify({ y: scrollY, heading: document.querySelector('h1')?.getBoundingClientRect().top, id: document.querySelector('h1')?.id })");
        throw new InvalidOperationException($"Failed: {expression}; view={state}; outline={window.OutlineList.SelectedIndex}; rendering={!window.NavigationReady}");
    }

    internal static void Fail(string[] args, Exception error, List<string>? checks = null)
    {
        try
        {
            var path = ReportPath(args);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(new { success = false, checks, error = error.ToString() }, new JsonSerializerOptions { WriteIndented = true }));
        }
        finally { Application.Current.Shutdown(1); }
    }
}
