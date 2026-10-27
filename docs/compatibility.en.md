# Compatibility and limitations

[日本語](compatibility.md) | [English README](../README.en.md)

MDV primarily targets Markdown documents in GitHub repositories and Qiita article content. GitHub comments can handle line breaks and links differently from repository documents. Development aims to reproduce the appearance and behavior of the live websites, but some differences in syntax support and rendering remain.

## Rendering engines

The conversion engine is separate from the GitHub/Qiita syntax mode.

| Engine | Description |
| --- | --- |
| Custom engine | MDV's conversion pipeline, based on GitHub Flavored Markdown (GFM), with support for Qiita-specific syntax |
| Upstream engine | Uses conversion implementations published by GitHub and Qiita; available in dual and upstream editions |

In the dual edition, switch using **View → Use upstream engine**. Upstream is the default. The engine selection applies to all tabs and persists after restarting. Custom and upstream editions have fixed engines and hide the switch. Settings copied from another edition are normalized to an available engine.

The status-bar time (ms) shows how long a display switch took to complete.

An upstream conversion failure displays an error. In the dual edition, you can uncheck the option to use the custom engine.

## Custom engine

### Supported syntax

This table applies only to the custom engine. GitHub and Qiita refer to the syntax mode selected at the top right.

| Syntax | GitHub | Qiita |
| --- | --- | --- |
| Headings, lists, quotes, tables, task lists, footnotes | Supported | Supported |
| `~~strikethrough~~` | Strikethrough | Strikethrough |
| `~strikethrough~` | Strikethrough | Plain text |
| Ordinary line break within a paragraph | Joined into the paragraph | Visible line break |
| Alerts such as `> [!NOTE]` | Alert box | Ordinary quote |
| `:::note info`, `warn`, `alert` | Plain text | Note box, including notes in lists; notes inside quotes are excluded |
| Code fence `language:filename` | Filename not displayed | Filename displayed |
| Code fence `diff_language` | Ordinary code | Diff and syntax highlighting |
| Standalone web link | Link | Link card frame and address |
| `:emoji:`, `@username` | Emoji and GitHub profile link | Emoji and Qiita profile link |
| HTML disclosure elements and tables | Allowed elements supported | Allowed elements supported |

Use **Help → Open sample** for examples. Leading YAML front matter enclosed by `---` is displayed as a table. The upstream engine also supports this in GitHub mode. Syntax highlighting is skipped for code blocks longer than 100,000 characters.

## Upstream engine

Conversion uses the published GitHub/Qiita implementations. The custom-engine table above does not apply, and detailed syntax interpretation may differ.

| Mode | Main support |
| --- | --- |
| GitHub | Published conversion implementation with tables, task lists, footnotes, and alerts enabled by the app |
| Qiita | Published implementation's notes, code filenames, footnotes, and related features |

GitHub code highlighting is skipped above 100,000 characters. Qiita highlighting follows the upstream implementation.

Published code and the versions or settings used on the live sites may differ. The shared limitations below also apply.

## Shared behavior

### Appearance and interaction

Both engines receive styling for the selected service. Heading link icons appear on hover or keyboard focus. Footnote references use the `[1]` format.

Code highlighting may differ from the live websites.

Qiita code highlighting may differ between editions. Language identifiers recognize both `PowerShell` and `powershell`.

### Math and diagrams

In Qiita mode, equations in headings or links and TeX environments without math delimiters are not rendered as math.

In GitHub mode, `\$x$` also becomes math. Links, ordinary code, expressions crossing emphasis or HTML elements, and inline expressions containing line breaks stay literal. To preserve math symbols as written, use backticks inside the dollar delimiters or a `math` code fence.

Use `$...$`, `$$...$$`, or a `math` code fence. For example:

````markdown
```math
E = mc^2
```
````

Use a `mermaid` code fence for diagrams. Mindmaps are supported. Text placement and line shapes may differ from the live websites.

PlantUML, GeoJSON/TopoJSON maps, and STL 3D models are not rendered.

### Differences from the sites

| Area | Limitation |
| --- | --- |
| Appearance | Fonts, spacing, colors, and emoji shapes may differ |
| Link cards and embeds | Qiita cards show URLs by default; titles and thumbnails can be explicitly downloaded and saved for offline use. Videos, posts, and slide embeds are not reproduced |
| GitHub-specific references | Issue/PR references such as `#123`, commit links, and repository-specific destinations are not resolved |
| Document HTML | Scripts, forms, and embedded external pages are removed; only allowed elements and attributes are displayed. GitHub mode removes `<font>` colors and authored text colors in `style` attributes. Qiita mode permits some styling, including `<font color="…">` |
| Saved external images | Images from public GitHub repositories and Qiita can be explicitly downloaded and saved for offline display. GitHub relative paths are resolved against the supplied document URL. Fetching private repositories requiring authentication is not supported |
| Local images and links | Restricted to the document folder. See [Usage and settings](portable.en.md#images-and-links) |

### Encodings and limits

Supported encodings are UTF-8, UTF-16/32 with a byte order mark (BOM), and Shift_JIS (Windows code page 932). Without a BOM, MDV tries UTF-8 first, then Shift_JIS only if UTF-8 decoding fails.

1 MiB is 1,048,576 bytes.

| Resource | Limit |
| --- | --- |
| Document | 16 MiB and approximately 4.19 million characters; emoji and similar characters may count as multiple units |
| Image | 32 MiB per file |
| GitHub/Qiita image snapshots | 128 images and 256 MiB total per document |
| Mermaid | 40 diagrams per document; 50,000 characters and 500 edges per diagram |

Complex diagrams or math can be slow even within these limits.

## Verification scope

Tests cover syntax conversion, major display elements, and UI behavior. Comparisons use pinned upstream implementations and observations of public pages. They do not guarantee matching entire live sites or future changes. See [Building and testing](development.en.md).
