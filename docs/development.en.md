# Building and testing

[日本語](development.md)

These steps are unnecessary when using a distribution EXE. Run commands from the repository root.

## Requirements

Use Windows x64, .NET 10 SDK, Node.js 22 or newer, and PowerShell 7. The dual and upstream editions also require Ruby 3.4.11 x64, Bundler 2.6.9, a native gem build environment such as RubyInstaller Devkit, and Git. Initial dependency and runtime downloads require internet access.

## Build distribution EXEs

```powershell
# Use a destination directory that does not exist yet
.\scripts\prepare-original-engines.ps1 -RubyDirectory C:\Ruby34-x64
# Release build: all three editions, maximum Zstandard level
.\scripts\build.ps1 -Edition all -OriginalEngineDirectory artifacts/OriginalEngines -CompressionCodec zstd -CompressionQuality 22
```

Outputs are `artifacts/MDV-<edition>-win-x64/MDV-v0.3.2-<edition>-win-x64.exe` and SHA-256 files. Output directories are recreated: do not keep personal settings or actively used EXEs there. Distribute dual and upstream; distribute custom only when it is strictly smaller than both. Sizes and the selection are recorded in `artifacts/edition-sizes-win-x64.json`. The script does not upload files.

Development builds default to Zstandard level 3. Explicitly select `-CompressionQuality 22` for releases. Every compressed payload file is verified against its original SHA-256. .NET single-file publishing is also used.

| Option | Purpose |
| --- | --- |
| `-Edition dual` / `upstream` / `custom` | Build one edition; default: dual. Custom does not require Ruby assets |
| `-FixedRuntimeDirectory C:\SDK\WebView2Fixed-x64` | Reuse a downloaded WebView2 runtime |
| `-CompressionQuality 3` | Faster development compression |
| `-SkipTests` | Skip pre-build tests during development only |

Custom can be built with `-Runtime win-arm64` and a matching Fixed Runtime, but ARM64 is outside the distribution and device-validation scope.

## Repository layout

| Directory | Contents |
| --- | --- |
| `src` | Windows application and shared code |
| `renderer` | Markdown conversion, presentation, and browser tests |
| `engines/original` | Public implementation Ruby worker and pinned dependencies |
| `scripts`, `tools` | Build, asset preparation, and verification tools |
| `tests` | Shared-code, public implementation, and compatibility regression tests and expectations |
| `samples` | Documents opened from the application help menu |
| `third_party` | External assets and licenses |
| `docs` | Current usage, limitations, and build instructions |

JavaScript dependencies are pinned in `package-lock.json`, Ruby dependencies in `engines/original/Gemfile.lock`, and WebView2 in `scripts/webview2-runtime.json`. Test-data sources and licenses are recorded in `tests/compatibility/sources.lock.json` and accompanying license files. Keep generated files, downloaded articles, and verification reports under `artifacts/`, outside Git.

## Development launch

WebView2 Evergreen Runtime is required.

```powershell
npm ci
npm run build -- custom
dotnet run --project src/Mdv.App -p:MdvEdition=custom
```

For dual/upstream, copy the prepared `OriginalEngines` to `src/Mdv.App/OriginalEngines` and select the same edition for both renderer and application builds.

## Release verification

```powershell
npm test
npm run compat:check
'dual', 'custom', 'upstream' | ForEach-Object {
    dotnet run --project tests/Mdv.Core.Tests -c Release "-p:MdvEdition=$_"
}
npm run upstream:setup
$env:MDV_RUBY = (Get-Command ruby).Source
npm run upstream:test
npm run build
npx playwright install chromium
npm run test:browser
# After build.ps1 -Edition all
npm run test:editions
'dual', 'custom', 'upstream' | ForEach-Object {
    .\scripts\smoke-windows.ps1 -BuildDirectory "artifacts/MDV-$_-win-x64" -Report "artifacts/verification/$_/native-smoke.json"
}
```

Always set `MDV_RUBY` for release verification; otherwise browser tests requiring the public implementations are skipped. Windows verification copies each distribution EXE to a separate directory and checks UI operations, PDF output, saved offline images/cards, settings, and restart after relocation and renaming.

To check WSL document-change detection from Windows, run `scripts/smoke-wsl.ps1 -WslDirectory '\\wsl.localhost\Ubuntu\home\yourname\tmp' -BuildDirectory artifacts/MDV-dual-win-x64`. The WSL directory must exist and be writable, with Python 3 available in WSL.

## Live-site comparisons

Run `npm run build` first. `node scripts/upstream/sample-sources.mjs --mode github --out artifacts/comparison/github-sources.json` saves candidates and a seed. Use `--mode qiita` for Qiita. Sampling is from these candidates, not uniformly from the entire service.

```powershell
npm run upstream:service -- --refresh --visual --mode github --sources artifacts/comparison/github-sources.json --seed SEED --consecutive 5 --offset 0 --out artifacts/comparison/github
```

The comparison stops at the first difference, capture/execution error, or five consecutive matching documents. After a repair, retest the affected document and restart the streak at zero with unseen documents. Never count skipped differences or capture failures as passes.

`--visual` compares each engine with the service at an 800px article width in the light theme: article/block images, painted CSS, DOM, and pointer targets. Actual mouse movements exercise heading bodies/anchors, authored links, images, and summaries. Any pixel with an RGBA-channel difference greater than 16 fails.

Both sides use the same grayscale text rendering. Simple heading SVGs are painted as standalone SVG images using their original paths and colors to reduce context-dependent edge differences. Original DOM geometry, raw captures, and raw differences are retained. Site chrome, copy controls, hover inside cards/math/diagrams, closed details, keyboard focus, dark mode, and responsive layouts are outside this live-site comparison; distinguish it from separate application tests.

Use `--qiita-image-snapshots --qiita-card-snapshots` to compare saved Qiita images/cards. Production .NET code downloads, saves, and verifies the assets; titles and thumbnails remain in the image comparison. Saved captures are reused unless `--refresh` is specified.

GitHub issue/PR enrichment depends on online service functionality. `--exclude-service-issue-links` restores only service-generated references to their authored text and records the exclusions. Explicit author links remain in scope.

These comparisons do not establish equivalence for every article, theme, or viewport. `compat:check` detects changes from saved results; it is not proof of complete service compatibility.
