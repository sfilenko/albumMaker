# Brief: Album builder

_Created: 2026-10-28_

## Goal

A photographer can lay out a 30×30 cm Lay Flat wedding album in a browser on a computer or a phone. The album has about 15 spreads and about 60 photos. The photographer can keep the layout and export print-ready JPG files for Gramofon.

## Context

The project is new. The code is a scaffold only: `src/main.tsx:3` renders one heading, and `src/model/units.ts` converts millimetres to pixels at 300 dpi. No feature exists yet.

The source of all requirements is the approved design document `docs/2026-10-28-album-builder-design.md` (Ukrainian). The mockups are in `.superpowers/brainstorm/1839-1793216938/content/` (`layout.html`, variant A, and `templates-v2.html`, the 12 templates with exact proportions in the array `T`). An earlier implementation plan, `docs/superpowers/plans/2026-10-28-album-builder.md`, holds exact test values. `/df:plan` can use it as input material.

The user named two failures that make the tool useless, even if all other parts work. The first failure: the layout is lost. The second failure: the photos load slowly.

Gramofon does not publish file requirements. The print values below (bleed 3 mm, safe zone 10 mm, 300 dpi, sRGB) come from other photo-book services. The user has not uploaded finished pages to Gramofon before.

## Requirements

| Id | Requirement | How it will be observed |
|---|---|---|
| R-1 | All user-visible text is in Ukrainian. | Every screen, dialog, banner and error shows Ukrainian text. |
| R-2 | The album geometry is a 600×300 mm trim spread made of two 300×300 mm pages, with the fold at 300 mm. | Exported spreads and pages have the pixel sizes in R-31 and R-32. |
| R-3 | A new album has 1 cover spread and 15 spreads. Each spread uses the template "Одне фото на весь розворот". | Create an album: the spread strip shows "Обкладинка" and 15 more spreads, each with 1 empty cell. |
| R-4 | The user can create, open, rename and delete albums. The album list stays after a page reload. | Create two albums, rename one, reload: both show with the new name. Delete one: it does not come back after reload. |
| R-5 | When the app starts, it opens the album that was open last. | Open album B, reload: album B is open. |
| R-6 | At a viewport width of 900 px or more, the editor shows four areas at the same time. The photo column is on the left. The current spread is in the centre. The template library is on the right. The spread strip is at the bottom. | Desktop browser at 1280×800: all four areas are visible without a click. |
| R-7 | At a viewport width below 900 px, the editor shows the current spread at full width. Below it, the tabs "Фото", "Шаблони", "Розвороти" each show the related panel. | iPhone-size viewport: tap each tab, the related panel shows. |
| R-8 | In Chrome and Edge on a computer, the user can add a whole folder of photos. In all browsers, the user can add selected photo files. | Desktop Chrome shows "Додати папку" and "Додати фото". iPhone Safari shows "Додати фото". |
| R-9 | The import accepts `.jpg`, `.jpeg`, `.png` and `.webp` files (case-insensitive). It skips all other files and shows their names to the user. | Import a folder with a `.txt` file: the photos import, and a note names the `.txt` file. |
| R-10 | The photo column shows the photos in file-name order. The order is numeric-aware: `IMG_2` comes before `IMG_10`. The column shows a counter "використано X / Y". Each photo that is in one or more cells has a check mark. | Place 1 of 9 photos: the counter shows "використано 1 / 9" and that photo has a check mark. |
| R-11 | The user can drag a photo from the photo column onto a cell with a mouse or a finger. The photo then fills that cell. | Drag a photo onto an empty cell: the cell shows the photo. |
| R-12 | On a touch screen, the user can tap a photo and then tap a cell to put the photo into the cell. | iPhone viewport: tap photo, tap cell: the cell shows the photo. |
| R-13 | Dragging a photo from one cell onto another cell swaps the two cells' photos and crops. Dragging a photo from a cell onto the photo column makes that cell empty. | Both actions show the expected cells immediately. |
| R-14 | The template library has exactly the 12 templates of the list "Templates for R-14" below. Each template has the photo count of that list. The cell proportions are those in the array `T` of `templates-v2.html`. | The template panel shows the 12 names. Applying each one shows the stated number of cells. |
| R-15 | Choosing a template changes the current spread to that template. The photos that were on the spread go into the new cells in their previous order. Photos that do not fit stay in the album as unused photos. | Spread with 8 photos, choose "Фото + два": the first 3 photos are in the 3 cells. The other 5 show as unused in the photo column. |
| R-16 | Album settings set three values. The gap between photos has the default 6 mm. The margin from the spread edge has the default 0 mm. The background colour has the default ivory `#f4efe6`, and the options white `#ffffff` and black `#1d1d1d`. A setting change applies to all spreads of the album. | Change the gap to 12 mm: the gaps on every spread become wider. |
| R-17 | Two templates use their own 35 mm margin: "Фото з широкими полями" and "Одне фото з полями + пуста сторінка". The margin setting does not change this margin. | Change the margin setting: these two templates do not change. |
| R-18 | The user can drag the border between two neighbouring photos with a mouse or a finger. The two neighbouring cells change size, and other cells do not change. No cell becomes smaller than 20 mm. | Drag a border: two cells change. Drag far past the end: the smaller cell stops at 20 mm. |
| R-19 | The gap at the fold between two separate pages is not a draggable border. | On "По фото на сторінку", no drag handle shows at the fold. |
| R-20 | A photo always fills its cell completely. When the photo and the cell have different proportions, the app crops the photo at the edges. | Put a portrait photo into a landscape cell: no empty area shows in the cell. |
| R-21 | The user can move the photo inside its cell and zoom it in (zoom from 1× to 8×) to choose the visible part. The photo always covers the cell. | Move and zoom a photo: the visible part changes, and no empty area shows in the cell. |
| R-22 | A cell whose photo gives less than 200 dpi at print size shows a warning icon. | A 1800×1200 px photo on a full spread shows the icon (about 75 dpi). |
| R-23 | The spread shows guide lines: the bleed area (default 3 mm), the safe zone (default 10 mm) and the fold line. The user can change the bleed and safe-zone values and can hide all guides. | Guides show by default. Hide them in settings: they disappear. |
| R-24 | The user can undo and redo each change. One continuous drag (border, crop) is one undo step. Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo. | Drag a border, press Ctrl+Z once: the border is back at its start. |
| R-25 | The app stores each change in the browser automatically, with no save button. The app keeps the change also when the tab closes immediately after the change. | Make a change, close the tab at once, open the app: the change is there. |
| R-26 | The user can save the layout to a file (`.album.json`) and open a layout file. The file holds the layout and photo descriptions, not the photos. | Save the file, delete the album, open the file: all spreads, templates, crops and settings come back. |
| R-27 | A layout can open on a device that does not have some of its photos. Then the app matches the photos that the user adds. It uses file name, file size, pixel size and capture date. A photo that it cannot find shows in its cell as a grey box with the file name. The box has a button to choose the file manually. The app never deletes such a photo from the layout. | Open a layout file on a second device, add the photos: matched photos show. An unmatched photo shows its name and "Знайти фото". |
| R-28 | When the user adds photos, the app makes small screen copies of them once and keeps them in the browser. Opening the album later does not read the original files. | Reopen an album with 60 photos: all photos show without a file prompt and without reading originals. |
| R-29 | The user can add a spread after the current spread, delete a spread, and change the spread order by dragging in the strip. The cover always stays first and cannot be deleted. | Add, delete and move spreads: the strip shows the new order after reload. |
| R-30 | A setting "Початок книги" has two values: "Сторінка 1 — ліва половина першого розвороту" (default) and "Сторінка 1 — окрема права сторінка". With the second value, the left half of the first spread and the right half of the last spread show as "not printed". A change of this setting deletes no photo from any cell. | Switch the setting: the halves show as not printed. Switch back: all photos are still in their cells. |
| R-31 | The export writes each non-cover spread as a JPG of 7157×3614 px. This is 606×306 mm with 3 mm bleed at 300 dpi. The file is sRGB, JPEG quality 95, with 300 dpi in the file header. | Export: open `spreads/spread-01.jpg`, it is 7157×3614 px and reports 300 dpi. |
| R-32 | The export also writes each printed page as a separate square JPG. With the setting "З вильотом" (default), a page is 3614×3614 px. With the setting "Без вильоту", a page is 3543×3543 px. The bleed on the fold side of a page comes from the neighbouring page. The file names follow the book page order. | Export: `pages/page-001.jpg` is 3614×3614 px. A photo across the fold continues without a seam in the two page files. |
| R-33 | The export never includes the cover. | Export: no file for the cover. |
| R-34 | In Chrome and Edge, the export writes the files into a folder that the user chooses. In other browsers, the export downloads one ZIP file. | Desktop Chrome: a folder picker opens. Firefox or Safari: a `.zip` downloads. |
| R-35 | The export can need original files that this session cannot read. Then the app asks the user to choose them. It matches them as in R-27, and then it exports. | Reload, export: the app asks for the originals, then exports. |
| R-36 | On a phone, the export dialog says that full-quality export of whole spreads works on a computer. | iPhone viewport: the export dialog shows this note. |
| R-37 | Before export, the app shows print warnings. It warns about fewer than 24 printed pages and about cells under 200 dpi. It also warns about photos on a half that is not printed, and about missing photos. | An album with 11 spreads shows the 24-page warning. |
| R-38 | A preview mode shows the album full screen, one spread at a time, without guides and without bleed. The user goes to the next and previous spread with arrows, keys or a swipe. | Open preview, press the right arrow key: the next spread shows. No guide lines show. |
| R-39 | The tool can run on iPhone Safari without a Home Screen install. Then a banner tells the user to add it to the Home Screen. The user can close the banner, and it stays closed. | iPhone Safari, not installed: the banner shows. Close it and reload: it does not show. |
| R-40 | A banner reminds the user to save the layout to a file when two conditions are true. The last file save is more than 3 days old. The layout changed after the last file save. | Change the album and move the clock 4 days forward: the banner shows with "Зберегти у файл". |
| R-41 | When the browser cannot store a change, a banner shows an error and a "Зберегти у файл" button. | Make storage fail, make a change: the banner shows. |
| R-42 | The app is an installable web app (PWA) and opens without a network after the first visit. | Install it, go offline, open it: it works. |
| R-43 | GitHub Pages serves the app at one fixed address. | The URL opens the app. The URL does not change between releases. |
| R-44 | Photos never leave the device. At run time, the app makes no network request other than loading its own files. | Network log during import, editing and export shows no request to another origin and no upload. |

### Templates for R-14

1. Одне фото на весь розворот — 1
2. По фото на сторінку — 2
3. Велике + 2 / 2 + велике — 6
4. Мозаїка з 6 фото — 6
5. Панорама + два — 3
6. Фото + два — 3
7. Фото + сітка 4 — 5
8. Три в ряд — 3
9. Чотири вертикальні — 4
10. Сітка 2×2 на кожній сторінці — 8
11. Фото з широкими полями — 2
12. Одне фото з полями + пуста сторінка — 1

## Out of Scope

- Text, captions, stickers, frames and picture backgrounds: the user did not ask for them.
- Cloud sync, accounts and a server: the user chose a browser-only tool.
- Direct ordering in Gramofon or a link to the Gramofon editor.
- More than one person on one album.
- Album formats other than 30×30 cm Lay Flat. The code must not prevent them, but the tool has no format selector.
- Export of the cover for print: Gramofon covers have other dimensions (spine).
- Full-quality export of whole spreads on iPhone: Safari cannot create an image larger than about 16.7 megapixels. The tool can offer page export on a phone if it works, but this is not a requirement.

## Edge Cases

| Id | Case | Expected behaviour |
|---|---|---|
| E-1 | A portrait photo stored as landscape with EXIF orientation 6. | Thumbnail, spread, crop and export all show it upright, with width and height swapped. |
| E-2 | Two different photos with the same file name (for example `IMG_0001.jpg` from two cameras). | Matching never swaps them. When it cannot tell them apart, the user chooses manually. |
| E-3 | About 60 large originals (for example 25 MB each) imported at the same time on a phone. | The import shows progress, does not decode all photos at the same time, and does not crash the tab. |
| E-4 | A HEIC file in a folder on a computer. | The import skips it and names it in the skipped list (R-9). |
| E-5 | The browser storage is full or not available (for example a private window). | The banner of R-41 shows. No change is lost without a visible message. |
| E-6 | The tab closes immediately after a change. | The app stores the change (R-25). |
| E-7 | Export with empty cells. | The empty cells export as background colour. The print warnings list them before export. |
| E-8 | The user deletes a photo from the album while cells use it. | Those cells become empty. |
| E-9 | The user opens a layout file whose album already exists in this browser. | The app asks "Замінити наявний альбом?" before it replaces anything. |
| E-10 | A template change on a spread with more photos than the new template has cells. | The extra photos stay in the album as unused (R-15). |
| E-11 | A border drag that would make a cell smaller than 20 mm. | The border stops at the 20 mm limit (R-18). |
| E-12 | The same photo in two cells. | Allowed. The photo column shows the number of uses on the photo. |

## Constraints

- No server and no account. All data stays in the browser of the device, plus the layout files that the user saves.
- Hosting is GitHub Pages on the user's account. The app address must not change after real use starts, because the browser stores the data per address.
- The phone model of the user is not known. The tool must work on iPhone Safari and on Android Chrome.
- The print values come from other photo-book services, not from Gramofon. All of them must be settings, not fixed values.
- Gates are in `.devflow/project.md`: `npm run build`, `npm run typecheck`, `npm test && npm run e2e`. There is no linter.

## Open Questions

| Id | Question | Blocks |
|---|---|---|
| Q-1 | Gramofon behaviour is not known. Is page 1 a left half or a single right page? Does Gramofon crop a 306×306 mm page image to 300×300 mm, or does it shrink the image? The user decided to make both behaviours settings (R-30, R-32) and to check Gramofon later. | Nothing in the build. It decides only the right setting values before the first print. |
| Q-2 | How fast is "fast" for photo loading? The user gave no number. Assumption: on a computer, an album with 60 photos shows all thumbnails within 2 s after it opens. | The acceptance check of R-28. |
| Q-3 | How does the user personally accept the tool? The user gave no scenario. Assumption: the user lays out one real wedding album of about 60 photos on a computer. Then the user continues on the phone, exports, and uploads the pages to Gramofon. | Final acceptance only. |
