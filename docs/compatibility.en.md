# Compatibility and limitations

[日本語](compatibility.md) | [English README](../README.en.md)

MDV primarily targets Markdown documents in GitHub repositories and Qiita article content. GitHub comments can handle line breaks and links differently from repository documents. Identical output to the live websites is not guaranteed.

## Rendering engines

The conversion engine is separate from the GitHub/Qiita syntax mode.

| Engine | Description |
| --- | --- |
| Custom engine | MDV's conversion pipeline, based on GitHub Flavored Markdown (GFM), with support for Qiita-specific syntax |
| Upstream engine | Uses conversion implementations published by GitHub and Qiita; available in dual and upstream editions |

In the dual edition, switch using **View → Use upstream engine**. Upstream is the default. The engine selection applies to all tabs and persists after restarting. Custom and upstream editions have fixed engines and hide the switch. Settings copied from another edition are normalized to an available engine.

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

GitHub documents use official Primer CSS, color definitions, and Octicons. Copy controls use GitHub's JavaScript component connected to the Windows clipboard. Code highlighting uses bundled Tree-sitter grammars for JavaScript/TypeScript and Shiki TextMate grammars for other languages, mapped to Primer palette roles. Grammar differences from the live service can still affect colors; unsupported languages retain the previous highlighting.

Qiita documents use MDV's own CSS and Font Awesome icons. Body text, headings, tables, code, and notes are adjusted for Qiita articles, but official article CSS is not bundled. In editions containing upstream assets, the custom engine also uses upstream Qiita highlighting for blocks whose language and code text match. Missing assets or unmatched blocks use the custom highlighting, so differences can remain. Language identifiers recognize both `PowerShell` and `powershell`.

### Math and diagrams

Both engines support math and Mermaid, using different math libraries.

| Engine | Math | Diagrams |
| --- | --- | --- |
| Custom | GitHub: KaTeX / Qiita: MathJax | Mermaid |
| Upstream | MathJax | Mermaid |

In GitHub mode, supported math commands and numbering can differ between engines. In Qiita mode both engines typeset the Markdown DOM with the same MathJax settings, excluding headings, links, and bare TeX environments. Use `$...$`, `$$...$$`, or a `math` code fence. For example:

````markdown
```math
E = mc^2
```
````

Use a `mermaid` code fence for diagrams. Versions and settings differ from the sites, so diagram types, text placement, and line shapes may differ. PlantUML, GeoJSON/TopoJSON maps, and STL 3D models are not rendered.

### Differences from the sites

| Area | Limitation |
| --- | --- |
| Appearance | Fonts, spacing, colors, and emoji shapes may differ |
| Link cards and embeds | Qiita cards show URLs by default; titles and thumbnails can be explicitly downloaded and saved for offline use. Videos, posts, and slide embeds are not reproduced |
| GitHub-specific references | Issue/PR references such as `#123`, commit links, and repository-specific destinations are not resolved |
| Document HTML | Scripts, custom styling, forms, embedded external pages, and similar content are removed |
| Local images and links | Restricted to the document folder. See [Usage and settings](portable.en.md#images-and-links) |

### Encodings and limits

Supported encodings are UTF-8, UTF-16/32 with a byte order mark (BOM), and Shift_JIS (Windows code page 932). Without a BOM, MDV tries UTF-8 first, then Shift_JIS only if UTF-8 decoding fails.

1 MiB is 1,048,576 bytes.

| Resource | Limit |
| --- | --- |
| Document | 16 MiB and approximately 4.19 million characters; emoji and similar characters may count as multiple units |
| Image | 32 MiB per file |
| Mermaid | 40 diagrams per document; 50,000 characters and 500 edges per diagram |

Complex diagrams or math can be slow even within these limits.

## Verification scope

Tests cover syntax conversion, major display elements, and UI behavior. Comparisons use pinned upstream implementations and observations of public pages. They do not guarantee matching entire live sites or future changes. See [Building and testing](development.en.md).
