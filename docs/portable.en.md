# Usage and settings

[日本語](portable.md) | [English README](../README.en.md)

## Editions and engines

Check **Help → About MDV** or the window title for the current edition. In the dual edition, **View → Use upstream engine** switches engines. The custom and upstream editions have a fixed engine. Every edition supports GitHub and Qiita syntax modes.

## Open and read documents

Use **Open**, **Recent files**, or drag and drop. You can open multiple files and switch between them using tabs. Opening a file already in a tab selects that tab.

- **Table of contents**: select a heading to jump to it.
- **Show source**: view the original Markdown as read-only text.
- **Find in document**: search text and code. Text in diagrams, math, or across formatting boundaries may not be searchable.
- **Reload**: changes saved in external editors appear automatically. For shared paths such as WSL (`\\wsl.localhost\…`, `\\wsl$\…`), MDV checks the active document about every two seconds. You can also reload manually.
- **Print and export**: use **File → Print** or **File → Save as PDF**. PDF (Portable Document Format) preserves document layout for sharing.
- **Appearance**: change the outline, source pane, dark theme, and zoom under **View**.

Each tab keeps its syntax mode, zoom, search query, reading position, and collapsed sections. Tabs and navigation history are not restored after exiting. Close a tab using its × button or a middle click. Closing the last tab leaves an empty tab.

Markdown links open in the same tab. Ctrl+click or middle-click opens a link in another tab. **Back** and **Forward** restore documents and reading positions. Following a new document after going back replaces the forward history.

## Interface language

The default **Automatic (system language)** setting uses Japanese for a Japanese Windows display language, and English for all other languages. Choose **Language → 日本語** or **Language → English** for an explicit preference. The entire interface switches immediately; document text is not translated. **Help → Open sample** opens the sample in the selected interface language.

The choice is saved immediately beside the EXE and survives restarts. Select **Automatic (system language)** to follow Windows again. In the INI file, `[Viewer]` contains `Language=auto`, `Language=ja`, or `Language=en`. Missing or invalid values fall back to automatic selection. Close MDV before editing the INI manually.

## Keyboard shortcuts

| Action | Keys |
| --- | --- |
| Open | Ctrl+O |
| New tab / Close tab | Ctrl+T / Ctrl+W |
| Next tab / Previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Back / Forward | Alt+← / Alt+→ |
| GitHub / Qiita | Ctrl+1 / Ctrl+2 |
| Find in document | Ctrl+F |
| Next result / Previous result | F3 / Shift+F3 |
| Close search | Esc |
| Show source | Ctrl+U |
| Reload | F5 |
| Print | Ctrl+P |
| Zoom in / Zoom out / Reset zoom | Ctrl++ / Ctrl+- / Ctrl+0 |

## Images and links

Remote images are disabled by default. Enabling **View → Load remote images** connects to the image hosts. Document text is never sent to an external conversion service. Web and email links open in the default application when clicked.

In either mode, choose **View → GitHub images / Qiita images → Download and save images…** to save authored HTTP/HTTPS images for offline viewing. No article or document URL is required by default. Existing local images keep their files; move those files together with the document.

The save dialog has an optional service setting, off by default:

| Mode | Optional setting | When a document URL is required |
| --- | --- | --- |
| GitHub | Also resolve repository images from GitHub | Resolve relative paths that are not available locally against a public GitHub document |
| Qiita | Use Qiita's published CDN images | Match authored sources to signed CDN URLs in a public article |

For GitHub resolution, enter the public document's blob or raw URL. Relative paths resolve from the document, leading `/` paths from the repository root, and `../images/a.png` is supported within the repository. These additional downloads use GitHub raw images. Private repositories requiring authentication are unsupported. For branch names containing `/`, use a commit SHA. Absolute remote-image URLs can be saved without this setting.

The Qiita setting requires a public article URL. Matching images use the standard-resolution images published in the article; unmatched images use their URLs from the Markdown. Without this setting, images are saved from the Markdown URLs, so their resolution or format may differ from the article images. Display size also depends on content width, zoom and authored dimensions, so it is not guaranteed to match Qiita exactly.

Results show saved images, existing local images and unsaved images, listing every unsaved source and reason. Partial success updates the snapshot with the images downloaded this time, replacing the previous snapshot. If no image can be saved, or the overall operation fails or is cancelled, previous snapshots and display settings are preserved. Successful saving enables **Use saved images**.

Saved images work offline in both engines. In GitHub mode, **Use saved images** and **Load remote images** are mutually exclusive. In Qiita mode, enabling **Use saved images**, **Load remote images** or **Display directly from CDN** turns off the other two options. All options can be off. Local images remain visible. With saved images selected, remote images without a matching snapshot are not displayed. Enable **Load remote images** to display authored sources online. Image loading failures do not automatically switch to another source.

Qiita's **Display directly from CDN…** displays matching article images online without creating a snapshot. This feature requires an article URL. Selection changes only after article lookup succeeds; failure or cancellation preserves the previous selection. Unmatched remote images are not displayed. Uncheck to disable.

Image source selections are retained per document and syntax mode until exit, including across tab changes, back/forward navigation and reload.

Snapshots for `example.md` are stored beside it as `example.md.mdv-github-images.zip` or `example.md.mdv-qiita-images.zip`. Markdown is unchanged. Move the ZIP with the document and rename its document-name portion when renaming the Markdown. Limits are 128 images and 256 MiB per document, with 32 MiB per image.

Snapshots preserve the images at download time. Opening, reloading and switching modes do not refresh them. Run **Download and save images…** again to update, or **Delete saved images for this document** to remove the snapshot. GitHub and Qiita snapshots and saved-image settings are independent.

Local images and linked Markdown must be in the open document's folder or its subfolders. Parent-folder references and files or folders accessed through junctions or symbolic links are unsupported.

For example, when reading `notes/readme.md`, `images/photo.png` can refer to `notes/images/photo.png`. A link such as `../photo.png` outside `notes` cannot be opened. Absolute drive paths and direct shared-folder links are also unsupported.

## Save Qiita link cards

The default is an offline URL card. In Qiita mode, choose **View → Qiita link cards → Download and save online**, then **Download and save** to fetch service titles and thumbnails. Downloading card details connects to Qiita and the thumbnail hosts. It processes standalone URL cards, not ordinary inline links.

Both engines can then display saved cards offline. Disable **Use saved link cards** to restore URL cards. Opening, reloading and switching modes never refresh the snapshot. Run the download command again to update it; failures and cancellation preserve the previous snapshot. **Delete saved cards for this document** removes it.

Cards are stored beside the document in `example.md.mdv-qiita-cards.zip`. Move or rename the matching snapshot with the document. Limits are 128 cards, 256 MiB of thumbnails per document and 32 MiB per image. Saved contents reflect download time. This setting is independent of saved article images.

## Save and move settings

Settings are stored in an `.ini` beside the executable with the same base name. The examples below use `MDV.exe` and `MDV.ini`. Settings include language, engine, syntax mode, theme, zoom, outline, source pane, and recent files. Normally, change them using the menus.

- **Move**: close MDV and move `MDV.exe` and `MDV.ini` together.
- **Rename**: if you rename the executable to `Reader.exe`, rename its settings to `Reader.ini`.
- **Reset**: close MDV and delete the settings file.

Recent file paths are not updated automatically when documents move. Select moved documents using **Open**. If settings cannot be saved, check that the executable folder is writable and the INI is not read-only.

MDV does not register or change file associations. Use Windows settings if you want to associate Markdown files with MDV.

## Updates and temporary files

To update, close all MDV instances, replace the EXE, and keep the INI. If the version or edition in the executable's filename changes, rename the INI to match. Renaming every release to `MDV.exe` lets you keep using `MDV.ini`.

The first launch extracts required files into the Windows temporary folder, so it may take longer than later launches.

In v0.3.3, the extracted startup files total approximately 0.74 GB for custom and 0.81 GB for dual/upstream (1 GB = one billion bytes). Storage for the EXE itself is separate.

Running MDV also uses working space. **Allow around 1 GB of free space per edition on the drive containing the temporary folder.** This is not a fixed minimum requirement; working data may require more space. Using multiple editions or updating MDV can leave previously extracted files behind.

If display fails or you want to clean up temporary files, close all MDV instances and enter `%TEMP%` in Explorer's address bar. You can remove:

| Location | Contents |
| --- | --- |
| `MDV` folder | Extracted assets and working data |
| Folder under `.net` matching the MDV executable name | Extracted runtime files. Leave other applications' folders intact |

Required files are recreated at the next launch. This does not delete settings or original Markdown documents.
