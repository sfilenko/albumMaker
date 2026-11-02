---
description: What the project does in the ui code area. One row per delivered requirement, with its verdict.
area: ui
paths: ["src/ui/**"]
last_verified: 71bad5265dc7caecca0486cac3a1e4843bea4e96
---

| Id | Capability | Delivered by | Req | Evidence |
|---|---|---|---|---|
| C-1 | All user-visible text is in Ukrainian | `feat-album-builder` | R-1 | phase-4 `pass` |
| C-4 | Create, open, rename and delete albums, and keep the list after a reload | `feat-album-builder` | R-4 | phase-2 `pass`, phase-4 `pass` |
| C-5 | The app opens the last open album at start | `feat-album-builder` | R-5 | phase-4 `pass` |
| C-6 | Four areas at 900 px and wider | `feat-album-builder` | R-6 | phase-4 `pass` |
| C-7 | Full-width spread and three tabs below 900 px | `feat-album-builder` | R-7 | phase-4 `pass` |
| C-10 | Photo column in numeric-aware file-name order | `feat-album-builder` | R-10 | phase-5 `pass` |
| C-11 | Drag a photo onto a cell with a mouse or a finger | `feat-album-builder` | R-11 | phase-5 `pass` |
| C-12 | Tap a photo, then tap a cell, on a touch screen | `feat-album-builder` | R-12 | phase-5 `pass` |
| C-13 | Drag between cells swaps them, and drag to the column clears a cell | `feat-album-builder` | R-13 | phase-5 `pass` |
| C-14 | Exactly the 12 templates of the brief | `feat-album-builder` | R-14 | phase-1 `pass`, phase-5 `pass` |
| C-15 | A template change keeps the photos in cell order | `feat-album-builder` | R-15 | phase-1 `pass`, phase-5 `pass` |
| C-18 | Drag the border between two cells | `feat-album-builder` | R-18 | phase-1 `pass`, phase-4 `pass` |
| C-19 | The fold gap between two pages is not a border | `feat-album-builder` | R-19 | phase-1 `pass`, phase-4 `pass` |
| C-22 | Warning icon under 200 dpi | `feat-album-builder` | R-22 | phase-1 `pass`, phase-5 `pass` |
| C-23 | Guides for bleed, safe zone and fold | `feat-album-builder` | R-23 | phase-4 `pass`, phase-6 `pass` |
| C-27 | A layout opens on another device, and relink matches by name, size, pixel size and date | `feat-album-builder` | R-27 | phase-3 `pass`, phase-8 `pass` |
| C-29 | Add, delete and reorder spreads | `feat-album-builder` | R-29 | phase-1 `pass`, phase-5 `pass` |
| C-38 | Full-screen preview without guides and bleed | `feat-album-builder` | R-38 | phase-6 `pass` |
| C-39 | Home Screen banner on iPhone Safari | `feat-album-builder` | R-39 | phase-8 `pass` |
| C-40 | Reminder to save to a file after 3 days | `feat-album-builder` | R-40 | phase-8 `pass` |
| C-41 | Storage error banner with "Зберегти у файл" | `feat-album-builder` | R-41 | phase-2 `pass`, phase-8 `pass` |
| C-42 | Installable PWA that opens offline | `feat-album-builder` | R-42 | phase-8 `pass` |
| C-43 | GitHub Pages at one fixed address | `feat-album-builder` | R-43 | phase-8 `pass` · AC-8.25 `manual`, opened by hand on 2026-10-29 |
| C-44 | Photos never leave the device | `feat-album-builder` | R-44 | phase-3 `pass`, phase-8 `pass` |
| C-47 | The zoom slider, the mouse wheel and the pinch go down to the lower zoom limit | `feat-photo-zoom-out` | R-3 | phase-1 `pass`, phase-2 `pass` · probe `all.json` `pass` |
| C-50 | A new photo in a cell starts at zoom 1 and covers the cell | `feat-photo-zoom-out` | R-6 | phase-2 `pass` · probe `all.json` `pass` |
| C-53 | One zoom gesture (slider movement, wheel series, pinch) is one undo step | `feat-photo-zoom-out` | R-9 | phase-2 `pass` · probe `all.json` `pass` |
| C-54 | The editor action `Архів з фото` saves an archive, on a phone screen with no scroll | `feat-album-archive` | R-1 | phase-2 `pass` · probe `all.json` `pass_with_deviation` |
| C-58 | The archive save asks for unreadable originals of used photos, with a count | `feat-album-archive` | R-5 | phase-2 `pass` · probe `all.json` `pass_with_deviation` |
| C-59 | A photo that is still missing stops the archive, and the app names it | `feat-album-archive` | R-6 | phase-2 `pass` · probe `all.json` `pass_with_deviation` |
| C-60 | `Відкрити файл` opens an archive and a layout file, on the album list and in the editor | `feat-album-archive` | R-7 | phase-3 `pass` · probe `all.json` `pass_with_deviation` |
| C-61 | After an archive opens, no photo needs a relink | `feat-album-archive` | R-8 | phase-3 `pass` · probe `all.json` `pass_with_deviation` |
| C-62 | An archive opens on a computer and on a phone | `feat-album-archive` | R-9 | phase-3 `pass` · probe `all.json` `pass_with_deviation` · in emulation only |
| C-63 | With a folder picker, the open writes the originals to a subfolder and remembers it | `feat-album-archive` | R-10 | phase-3 `pass` · probe `all.json` `pass_with_deviation` · stub picker · real Chrome with a real folder not tested (AC-3.34, manual, not run) |
| C-64 | With no folder picker, the print export uses the originals of the archive until a reload | `feat-album-archive` | R-11 | phase-3 `pass` · probe `all.json` `pass_with_deviation` |
| C-65 | The archive save and open show progress and a clear result | `feat-album-archive` | R-12 | phase-2 `pass`, phase-3 `pass` · probe `all.json` `pass_with_deviation` |
| C-66 | A phone saves and opens an archive of 300 photos and about 1.5 GB | `feat-album-archive` | R-13 | **unproven**: phase-3 `pass` covers the design only · AC-3.30 (manual, blocking row) not run on a real phone · Q-1 open |
| C-67 | An opened album lists only the used photos, and the saving album changes only in its save time | `feat-album-archive` | R-14 | phase-2 `pass`, phase-3 `pass` · probe `all.json` `pass_with_deviation` |
| C-68 | An archive save resets the reminder of C-40, and a cancel or a failed save does not | `feat-album-archive` | R-15 | phase-2 `pass` · probe `all.json` `pass_with_deviation` |
| C-69 | A file with another name or size enters an archive only after the person agrees | `feat-album-archive` | R-16 | phase-2 `pass` · probe `all.json` `pass_with_deviation` |
