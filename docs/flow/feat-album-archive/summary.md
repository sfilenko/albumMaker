---
description: One ZIP file holds an album layout and the originals of the used photos, and it opens on another device
area: ui
paths: ["src/export/export.ts", "src/photos/archiveFolder.ts", "src/photos/import.ts", "src/photos/originals.ts", "src/storage/archive.ts", "src/storage/db.ts", "src/storage/layoutFile.ts", "src/ui/App.tsx", "src/ui/ArchiveOpenDialog.tsx", "src/ui/ArchiveSaveDialog.tsx", "src/ui/Editor.tsx", "src/ui/ExportDialog.tsx", "src/ui/PhotoPanel.tsx", "src/ui/RelinkDialog.tsx", "src/ui/strings.ts", "src/ui/styles.css", "tests/e2e/archive-helpers.ts", "tests/e2e/archive-open.spec.ts", "tests/e2e/archive-save.spec.ts", "tests/e2e/export.spec.ts", "tests/e2e/phone-actions.spec.ts", "tests/unit/archive.test.ts", "tests/unit/archiveFolder.test.ts", "tests/unit/storage.test.ts"]
last_verified: 71bad5265dc7caecca0486cac3a1e4843bea4e96
---

# feat-album-archive

_Archived 2026-11-02 · 3 phases · verification record in `verification/index.md`_

## What shipped

Before this feature, no single file held a whole album. A layout file has no photos, so a person had to relink each photo on the other device. Now the action `Архів з фото` saves one `<album name>.album.zip`, with the layout and the original bytes of the used photos only. `Відкрити файл` opens this file on a computer and on a phone, with no relink.

The format is a stored ZIP with no ZIP64. The save refers to `File` objects and does not copy them, and the read uses `Blob.slice`, so no whole photo stays in memory. Nobody has measured the limit of 300 photos and 1.5 GB on a real phone.

## Requirements delivered

All three phase verdicts are `pass`. The feature-wide probe `all.json` is `pass_with_deviation`, with 53 checks (42 pass, 11 substituted, 0 fail).

| Id | Requirement | Phase | Outcome |
|---|---|---|---|
| R-1 | An editor action saves the album as an archive, on the screen of a phone with no scroll | 2 | delivered |
| R-2 | The save gives one standard ZIP named `<album name>.album.zip` | 1 | delivered. A real ZIP tool and Safari on a Mac are not tested (AC-3.35) |
| R-3 | The archive holds the layout | 1 | delivered |
| R-4 | The archive holds the byte-identical original of each used photo, and no other photo | 1 | delivered |
| R-5 | An unreadable original of a used photo gives a request for files, with a count | 2 | delivered |
| R-6 | A photo that is still missing stops the archive, and the app names it | 2 | delivered |
| R-7 | `Відкрити файл` opens an archive and a layout file, on both screens | 3 | delivered |
| R-8 | After an open, no photo needs a relink | 3 | delivered |
| R-9 | An archive opens on a computer and on a phone | 3 | delivered, in emulation |
| R-10 | With a folder picker, the open writes the originals to a folder and remembers it | 3 | delivered. A real folder dialog is not tested (AC-3.34) |
| R-11 | With no folder picker, the print export uses the originals until a reload | 3 | delivered |
| R-12 | The save and the open show progress and a clear result | 2, 3 | delivered |
| R-13 | A phone saves and opens 300 photos and about 1.5 GB | 3 | **not proven**. A person must run AC-3.30 on real phones (Q-1) |
| R-14 | An opened album lists only the used photos. The saving album changes only in its save time | 2, 3 | delivered |
| R-15 | A save resets the reminder of C-40, and a cancel or a failed save does not | 2 | delivered |
| R-16 | A file with another name or size enters an archive only after the person agrees | 2 | delivered |

## What broke along the way

- Phase 2 review, must-fix: `registerChosenOriginals` dropped the ambiguous list, so the app said "not found" for a file that matched two photos. Fixed.
- Phase 3, second verifier run, blocker B-1. A second file chosen while the open dialog showed replaced the archive with no `verify()`. So a damaged archive opened with no error. Each spec drove one file. Fixed with one `opening` ref.
- Feature-wide review: 6 should-fix findings. Most of them were copies of one rule in two phases: `freeName`, the slice write, the file-name cleaning and the used-photo rule. A double click was safe in the open dialog and not in the save dialog. The recurring class of earlier features came back: a value with two copies drifts.
- Verifier question, R-16: the print export takes a close file silently. That file then reached the archive from memory with no question. The save dialog now checks each file that it reads.
- Verifier question: an undo between the two clicks of the save left the built file on an earlier album. The undo keys now stop while the dialog is open.
- Probe sweep, after that fix: the Tab key still reached the undo button behind the dialog. No row covered it, because the row named only the keys. The editor content behind the dialog is now `inert`.
- Probe sweep in headed Chromium: a double click on the open button gave the false alert `File picker already active`. Headless Chromium and each stub gave no alert. So a picker stub can hide a browser rule.
- Probe, AC-3.27: the driver read `window.__store` directly after a reload, and it failed two times. This was a race in the driver. The product had no defect.
- Test gap, AC-3.27: the spec seeds `LAND-1.JPG`, so only a unit test and the probe cover the exact name.
- A subagent ended its turn while its gates ran in the background, and no report came to the main session. A later prompt asked for gates in the foreground.
- The Git Bash `/tmp` path does not exist for a Windows Python. Use the scratchpad.

## Not implemented

From the brief's Out of Scope:

- a transfer of the file between devices
- a transfer of the photos that no cell uses
- a copy of the originals in the storage of the browser
- an archive with some originals missing, or with screen copies in place of originals
- a merge of an archive into an album that exists
- compression, a resize, or a password
- a change to the files of the print export or to the `.album.json` format

Known limits that nobody fixed:

- `nameKey` only changes case. Two names that differ only in Unicode normal form count as different. On a file system that treats them as one name, the open can write over an existing file. The verifier did not reproduce this.
- A double click on the open button on the file input route can start two file choosers. The `opening` ref ignores the second file.
- The print export dialog keeps the undo keys and the page behind it active. The person asked for a change only in the archive dialog.
- An `album.json` that is not JSON inside a ZIP gives the layout message. A subfolder stays after a failed open.

The feature dropped no requirement.
