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

GitHub mode removes authored HTML text colors (`font color` and `style="color:…"`) as GitHub does. Qiita retains `font color`. Both engines bundle Mermaid 12.1.0 for GitHub and 11.12.1 for Qiita, matching the service scripts observed on October 14, 2026. Mindmap SVG rendering was also verified on GitHub. The public Markdown converters do not include all service sanitization or browser diagram rendering; MDV applies these adjustments at display time.

Remote images are disabled by default. Enabling **View → Load remote images** connects to the image hosts. Document text is never sent to an external conversion service. Web and email links open in the default application when clicked.

Normally, images use their authored sources. To use Qiita's resized/converted service images, select Qiita mode, then **View → Qiita service images → Download and save from article**, and enter the document's public article URL. Only images whose source URLs match the open document are saved, and saved-image use is enabled. This operation contacts the Qiita article page and image CDN. You can cancel it; failure or cancellation preserves the previous snapshot.

Saved images work offline in both engines, including when remote images are disabled. Uncheck **Use saved service images** to restore authored images. This application-wide setting only affects documents with saved snapshots. Unsaved remote images still follow the remote-image setting. Opening, reloading and switching modes never download a new snapshot. Use the download command again to update it, or **Delete saved images for this document** to remove it.

Images for `example.md` are stored beside it in `example.md.mdv-qiita-images.zip`. Move both files together. If you rename the document, rename the corresponding part of the snapshot filename too. The folder must be writable. Limits are 128 images and 256 MiB per document, with 32 MiB per image. Snapshots preserve the images at download time and do not automatically follow service changes.

In GitHub mode, use **View → GitHub images → Download and save from GitHub** and enter the public document's GitHub blob URL or raw URL. Relative paths resolve from that document; leading `/` paths resolve from the repository root. Parent paths such as `../images/a.png` work within the repository. Downloads are restricted to GitHub raw images; private repositories requiring authentication are unsupported. For branch names containing `/`, use a commit SHA in the URL.

GitHub snapshots are saved beside the Markdown as `example.md.mdv-github-images.zip`. **Use saved images** enables offline display in both engines without changing the Markdown. Moving, renaming, refreshing, deleting, size limits and failure preservation work as for Qiita images. The GitHub and Qiita settings are independent.

Local images and linked Markdown must be in the open document's folder or its subfolders. Parent-folder references and files or folders accessed through junctions or symbolic links are unsupported.

For example, when reading `notes/readme.md`, `images/photo.png` can refer to `notes/images/photo.png`. A link such as `../photo.png` outside `notes` cannot be opened. Absolute drive paths and direct shared-folder links are also unsupported.

## Save Qiita link cards

The default is an offline URL card. In Qiita mode, choose **View → Qiita link cards → Download and save online**, then **Download and save** to fetch service titles and thumbnails. Only this command contacts Qiita's public OGP endpoint and thumbnail hosts. It processes standalone URL cards, not ordinary inline links.

Both engines can then display saved cards offline. Disable **Use saved link cards** to restore URL cards. Opening, reloading and switching modes never refresh the snapshot. Run the download command again to update it; failures and cancellation preserve the previous snapshot. **Delete saved cards for this document** removes it.

Cards are stored beside the document in `example.md.mdv-qiita-cards.zip`. Move or rename the matching snapshot with the document. Limits are 128 cards, 256 MiB of thumbnails per document and 32 MiB per image. Saved contents reflect download time. This setting is independent of saved article images.

## Save and move settings

Settings are stored in an `.ini` beside the executable with the same base name. The examples below use `MDV.exe` and `MDV.ini`. Settings include language, engine, syntax mode, theme, zoom, outline, source pane, remote images, and recent files. Normally, change them using the menus.

- **Move**: close MDV and move `MDV.exe` and `MDV.ini` together.
- **Rename**: if you rename the executable to `Reader.exe`, rename its settings to `Reader.ini`.
- **Reset**: close MDV and delete the settings file.

Recent file paths are not updated automatically when documents move. Select moved documents using **Open**. If settings cannot be saved, check that the executable folder is writable and the INI is not read-only.

MDV does not use the Windows registry for settings or file association registration. It does not erase execution history recorded by Windows itself.

## Updates and temporary files

To update, close MDV, replace the EXE, and keep the INI. If the version or edition in the executable's filename changes, rename the INI to match. Renaming every release to `MDV.exe` lets you keep using `MDV.ini`. The bundled WebView2 runtime is updated by replacing the MDV distribution.

Startup extracts required files into the Windows temporary folder. Allow **at least 1 GB of free space**; the first launch takes longer. Using multiple editions leaves separate extracted assets.

If display fails or you want to clean up temporary files, close all MDV instances and enter `%TEMP%` in Explorer's address bar. You can remove:

| Location | Contents |
| --- | --- |
| `MDV` folder | Extracted assets and working data |
| Folder under `.net` matching the MDV executable name | Extracted runtime files. Leave other applications' folders intact |

Required files are recreated at the next launch. This does not delete settings or original Markdown documents.
