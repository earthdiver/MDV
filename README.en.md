# MDV — GitHub / Qiita Markdown Viewer

[日本語](README.md) | English

MDV is a Windows app for reading Markdown documents from GitHub repositories and Qiita article content. It supports tables, syntax highlighting, math, Mermaid, tabs, an outline, search, printing, and PDF export. It does not edit documents.

## Features

- GitHub/Qiita syntax and two rendering engines.
- Tabs, outline, text search, source view, and automatic reload.
- Tables, highlighted code, math, Mermaid, dark theme, printing, and PDF export.
- Save authored remote images for offline viewing, with optional GitHub path resolution, Qiita CDN images and link-card snapshots.
- Japanese/English interface and portable settings beside the EXE.

## Choose an edition

| Distribution | Contents |
| --- | --- |
| `dual` — Dual engine edition | Switch between the custom and upstream engines. Defaults to upstream. Recommended if you are unsure |
| `upstream` — Upstream engine edition | Uses the conversion implementations published by GitHub and Qiita. No engine switch |
| `custom` — Custom engine edition | MDV's custom rendering engine. No engine switch |

## Get started

1. Put your chosen EXE in a writable folder. You can rename it to `MDV.exe`.
2. Launch it and use **Open** or drag and drop to open documents.
3. Select **GitHub** or **Qiita** at the top right to match the document's syntax.

The distribution targets **Windows 10/11 x64**. Runtimes are bundled, so no additional installation is required. Core features work offline. Required files are extracted on first launch. **Allow around 1 GB of free space per edition** on the drive containing the temporary folder. This is a planning guideline, not a fixed minimum requirement. See [Usage and settings](docs/portable.en.md#updates-and-temporary-files) for measured sizes.

The interface automatically uses Japanese when the Windows display language is Japanese, and English otherwise. Choose **Language → Automatic (system language) / 日本語 / English** to override this. Changes apply immediately and are retained after restarting.

Settings are stored beside the EXE in an `.ini` file with the same base name. For example, `MDV-v0.3.3-dual-win-x64.exe` uses `MDV-v0.3.3-dual-win-x64.ini`. Copy both files to carry your settings with you.

**MDV is not fully compatible with GitHub or Qiita.** Development aims to reproduce the appearance and behavior of the live websites, but some differences in syntax support and rendering remain. MDV is not an official GitHub or Qiita app.

## More information

- [Usage and settings](docs/portable.en.md): controls, images, moving settings, and updates
- [Compatibility and limitations](docs/compatibility.en.md): syntax and presentation differences between engines
- [Building and testing](docs/development.en.md): building from source

The application source is under the [MIT license](LICENSE). View bundled software licenses under **Help → Bundled licenses**.
