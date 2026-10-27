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

Outputs are `artifacts/MDV-<edition>-win-x64/MDV-v0.3.3-<edition>-win-x64.exe` and SHA-256 files. Output directories are recreated: do not keep personal settings or actively used EXEs there. Distribute dual and upstream; distribute custom only when it is strictly smaller than both. Sizes and the selection are recorded in `artifacts/edition-sizes-win-x64.json`. The script does not upload files.

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

If `artifacts/OriginalEngines` was already prepared above, skip the `prepare-original-engines.ps1` command below.

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
.\scripts\prepare-original-engines.ps1 -RubyDirectory C:\Ruby34-x64
.\scripts\build.ps1 -Edition all -OriginalEngineDirectory artifacts/OriginalEngines -CompressionCodec zstd -CompressionQuality 22
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

### Math comparison tests

`npm run compat:math` compares five formulas across GitHub/Qiita and light/dark/print (30 cases) with independent MathJax output under matched host presentation conditions. DOM and image dimensions must match; image tolerances are 16 per RGBA channel and a maximum changed-pixel ratio of 1%. Mismatches cause a failing exit code. Results are saved to `artifacts/compatibility/browser-math/index.html`. This does not verify equivalence with the live services.

To directly compare the two GitHub engines, set `MDV_RUBY` and run `npm run test:browser -- renderer/test/browser/github-math-engines.spec.mjs`. The 51 cases, including escapes, character references, same-line display math and code-delimited math, compare math DOM (excluding runtime menu identities) and screenshots, requiring identical image dimensions and zero changed pixels without adjustment or tolerance. Results are saved under `artifacts/github-math-engines/`. Tests skip when `MDV_RUBY` is unset.

`renderer/test/browser/github-math-api.spec.mjs` checks both engines against 29 cases captured from GitHub's official Markdown API in GFM mode (`tests/compatibility/github-math-api.json`). It verifies math counts, inline/display classification and HTML element boundaries without contacting the API during tests. Only upstream cases skip when `MDV_RUBY` is unset. This verifies math recognition, not pixel equivalence with the entire live site.

For Qiita, set `MDV_RUBY` and run `npm run test:browser -- renderer/test/browser/qiita-math-engines.spec.mjs`. It compares 43 inputs across light/dark/print (129 cases), including escapes, emphasis, HTML, tables, notes and explicit equation tags. Math DOM and image dimensions must match exactly. Screenshots allow only small CHTML font rasterization color differences (up to 16 per RGBA channel), with zero pixels exceeding that tolerance. Failed captures are saved under `artifacts/qiita-math-engines/`. Four inputs also compare against MathML captured from the official Qiita Markdown cheat sheet (`tests/compatibility/qiita-live-math.json`). Their Markdown wraps TeX observed on the live site in math syntax; these cases do not verify the article's original Markdown parsing or full-site pixel equivalence. Tests skip when `MDV_RUBY` is unset.

## Measuring repeat startup time

Place instrumented builds at `<BuildRoot>/dual/MDV.exe`, `custom/MDV.exe`, and `upstream/MDV.exe`, then run on Windows:

```powershell
.\scripts\measure-startup.ps1 -BuildRoot artifacts/startup-profile -OutputDirectory artifacts/startup-profile/results -Runs 3
```

The script copies executables to local temporary storage. Each edition, engine, syntax mode, and document case (bundled sample or short plain document) gets one warmup followed by the requested number of runs. WebView2 profiles are created and deleted on every run, as in normal use; extracted assets are reused. Results are saved to `runs.json` and environment details to `environment.json`. Exclude rows with `warmup: true` from summaries.

Total time runs from process creation to the first render-completion notification. Sequential stages cover window initialization, asset preparation, WebView2 environment and controller, document setup, renderer bootstrap, Ruby startup/conversion, and browser rendering/communication. `processBeforeWindow` is the residual after subtracting those stages, including .NET startup; it is an estimate. Later image loading and shutdown are excluded.
