# Plan: album archive

_Brief: `.devflow/brief.md` · Created: 2026-11-01 · Changed after a plan review on 2026-11-01_

## Overview

This plan adds one ZIP file that holds a whole album: the layout and the originals of the used photos. Phase 1 builds the file format with no interface, so that unit tests can prove the bytes. Phase 2 adds the save in the editor. Phase 3 adds the open, because an open needs a real archive to test against. The interface of each phase rests only on the format contract below.

## Changed Contracts

**New module `src/storage/archive.ts`:**

```ts
export type ArchiveErrorReason = 'zip' | 'content' | 'damaged' | 'too-large';
export class ArchiveError extends Error { constructor(readonly reason: ArchiveErrorReason); }
/** A photo file that could not be read during the build. */
export class UnreadablePhotoError extends Error { constructor(readonly photoId: string); }

/**
 * The album as an archive holds it: only used photos, each photo with a unique file name, and
 * `lastFileSaveAt` set to `savedAt`.
 */
export function archivableAlbum(a: Album, savedAt: number): Album;
export function archiveFileName(a: Album): string; // `<album name>.album.zip`
/** Throws ArchiveError('too-large') when the sizes, the headers and the entry count do not fit in a ZIP without ZIP64. */
export function assertFitsArchive(sizes: number[]): void;
export function crc32OfBlob(blob: Blob, onBytes?: (n: number) => void): Promise<number>;
/**
 * `a` comes from archivableAlbum. `originals` maps a photo id to its file. `album.json` gets each
 * photo `size` from its file. The Blob refers to the files. Throws UnreadablePhotoError.
 */
export function buildArchive(a: Album, originals: Map<string, File>, onProgress: (done: number, total: number) => void): Promise<Blob>;
export function isZip(file: Blob): Promise<boolean>;
/** Reads the directory and the layout only. Throws ArchiveError or LayoutFileError. */
export function readArchive(file: Blob): Promise<OpenedArchive>;
export interface OpenedArchive {
  album: Album;
  /** One file per photo, named as the photo. Each one refers to a part of the archive. */
  originals: Map<string, File>;
  /** Compares the CRC-32 of each photo. Throws ArchiveError('damaged'). */
  verify(onProgress: (done: number, total: number) => void): Promise<void>;
}
```

**Archive layout:** `album.json` is the first entry. Its content is the output of `serializeLayout` (`src/storage/layoutFile.ts:27`). Each photo is at `photos/<meta.name>`. All entries use the ZIP method "stored", with the UTF-8 name flag. A photo name is unique in an archive, without regard to case. The app finds a photo only by its `meta.name`, and it never uses an entry path as a path to write.

**`src/storage/layoutFile.ts`:** `openLayoutFile(): Promise<Album>` goes away. `pickAlbumFile(): Promise<File>` replaces it, and it accepts `.json` and `.zip`. The only consumer is `src/ui/App.tsx:107`. `parseLayout` stays as it is.

**`src/photos/originals.ts`** gets the parts of the originals flow that the print export has today, so that the export and the archive share one copy:

```ts
export class MissingOriginalsError extends Error { constructor(readonly photoIds: string[]); } // moved from src/export/export.ts
/** Returns an original for each photo, or throws MissingOriginalsError. */
export function readOriginals(albumId: string, photos: PhotoMeta[]): Promise<Map<string, File>>;
/** Matches the chosen files and registers each match. `left` holds the photos with no file. `ambiguous` holds the names of the photos in `left` with no single match. */
export function registerChosenOriginals(wanted: PhotoMeta[], files: File[]): Promise<{ left: PhotoMeta[]; ambiguous: string[] }>;
/** Removes the stored file of a photo from the memory of this session. */
export function forgetOriginal(photoId: string): void;
```

Consumers: `src/export/export.ts`, `src/ui/ExportDialog.tsx`. The print export renders the same files as before. Its request for originals changes in three ways, because the function is shared:

- A second round of the file chooser asks only for the photos that are still missing.
- Photos with the same name and size share one chosen file.
- A photo with no single match shows the string `originalsAmbiguous`, not the "not found" string. A review found that the old text is false for this case.

**`src/storage/db.ts`:** new `deletePreviews(ids: string[]): Promise<void>`, `deleteDirHandle(albumId: string): Promise<void>` and `storedPhotoIds(): Promise<Set<string>>`.

**Shared parts after the feature-wide review.** The person asked to act on all review findings. Each rule below has one copy.

`src/storage/archive.ts` also exports these parts:

```ts
export function nameKey(name: string): string;
/** Returns `name` when it is free. Else it adds -2, -3 and so on. The result goes into `taken`. */
export function freeName(name: string, taken: Set<string>): string;
export function isPlainName(name: string): boolean;
/** The photos that the archive holds. `archivableAlbum` and the save dialog both use it. */
export function archivablePhotos(a: Album): PhotoMeta[];
/** Writes in 1 MiB slices. A failure calls abort() and rejects with the first error. */
export function writeInSlices(handle: WritableFile, blob: Blob, onBytes: (done: number) => void): Promise<void>;
/** Calls the save picker, or starts a download when no picker exists. An AbortError propagates. */
export function saveArchiveBlob(blob: Blob, name: string, onBytes: (done: number) => void): Promise<'saved' | 'received'>;
```

`OpenedArchive` also gets `expectedCrc: Map<string, number>`, from the directory of the ZIP.

`src/storage/layoutFile.ts` also exports `safeBaseName(name)`, `downloadBlob(blob, name, lifetimeMs)` and `PickerWindow`. `src/export/export.ts` also exports `safeName`, and it uses `downloadBlob`.

`src/photos/originals.ts`: `getOriginal` is private. A failed read of the stored folder gives `null`, so `readOriginals` throws `MissingOriginalsError`. `registerChosenOriginals` changes:

```ts
export function registerChosenOriginals(wanted: PhotoMeta[], files: File[], onDescribed?: (done: number, total: number) => void): Promise<{
  left: PhotoMeta[];
  ambiguous: string[];   // no single candidate
  unmatched: string[];   // no candidate, and no other photo of this name got a file in this round
  sameName: string[];    // no candidate, and another photo of this name got a file in this round
  inexact: PhotoMeta[];  // the registered file has another name or another size
}>;
```

`src/photos/import.ts` exports `acceptedExtension(name): string | null`. New module `src/photos/archiveFolder.ts` holds the folder writing, the name rules and the screen-copy cleanup of the open. `src/ui/ArchiveOpenDialog.tsx` keeps the picker, `claim()`, `finish` and `putDirHandle`. `src/ui/ArchiveDialog.tsx` becomes `src/ui/ArchiveSaveDialog.tsx`, and its test ids do not change.

## Decision Log

- **The save refers to files and does not copy them.** The print export ZIP keeps all chunks in memory (`src/export/export.ts:72`). This does not suit 1.5 GB on a phone. `buildArchive` reads each file in small slices only to calculate its CRC-32. Then it makes a `Blob` from the headers and the `File` objects. fflate does not support this, so `src/storage/archive.ts` writes and reads the ZIP structures itself. The open uses `Blob.slice` in the same way.
- **Q-1 does not change this plan.** The design holds no whole file in memory on any device. Only a person on a real phone can prove R-13. E-8 covers an error that JavaScript sees. It does not cover a page that the phone stops for lack of memory. The order of the open keeps the stored album safe in that case too.
- **No ZIP64.** An album over the ZIP limit gets `ArchiveError('too-large')`, and the app shows a message (E-8). The limit check includes a margin for the headers, and the limit of 65,535 entries. The agreed size is 1.5 GB.
- **A duplicate name changes at save time.** `archivableAlbum` gives the second photo a new name, `IMG_0001-2.jpg` for example. The layout in the archive holds that name. A name and a size then find the file in a folder (`src/photos/originals.ts:34-36`). They also find it when the person chooses files again (`src/photos/match.ts:18`). The album on the saving device keeps its names (R-14).
- **The file decides the size.** The match ladder accepts a file of another size (`src/photos/match.ts:19-24`). So `buildArchive` writes each photo `size` from its file, and `readArchive` refuses an entry whose size differs from the layout. Otherwise `getOriginal` does not find the file after a reload.
- **A close match in an archive needs a click.** The match ladder stays as it is. A chosen file that matches at a low level can differ from the first import. A resized copy is one example. The person chose that an archive must not take such a file silently (R-16). A full block is not safe. iPhone may give a converted file with another size, and then that album could never save. Nobody measured this. So the save dialog names each photo in `inexact` and shows two buttons. `Використати ці файли` keeps the files. `Обрати інші` removes them with `forgetOriginal` and asks for these photos again. The print export ignores `inexact`, so C-35 stays as it is. R-4 means the file that the app reads as the original of the photo.
- **The save dialog checks each file that it reads.** The print export ignores `inexact`, and `src/ui/RelinkDialog.tsx:38` registers files with no such check. So a close file can be in memory before the save starts. After `readOriginals`, the save dialog compares the name and the size of each file with the photo in the album. A difference gives the `inexact` state, with the same two buttons (R-16). The dialog keeps the ids that the person accepted, and it does not ask again about these ids while it stays open. A close of the dialog keeps the file in memory, so the print export does not ask again. The next save asks again.
- **The undo keys stop while the archive save dialog is open.** The first click builds the file. The second click saves it. An undo between the clicks leaves the file on an earlier album, and `onSaved` then stops the reminder for the changed album. So `src/ui/Editor.tsx` ignores the undo and redo keys while this dialog is open (E-14). The probe found a second route: the Tab key reaches the undo button and the other controls behind the dialog. So the editor content behind this dialog is `inert` while the dialog is open, and the dialog takes the focus when it opens. The print export dialog does not change, because the person did not ask for that.
- **The first request for originals shows a count.** R-5 says that the app says how many. R-6 names each photo only when the original is still not found after a round of the file chooser. So the first request shows no names.
- **A `SecurityError` from a folder picker needs a new click.** The print export dialog then shows its `matched` state. Phase 3 owns this branch in `src/ui/ExportDialog.tsx`, in its step 8, and `tests/e2e/archive-open.spec.ts` tests it.
- **One file picker at a time.** A second `showOpenFilePicker` call rejects while the first picker is open, and `openFile` then shows a false error. The probe saw this in headed Chromium. So `pickAlbumFile` in `src/storage/layoutFile.ts` gives the running call to a second click, and it starts no second call (E-15). `App.openFile` then uses the file one time, because of its `opening` ref. A cancel ends both waits with an `AbortError`, and no error shows. Another failure also ends both waits. So `openFile` keeps the last error object in a ref, and it shows one alert for one failure. The file input route does not change, because a browser with no cancel event never ends its wait.
- **A folder that no longer exists is a missing original.** `dir.values()` can reject after a person moves a folder or removes a drive. `getOriginal` then gives `null`, so the person gets the normal request for originals (E-11).
- **A second round names a duplicate correctly.** A photo in `sameName` shows a string that asks for the second file of that name. It does not show "not found".
- **The match shows a count.** `registerChosenOriginals` reports each described file. The save dialog has a `matching` state with the count, and `archive-close` stays disabled in this state.
- **Two photos with the same name and size** are one file that the person added twice. `registerChosenOriginals` assigns one chosen file to all these photos, so that the save does not stay blocked.
- **The folder is a new subfolder.** The open writes into `<chosen folder>/album-<album name>/` and stores the handle of that subfolder. The print export uses the same pattern (`src/export/export.ts:58`).
- **A file that exists in that subfolder.** The app finds it through `dir.values()`, and it compares names without regard to case. The same exact name and the same CRC-32 means the app uses that file. Any other match, or a name that the file system refuses, means the app writes under a new name. The opened album takes that name for the photo (E-7).
- **The save has two clicks on all browsers.** The first click reads the originals, checks the size and builds the Blob. The dialog then shows the `link` state. A second click starts the download, or it calls the save picker and writes. A cancel of the picker returns to `link`, and the app does not build again. This order gives each browser a fresh click, and it touches no file on disk before the build passes.
- **The write has a counter.** The picker route writes in slices, advances the counter for each slice, and calls `abort()` on a failure. A browser gives the page no event when a link download ends. So the link route says that the browser received the file. It does not say that the save completed.
- **A file that stops being readable.** If a read fails during the build, `UnreadablePhotoError` names the photo. The dialog calls `forgetOriginal` and asks for that photo through the normal request (R-5, R-6).
- **A folder picker needs a fresh click** (`src/ui/ExportDialog.tsx:80`). The open dialog shows a separate button for the folder, and one button to continue without a folder. An `AbortError` from the folder picker has the same result as the continue button (E-6).
- **An open with no folder removes the old handle.** A replace with no folder can leave a stored handle for that album id. It can point to another photo with the same name and size. So the open calls `deleteDirHandle` at the step where the folder route calls `putDirHandle`. After a reload, the print export asks for originals, as R-11 says.
- **An archive with no photo has no folder step.** A folder for no files only stores a useless handle (E-4).
- **One open at a time.** The open dialog calls `verify()` one time, for the archive that it got first. So `App.openFile` ignores a chosen file while a read of a file runs or while the open dialog shows. The file that the person chose first stays the file that opens. The dialog also takes the focus when it opens, so that the Enter key does not reach the open button behind it. A second file must not replace an archive with no `verify()` (E-2).
- **The open changes state last.** The order is: `verify()`, folder files, screen copies, `forgetPreviews`, `putDirHandle`, `registerOriginals`, session. A failure before the last three steps leaves the handle, the memory of originals and the session as they were.
- **A skipped file in `importFiles` has three causes.** The `catch` at `src/photos/import.ts:147-149` also receives a storage failure from `putPreview`. After `importFiles`, the open sorts each skipped file. A name that `isAccepted` refuses means E-12, and the app names the photo as in E-9. A width of 0 from `describeFile` means E-9. Any other result means E-8, and the open stops.
- **The save changes only the file save time on the saving device.** R-14 and R-15 say so. The photos, the spreads and the counter stay as they were. `src/ui/ArchiveSaveDialog.tsx` does not write to the store. It calls an `onSaved(at)` prop after a saved or received result, and `src/ui/Editor.tsx` sets `lastFileSaveAt`, as it does for a layout file. A cancel or a failed write does not call it. The copy of the album inside `album.json` also has `lastFileSaveAt` set to the save time. So the opening device does not show the reminder right after an open (`tests/e2e/relink.spec.ts:233` requires this for a layout file).
- **The save dialog has a `picking` state.** Phase 3 solved a double click in the open dialog. The save dialog uses the same three parts: a `picking` state in `busy`, a text for this state, and a `running` ref with `claim()` (E-13). A cancel returns to `link` with the built Blob.
- **The app has one folder picker type and one check.** The feature-wide review found two forms of each. `PickerWindow` in `src/storage/layoutFile.ts` holds `showDirectoryPicker`, and `folderPicker()` is the one check. So phase 3 also changes the picker type or the check in `src/export/export.ts`, `src/ui/PhotoPanel.tsx` and `src/ui/RelinkDialog.tsx`.
- **The action label is `Архів з фото`.** The phone top bar has no free space, and a mistake between two save buttons started this feature.
- **The top bar sizes come from a measurement.** At 390 px, the history and action buttons get 4 px side padding, `font-size: 13px` and `flex: none`. With the new button, this gives 3 rows and 118 px. At 16 px, the same bar has 4 rows and 122 px. At 900 px, the new button reaches 940 px, so `.editor.desktop .top-bar` must wrap.

## Phases

### Phase 1: The archive format

**Satisfies:** R-2, R-3, R-4

**Goal:** One tested module writes an album and its originals into a standard ZIP and reads them back, with no interface.

**Files:**
- `src/storage/archive.ts` (new)
- `src/storage/layoutFile.ts` (change)
- `tests/unit/archive.test.ts` (new)

**Steps:**
1. Declare the contract of `src/storage/archive.ts` from *Changed Contracts*.
2. Implement `archivableAlbum` with `photoUsage` (`src/model/album.ts:156`). A photo that only a cover cell or an unprinted half uses counts as used.
3. Implement the CRC-32, the ZIP writer and the ZIP reader. The reader finds the end record, reads the central directory, and accepts only the method "stored".
4. `readArchive` refuses four cases with the reason `content`. The first is a layout with no `photos` array. The second is a photo name with a slash or a backslash. The third is an album photo with no entry. The fourth is an entry of another size.
5. Test with `// @vitest-environment node`. Read the output with `unzipSync` from fflate, so that a second implementation judges the ZIP structure. fflate does not check the CRC, so compare each CRC with `crc32` from `node:zlib`, and compare each local header with its central header.
6. Add the shared parts of *Changed Contracts* to `src/storage/archive.ts` and `src/storage/layoutFile.ts`. Add tests for `writeInSlices` and `freeName`. Add a read-side memory test with a 3 MB photo, and a table test of the reader refusals. State the read failure in the doc comments of `readArchive` and `verify`.

**Completion Criterion:** `npx vitest run tests/unit/archive.test.ts` exits 0. The tests cover these cases:

- The sha256 of each photo matches after a round trip.
- An unused photo is absent, and a photo on the cover is present.
- A photo that only an unprinted half uses is present.
- Two photos with the same name both survive.
- Two names that differ only in case both survive.
- A name that collides with an existing `IMG_0001-2.jpg` survives.
- A Cyrillic name round-trips, with flag bit 11 set.
- An album with no used photo round-trips.
- The CRC-32 of the text `123456789` is `0xCBF43926`.
- `album.json` holds the size of the file, also when the file has another size than the photo in the album.
- `lastFileSaveAt` in `album.json` equals `savedAt`.
- An archive cut short gives `zip`, and a deflated ZIP gives `zip`.
- A changed photo byte gives `damaged` from `verify`.
- A newer layout version gives `LayoutFileError`.
- Each of the four refusals of step 4 gives `content`.
- Sizes of 5 GB give `too-large`, and so do 65,536 entries.
- A file that cannot be read gives `UnreadablePhotoError` with its photo id.

### Phase 2: Save an archive from the editor

**Depends on:** Phase 1

**Satisfies:** R-1, R-5, R-6, R-12, R-14, R-15, R-16 · changes C-40 · keeps C-35

**Goal:** A person saves an archive from the editor on a computer and on a phone. Missing originals stop the save and the app names them.

**Files:**
- `src/photos/originals.ts` (change)
- `src/export/export.ts` (change)
- `src/ui/ExportDialog.tsx` (change)
- `src/ui/ArchiveSaveDialog.tsx` (new)
- `src/ui/Editor.tsx` (change)
- `src/ui/strings.ts` (change)
- `src/ui/styles.css` (change)
- `tests/e2e/archive-helpers.ts` (new)
- `tests/e2e/archive-save.spec.ts` (new)
- `tests/e2e/export.spec.ts` (change)
- `tests/e2e/phone-actions.spec.ts` (change)

**Steps:**
1. Move `MissingOriginalsError` to `src/photos/originals.ts`, and add `readOriginals`, `registerChosenOriginals` and `forgetOriginal`. Change `src/export/export.ts` and `src/ui/ExportDialog.tsx` to use them.
2. Add `src/ui/ArchiveSaveDialog.tsx`, with the structure of `src/ui/ExportDialog.tsx`. Its states are ready, running, matching, originals, inexact, matched, link, picking, writing, done and error. It shows the count of used photos, and it dispatches nothing to the store.
3. Follow the two clicks of the Decision Log. Each round of the file chooser uses only the photos that are still missing.
4. Add the action `action-save-archive` to the top bar in `src/ui/Editor.tsx`.
5. In `src/ui/styles.css`, give the history and action buttons the sizes of the Decision Log at phone widths, and make `.editor.desktop .top-bar` wrap. Change `tests/e2e/phone-actions.spec.ts` so that its skip applies per test. Add a test at 900 px on the desktop project, and a limit of 3 button rows at 390 px on the mobile project.

**Completion Criterion:** `npx playwright test tests/e2e/archive-save.spec.ts tests/e2e/phone-actions.spec.ts tests/e2e/dnd.spec.ts tests/e2e/export.spec.ts` exits 0. The spec proves these points on both browser projects:

- The sha256 of each photo in the downloaded ZIP is correct, and an unused photo is absent.
- A reload makes the save ask for the originals of used photos only.
- With one file not chosen, no download starts, and the name of that photo shows.
- Two rounds of the file chooser find two photos with the same name from `tests/fixtures/dup-a` and `tests/fixtures/dup-b`.
- The second click calls the save picker. A cancel of the picker returns to the link state with no second build.
- A failed write shows an error, calls `abort()`, and shows no done message.
- A file that stops being readable returns the dialog to the request for that photo.
- The counter on the saving device does not change.
- A double click on the save button calls the picker one time (E-13).
- A file of another size needs a click on the accept button, and the other button asks again (R-16).
- A saved or received result sets `lastFileSaveAt`, and a cancel or a failed write does not (R-15).
- A stored folder that no longer exists gives the request for originals (E-11).
- A close file that the print export took first gets the same question in the save dialog (R-16).
- The undo and redo keys do not change the album while the save dialog is open, and they work again after a close (E-14).
- The Tab key does not reach a control behind the save dialog, and the controls work again after a close (E-14).

### Phase 3: Open an archive on any device

**Depends on:** Phase 2

**Satisfies:** R-7, R-8, R-9, R-10, R-11, R-12, R-13, R-14 · keeps C-26, C-27, C-35

**Goal:** `Відкрити файл` opens an archive as a complete album that can print, and the app keeps the originals in a folder where the browser allows it.

**Files:**
- `src/storage/layoutFile.ts` (change)
- `src/storage/db.ts` (change)
- `src/ui/App.tsx` (change)
- `src/export/export.ts` (change)
- `src/ui/PhotoPanel.tsx` (change)
- `src/ui/RelinkDialog.tsx` (change)
- `src/photos/archiveFolder.ts` (new)
- `src/photos/import.ts` (change)
- `src/ui/ArchiveOpenDialog.tsx` (new)
- `src/ui/ExportDialog.tsx` (change)
- `src/ui/strings.ts` (change)
- `tests/e2e/archive-open.spec.ts` (new)
- `tests/unit/archiveFolder.test.ts` (new)
- `tests/unit/storage.test.ts` (change)

**Steps:**
1. Replace `openLayoutFile` with `pickAlbumFile`. In `src/ui/App.tsx`, `isZip` selects the archive route, and every other file goes to `parseLayout` as before. Show a separate message for `LayoutFileError('version')`.
2. On the archive route, call `readArchive`, then show the existing confirmation for an album with the same id (`src/ui/App.tsx:119`).
3. Add `src/ui/ArchiveOpenDialog.tsx`. It calls `verify` with progress. With `showDirectoryPicker` in `window`, it offers the folder and the continue button of the Decision Log.
4. Write the originals into the subfolder, with the name rules of the Decision Log. Do not store the handle yet.
5. Call `importFiles` (`src/photos/import.ts:119`) with the photo ids, so that each photo gets screen copies. Sort each skipped file with `describeFile`, as the Decision Log says. Name each photo that the browser cannot decode (E-9).
6. Call `forgetPreviews`, then `putDirHandle` with the handle of the subfolder or `deleteDirHandle` with no folder, then `registerOriginals`. Then close the old session and open the new one with `openSession(album, true)`.
7. After a successful replace, call `deletePreviews` for the old photo ids that no stored album holds. On a failure, call `deletePreviews` and `forgetPreviews` for the new ids that no stored album holds, show the error, and keep the current album.
8. In `src/ui/ExportDialog.tsx`, treat a `SecurityError` from the folder picker as the `matched` state, which needs a new click. A permission prompt and a read of a large folder can use up the time that a browser allows after a click.
9. Test the folder on desktop Chromium with a `showDirectoryPicker` stub that returns a folder of `navigator.storage.getDirectory()`, which survives a reload.
10. Test R-9 in one spec that starts both engines: a save in iPhone 13 WebKit and an open in Chromium, then the reverse.
11. Move the folder writing, the name rules and the screen-copy cleanup to `src/photos/archiveFolder.ts`. Add `tests/unit/archiveFolder.test.ts`.

**Completion Criterion:** `npm test && npm run e2e` exits 0, including `tests/e2e/archive-open.spec.ts`. That spec proves these points:

- An archive in a clean browser context opens with no missing-photo banner and no relink request, and a print export finishes (R-8).
- The counter shows `використано N / N`, with no unused photo (R-14), and a counter advances during the open (R-12).
- With the folder stub, the export finishes after a reload with no request. Without the stub, the export asks for originals after a reload (R-10, R-11).
- Two photos from `tests/fixtures/dup-a` and `tests/fixtures/dup-b` each keep their own original after a reload (E-1).
- A file cut short, a foreign ZIP, a `.txt` file and a changed photo byte each give a message and change no album (E-2).
- The confirmation runs for an album with the same id, and a cancel changes nothing (E-3).
- A picker that rejects with `AbortError` still opens the album (E-6).
- A different file with the same name in the subfolder stays (E-7).
- A storage failure from an `IDBObjectStore.prototype.put` stub stops the open and keeps the album and its folder handle (E-8).
- A photo that cannot be decoded is named, and the album opens (E-9).
- A photo that decodes but has a refused name is named, and the album opens (E-12).
- A layout file that shows grey photos, then the archive of that album, shows the photos with no reload (R-8).

## Manual Checks

These checks need a real device or a real system dialog, so no phase criterion depends on them. `/df:check` reads them as `manual` rows of the phase 3 contract.

1. **R-13.** On a real iPhone and a real Android phone, save and open an album with 300 used photos and about 1.5 GB. On the iPhone, run this in Safari and in Home Screen mode.
2. **R-10.** In real Chrome, open an archive with a real folder, reload, and start the print export of a large album.
3. **R-2.** List one saved archive with a real ZIP tool. In Safari on a Mac, check that the `.album.zip` file stays with default settings.

## Edge Cases

| Brief id | Handled in | How |
|---|---|---|
| E-1 | Phase 1, Phase 2, Phase 3 | `archivableAlbum` gives each photo a unique name. A name and a size then find the correct file after a reload. Each round of the file chooser asks only for the missing photos |
| E-2 | Phase 1, Phase 3 | `ArchiveError` or `LayoutFileError` comes before any change, and `src/ui/App.tsx` shows a message |
| E-3 | Phase 3 | The confirmation at `src/ui/App.tsx:119` runs after `readArchive` and before any write |
| E-4 | Phase 1, Phase 3 | The archive holds only `album.json`, and the photo column opens empty |
| E-5 | Phase 2 | An `AbortError` from the save picker returns the dialog to the link state |
| E-6 | Phase 3 | The continue button and an `AbortError` from the picker both open the album with the originals in memory, as R-11 says |
| E-7 | Phase 3 | The name rules of the Decision Log keep the existing file |
| E-8 | Phase 1, Phase 2, Phase 3 | Each dialog shows an error state and no done message. The album, the handle and the memory of originals change only after all steps of the open pass |
| E-9 | Phase 3 | `describeFile` gives a width of 0, and the dialog names the photo. The album still opens |
| E-10 | Phase 1 | `photoUsage` counts each cell of each spread, without regard to print |
| E-11 | Phase 2 | `getOriginal` gives `null` when the stored folder cannot be read, and the request for originals shows |
| E-12 | Phase 3 | The open sorts a refused name before `describeFile`, and the dialog names the photo |
| E-13 | Phase 2 | A `picking` state and a `running` ref stop the second click |
| E-14 | Phase 2 | `src/ui/Editor.tsx` ignores the undo and redo keys while the archive save dialog is open. The editor content behind the dialog is `inert` |
| E-15 | Phase 3 | `pickAlbumFile` gives the running picker call to a second click |

## Not Implemented

- A transfer between devices.
- A copy of the originals in the storage of the browser.
- An archive with some originals missing, or with screen copies in place of originals.
- A merge of an archive into an album that exists.
- Compression or a resize of the originals, and a password on the archive.
- A transfer of the photos that no cell uses.
- A change to the files of the print export, or to the `.album.json` format.
