---
description: Browser-only builder for a 30×30 cm Lay Flat photo album, with print export for Gramofon, published as a PWA on GitHub Pages
paths: [".github/workflows/pages.yml", "README.md", "playwright.config.ts", "public/icon-192.png", "public/icon-512.png", "src/export/export.ts", "src/export/jpeg.ts", "src/export/render.ts", "src/harness.ts", "src/main.tsx", "src/model/album.ts", "src/model/crop.ts", "src/model/layout.ts", "src/model/pages.ts", "src/model/templates.ts", "src/model/types.ts", "src/photos/import.ts", "src/photos/match.ts", "src/photos/originals.ts", "src/state/store.ts", "src/storage/autosave.ts", "src/storage/db.ts", "src/storage/layoutFile.ts", "src/ui/AlbumList.tsx", "src/ui/App.tsx", "src/ui/Banners.tsx", "src/ui/CellToolbar.tsx", "src/ui/Editor.tsx", "src/ui/ExportDialog.tsx", "src/ui/PhotoPanel.tsx", "src/ui/PreviewMode.tsx", "src/ui/RelinkDialog.tsx", "src/ui/SettingsDialog.tsx", "src/ui/SpreadStrip.tsx", "src/ui/SpreadView.tsx", "src/ui/TemplatePanel.tsx", "src/ui/dnd.ts", "src/ui/previews.ts", "src/ui/strings.ts", "src/ui/styles.css", "tests/e2e/crop.spec.ts", "tests/e2e/dnd.spec.ts", "tests/e2e/export.spec.ts", "tests/e2e/import.spec.ts", "tests/e2e/pwa.spec.ts", "tests/e2e/relink.spec.ts", "tests/e2e/settings.spec.ts", "tests/e2e/shell.spec.ts", "tests/e2e/spread.spec.ts", "tests/unit/album.test.ts", "tests/unit/crop.test.ts", "tests/unit/exportPlan.test.ts", "tests/unit/import.test.ts", "tests/unit/jpeg.test.ts", "tests/unit/layout.test.ts", "tests/unit/match.test.ts", "tests/unit/pages.test.ts", "tests/unit/storage.test.ts", "tests/unit/store.test.ts", "vite.config.ts"]
last_verified: 7cb4e2f91fc146fed9a53f64a630ab2f5effba43
---

# feat-album-builder

_Archived 2026-10-29 · 8 phases · verification record in `verification/index.md`_

## What shipped

A photographer can lay out a 30×30 cm Lay Flat wedding album in a browser on a computer or a phone. The app has no server. The album, the screen copies of the photos and the autosave live in IndexedDB, and a `.album.json` file moves a layout to another device. The export writes print-ready JPG spreads and pages at 300 dpi. The app installs as a PWA, opens offline, and GitHub Pages serves it at https://sfilenko.github.io/albumMaker/.

## Requirements delivered

Every phase verdict is `pass`. Every phase is proven at runtime by the feature-wide probe `all.json` (`pass_with_deviation`).

| Id | Requirement | Phase | Outcome |
|---|---|---|---|
| R-1 | All user-visible text is in Ukrainian | 4 | delivered |
| R-2 | 600×300 mm trim spread of two 300×300 mm pages, fold at 300 mm | 1 | delivered |
| R-3 | A new album has 1 cover and 15 spreads on the full-spread template | 1 | delivered |
| R-4 | Create, open, rename and delete albums, and keep the list after a reload | 2, 4 | delivered |
| R-5 | The app opens the last open album at start | 4 | delivered |
| R-6 | Four areas at 900 px and wider | 4 | delivered |
| R-7 | Full-width spread and three tabs below 900 px | 4 | delivered |
| R-8 | Add a folder (Chrome, Edge) or single photos (all browsers) | 3 | delivered |
| R-9 | Import accepts jpg, jpeg, png, webp and lists skipped files | 3 | delivered |
| R-10 | Photo column in numeric-aware file-name order | 5 | delivered |
| R-11 | Drag a photo onto a cell with a mouse or a finger | 5 | delivered |
| R-12 | Tap a photo, then tap a cell, on a touch screen | 5 | delivered |
| R-13 | Drag between cells swaps them, and drag to the column clears a cell | 5 | delivered |
| R-14 | Exactly the 12 templates of the brief | 1, 5 | delivered |
| R-15 | A template change keeps the photos in cell order | 1, 5 | delivered |
| R-16 | Gap, margin and background settings | 1, 6 | delivered |
| R-17 | Two templates use their own 35 mm margin | 1, 6 | delivered |
| R-18 | Drag the border between two cells | 1, 4 | delivered |
| R-19 | The fold gap between two pages is not a border | 1, 4 | delivered |
| R-20 | A photo always fills its cell | 1 | delivered |
| R-21 | Pan and zoom (1× to 8×) inside a cell | 1, 5 | delivered |
| R-22 | Warning icon under 200 dpi | 1, 5 | delivered |
| R-23 | Guides for bleed, safe zone and fold | 4, 6 | delivered |
| R-24 | Undo and redo, with one drag as one step | 2 | delivered |
| R-25 | Autosave with no save button, also on a tab close | 2 | delivered |
| R-26 | Save and open a `.album.json` layout file | 2 | delivered |
| R-27 | A layout opens on another device, and relink matches by name, size, pixel size and date | 3, 8 | delivered |
| R-28 | Screen copies made once and kept in the browser | 3 | delivered (Q-2 assumption) |
| R-29 | Add, delete and reorder spreads | 1, 5 | delivered |
| R-30 | Setting "Початок книги" with two values | 1, 6 | delivered (Q-1 open) |
| R-31 | Spread export at 7157×3614 px | 7 | delivered |
| R-32 | Page export with or without bleed | 7 | delivered (Q-1 open) |
| R-33 | The export never includes the cover | 7 | delivered |
| R-34 | Export to a folder (Chrome, Edge) or a ZIP | 7 | delivered |
| R-35 | The export asks for originals it cannot read | 7 | delivered |
| R-36 | Phone note in the export dialog | 7 | delivered |
| R-37 | Print warnings before export | 1, 7 | delivered |
| R-38 | Full-screen preview without guides and bleed | 6 | delivered |
| R-39 | Home Screen banner on iPhone Safari | 8 | delivered |
| R-40 | Reminder to save to a file after 3 days | 8 | delivered |
| R-41 | Storage error banner with "Зберегти у файл" | 2, 8 | delivered |
| R-42 | Installable PWA that opens offline | 8 | delivered |
| R-43 | GitHub Pages at one fixed address | 8 | delivered (manual row, opened by hand 2026-10-29) |
| R-44 | Photos never leave the device | 3, 8 | delivered |

## What broke along the way

The verdicts are overwritten in place, so the findings of earlier rounds survive only where this session or a decision recorded them.

- Phase 1: a gate failed while Phase 3 was half built. The gates judge the whole working tree, so the decision was a new Phase 1 verdict on the green tree.
- Phase 6: the preview had a line-for-line copy of the cell photo component (`PreviewPhoto`). The review found it. It is now one component.
- Phase 7: the export decoded all chosen originals at the same time, without the decode limit of 2 that import uses.
- Phase 7: two verifier questions led to two decisions. The export continues only on a new click after the originals match. A phone is a coarse pointer and a viewport under 900 px.
- Phase 8: the plan's Files list missed files three times. A cache in `previews.ts` kept "no screen copy" for ever, so a relinked photo stayed empty until a reload.
- Phase 8: opening a layout file showed the backup banner at once. The file kept the save time from before the save.
- Phase 8: a new test accepted the replace dialog without waiting for it, and it failed 3 times in 10 on WebKit.
- Phase 8: the relink dialog had a copy of the EXIF date reader. Later the export had a third copy of the file describer, and it did not read the date. So export and relink could match a photo to different files.
- Test gate: an import of 9 photos in WebKit takes 1.4 s alone. It takes up to 6.5 s while 8 tests run at the same time. The default `expect` timeout of 5 s failed the gate at random. A first fix ran the production-build test apart. It did not help, because the cause was CPU contention in WebKit. The timeout is now 15 s.
- Recurring class: a later phase wrote its own copy of a helper that an earlier phase had, and the copies then drifted apart. `review-all.md` lists more of these that nobody fixed.

## Not implemented

From the brief's Out of Scope:

- text, captions, stickers, frames and picture backgrounds
- cloud sync, accounts and a server
- direct ordering in Gramofon
- more than one person on one album
- formats other than 30×30 cm Lay Flat
- export of the cover for print
- full-quality export of whole spreads on iPhone

The feature dropped no requirement.
