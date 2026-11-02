# Brief: album archive

_Created: 2026-11-01_

## Goal

A person can save a whole album, with its layout and original photos, into one ZIP file. The person can then open that file on another device as a complete album that can print.

## Context

Today no single file holds a whole album:

- `Зберегти у файл` writes only the layout, as `.album.json` (`src/storage/layoutFile.ts:27`). The file has no photos.
- `Відкрити файл` accepts only JSON (`src/storage/layoutFile.ts:77`, `:91`). After it opens a layout on another device, the photos show as missing until the person relinks them (`src/ui/RelinkDialog.tsx`).
- The app does not store originals (`src/photos/import.ts:2`). IndexedDB holds only screen copies (`src/storage/db.ts:8`).
- A phone has no folder handle, so its originals are in memory until the page reloads (`src/photos/originals.ts:12`). Thus a phone album that a person made in an earlier session has no originals to save. The person must choose them again.
- The print export makes a ZIP, but it keeps all chunks in memory (`src/export/export.ts:72`). This feature must carry about 1.5 GB on a phone, so that behaviour is a risk here.
- A folder in `getOriginal` matches a photo by its name and size (`src/photos/originals.ts:34-36`). One folder cannot hold two files with the same name.

The capability record has no row for this feature. C-26 (layout file), C-27 (relink), C-34 (export to a folder or a ZIP) and C-35 (the export asks for originals) stay true. This feature changes none of them.

## Requirements

| Id | Requirement | How it will be observed |
|---|---|---|
| R-1 | The editor has an action that saves the album as an archive. On a phone it is on the screen without a scroll | At 320 px and 390 px the action is inside the screen width, and a tap on it starts the save |
| R-2 | The save gives one standard ZIP file named `<album name>.album.zip` | A ZIP tool lists the file. The browser gives one download or one saved file |
| R-3 | The archive holds the layout: the spreads, the cells, the crops and the album settings | After an open, the spreads, cells, crops and settings equal those of the saved album |
| R-4 | The archive holds the original file of each photo that a cell uses, on any spread, including the cover. It holds no other photo. Each file is byte-identical to its original | The sha256 of each photo file in the ZIP equals the sha256 of its source file. The file count equals the used count in `використано N / M`, and a photo that no cell uses is not in the ZIP |
| R-5 | If this session cannot read the original of a used photo, the app asks the person to choose the files, and it says how many. It does not ask for a photo that no cell uses. The save continues after a new click | After a reload, the save shows the request with the used count, and after the files are chosen, a new click completes the save |
| R-6 | If the original of a used photo is still not found, the app writes no archive and names each missing photo | With one file not chosen, no download starts and the name of that photo shows |
| R-7 | `Відкрити файл` opens an archive, on the album list and in the editor. It still opens a `.album.json` as before | Each screen opens both file kinds through the same button |
| R-8 | After an archive opens, every photo shows in the photo column and in its cells, and no photo needs a relink | No missing-photo banner and no relink request shows, on a browser that never had this album |
| R-9 | An archive opens on a computer and on a phone | The save on a phone and the open on a computer pass, and the save on a computer and the open on a phone pass |
| R-10 | In a browser with a folder picker, the open asks for a folder, writes the originals into it, and remembers it for this album | After the open and a page reload, the print export finishes and does not ask for originals |
| R-11 | In a browser without a folder picker, the print export uses the originals from the archive until the page reloads. After a reload it asks for them, as C-35 says | The print export asks for no file right after the open, and asks for files after a reload |
| R-12 | The save and the open show progress, and they show a clear result at the end | A counter advances during each operation, and a done message or an error message shows |
| R-13 | On a phone, an album with 300 used photos and about 1.5 GB of originals saves into one archive, and that archive opens | A person runs this on a real phone, because emulation does not have the memory limit of a phone |
| R-14 | An album that opens from an archive lists only the used photos in its photo column. The album on the device that saved the archive does not change, apart from the time of the last file save (R-15) | After an open, the counter shows `використано N / N`. On the saving device, the counter and the photo column stay as they were before the save |
| R-15 | A save of an archive resets the reminder of C-40, as a save of a layout file does. A cancel or a failed save does not reset it. The person chose this | After a save, `lastFileSaveAt` of the album is the save time. After a cancel or a failed write, it stays as it was |
| R-16 | A chosen file with another name or another size than the photo goes into an archive only after the person agrees. The dialog names each such photo. This rule also holds for a file that the print export or the relink dialog took earlier in the same session. The person chose this, because an archive claims to hold originals | With a file of another size, the dialog names the photo and shows two buttons. With no click on the accept button, the save does not continue. The result is the same when the print export took that file first |

## Out of Scope

- A transfer between devices. The person moves the file with a cable, AirDrop, a cloud drive or another tool.
- A transfer of the photos that no cell uses. The person chose this, so that the archive holds no extra photos.
- A copy of the originals in the storage of the browser. The person chose to select the files again, because of the space they use and because iPhone can delete that data.
- An archive with some originals missing, or with screen copies in place of originals. The person chose no archive in that case.
- A merge of an archive into an album that exists. An open replaces the album, after the existing confirmation.
- Compression or a resize of the originals, and a password on the archive.
- A change to the files of the print export or to the `.album.json` format. The request for originals is shared with the print export, so its text can change there too.

## Edge Cases

| Id | Case | Expected behaviour |
|---|---|---|
| E-1 | Two photos in the album have the same file name and different contents | The archive holds both. After an open, each cell shows its own photo, and the print export uses the correct original, also after a reload |
| E-2 | The file is damaged, cut short, not an album archive, or from a newer format version | A clear message shows. No album changes |
| E-3 | An album with the same id exists in this browser | The existing confirmation shows (`src/ui/App.tsx:119`). A cancel changes nothing |
| E-4 | No cell uses a photo | The archive holds only the layout, and it opens with an empty photo column |
| E-5 | The person cancels the save dialog | Nothing is written, and no error shows |
| E-6 | The person cancels the folder picker during an open | The album opens. The originals stay available until the page reloads, as in R-11 |
| E-7 | The chosen folder holds a file with the same name and different contents | The app does not overwrite that file. The album still finds its own original after a reload |
| E-8 | The save or the open fails part of the way, for example because of no free space or no free memory | An error message shows. The album in the browser does not change. The app does not say "done" |
| E-9 | A photo in the archive cannot be decoded in this browser | The album opens, and the app names that photo. The original stays in the archive |
| E-10 | A cell uses a photo only on a half that does not print | The photo counts as used, so the archive holds it |
| E-11 | The stored folder of an album no longer exists | The save and the print export ask for the originals. No general error shows |
| E-12 | An archive holds a photo that decodes, but the app does not accept its name | The album opens, and the app names that photo, as in E-9. The message does not mention free space |
| E-13 | A person clicks a save button two times while the save picker is open | The picker opens one time, and no error shows |
| E-14 | The archive save dialog is open. A person presses the undo or redo key, or moves with the Tab key to a control behind the dialog | The album does not change, and the Tab key does not reach a control behind the dialog. The person chose this, so that the file holds the album on the screen |
| E-15 | A person clicks the open button two times while the file picker of the browser is open | The picker opens one time, and no error shows. The first picker still gives the file |

## Constraints

- The app is a static site with no server. All work happens in the browser, and no photo leaves the device.
- The app does not copy originals into the storage of the browser.
- The photo files in the archive stay as they are: same bytes, no decode and no new encode.

## Open Questions

| Id | Question | Blocks |
|---|---|---|
| Q-1 | Can a real iPhone and a real Android phone save and read a 1.5 GB ZIP in the browser? Nobody has measured this. If they cannot, what limit does the app state? | R-13 |
