# Plan: Album builder

_Brief: `.devflow/brief.md` · Created: 2026-10-28_

## Overview

The build goes from the inside out. Phase 1 builds the album model as pure TypeScript in millimetres: templates, cell geometry, borders, crop, album operations, page mapping and print warnings. Phase 2 adds the undoable store and all persistence (IndexedDB, autosave, layout file). Phase 3 adds photo import, screen copies (previews) and photo matching. Phases 4 to 6 build the user interface on top of these modules: the shell and spread view, then the editing interactions, then settings and preview. Phase 7 adds the print export. Phase 8 adds relinking in the interface, the safety banners, the PWA and the GitHub Pages workflow. This order puts every rule that a test can pin down into pure code first, so that the interface phases only render model output and dispatch model operations.

The earlier plan `docs/superpowers/plans/2026-10-28-album-builder.md` holds the same decomposition with exact test assertions per task (Tasks 2–17). An implementer can use it as a reference. If it disagrees with this plan, this plan wins.

## Changed Contracts

All contracts are new. No existing code consumes them, other than `src/model/units.ts` (exists: `PX_PER_MM`, `mmToPx`, `TRIM_W = 600`, `TRIM_H = 300`, `PAGE_W = 300`, `FOLD_X = 300`, `canvasSizeMm(bleedMm)`).

Shared types, `src/model/types.ts` (Phase 1, used by all later phases):

```ts
export interface Rect { x: number; y: number; w: number; h: number } // millimetres
export type LayoutNode =
  | { kind: 'cell' }
  | { kind: 'cols' | 'rows'; sizes: number[]; children: LayoutNode[] };
export type SpreadLayout =
  | { mode: 'spread'; root: LayoutNode; padMm?: number }
  | { mode: 'pages'; left: LayoutNode | null; right: LayoutNode | null; padMm?: number };
export interface Crop { cx: number; cy: number; zoom: number } // centre of visible area 0..1, zoom 1..8
export interface Cell { photoId: string | null; crop: Crop }
export type TemplateId = 'full'|'two'|'ex2'|'ex1'|'pano'|'p12'|'p14'|'row3'|'row4'|'g8'|'mat'|'solo';
export interface Spread { id: string; templateId: TemplateId; layout: SpreadLayout; cells: Cell[]; isCover: boolean }
export type BookStart = 'full-spread' | 'single-right';
export type PageExport = 'bleed' | 'trim';
export interface AlbumSettings { gapMm: number; marginMm: number; background: string; bleedMm: number; safeMm: number; showGuides: boolean; bookStart: BookStart; pageExport: PageExport }
export interface PhotoMeta { id: string; name: string; size: number; width: number; height: number; takenAt: string | null; lastModified: number }
export interface Album { id: string; name: string; createdAt: number; updatedAt: number; lastFileSaveAt: number | null; settings: AlbumSettings; photos: PhotoMeta[]; spreads: Spread[] }
export interface CellRef { spreadId: string; cellIndex: number }
export interface GutterRef { side: 'spread' | 'left' | 'right'; path: number[]; index: number }
export const DEFAULT_SETTINGS: AlbumSettings; // gapMm 6, marginMm 0, background '#f4efe6', bleedMm 3, safeMm 10, showGuides true, bookStart 'full-spread', pageExport 'bleed'
export const EMPTY_CROP: Crop; // { cx: 0.5, cy: 0.5, zoom: 1 }
```

Model functions (Phase 1):

```ts
// src/model/templates.ts
export const TEMPLATES: { id: TemplateId; name: string; note: string; mine: boolean }[];
export function templateLayout(id: TemplateId): SpreadLayout;
export function cellCount(layout: SpreadLayout): number;
// src/model/layout.ts — canvas coordinates: origin at the top-left of the bleed area
export function cellRects(layout: SpreadLayout, s: AlbumSettings): Rect[];
export function gutters(layout: SpreadLayout, s: AlbumSettings): { ref: GutterRef; orientation: 'v' | 'h'; rect: Rect }[];
export function moveGutter(layout: SpreadLayout, ref: GutterRef, deltaMm: number, s: AlbumSettings): SpreadLayout;
export function guides(s: AlbumSettings): { trim: Rect; safeLeft: Rect; safeRight: Rect; foldX: number };
// src/model/crop.ts
export const LOW_DPI = 200;
export function sourceRect(photoW: number, photoH: number, cell: Rect, crop: Crop): { sx: number; sy: number; sw: number; sh: number };
export function clampCrop(photoW: number, photoH: number, cell: Rect, crop: Crop): Crop;
export function panCrop(photoW: number, photoH: number, cell: Rect, crop: Crop, dxMm: number, dyMm: number): Crop;
export function zoomCrop(photoW: number, photoH: number, cell: Rect, crop: Crop, zoom: number): Crop;
export function effectiveDpi(photoW: number, photoH: number, cell: Rect, crop: Crop): number;
// src/model/album.ts — pure; each returns a new Album with a new updatedAt
export function newId(): string;
export function createAlbum(name: string, id?: string): Album;
export function addPhotos(a: Album, metas: PhotoMeta[]): Album;
export function removePhoto(a: Album, photoId: string): Album;
export function placePhoto(a: Album, ref: CellRef, photoId: string): Album;
export function swapCells(a: Album, from: CellRef, to: CellRef): Album;
export function clearCell(a: Album, ref: CellRef): Album;
export function setCrop(a: Album, ref: CellRef, crop: Crop): Album;
export function applyTemplate(a: Album, spreadId: string, templateId: TemplateId): Album;
export function moveGutterOp(a: Album, spreadId: string, ref: GutterRef, deltaMm: number): Album;
export function addSpread(a: Album, afterIndex: number): Album;
export function removeSpread(a: Album, spreadId: string): Album;
export function moveSpread(a: Album, from: number, to: number): Album;
export function renameAlbum(a: Album, name: string): Album;
export function updateSettings(a: Album, patch: Partial<AlbumSettings>): Album;
export function photoUsage(a: Album): Map<string, number>;
// src/model/pages.ts
export type Side = 'left' | 'right';
export function printedPages(a: Album): { page: number; spreadId: string; side: Side }[];
export function sideIsPrinted(a: Album, spreadId: string, side: Side): boolean;
export function cellSides(rect: Rect, bleedMm: number): Side[];
export type PrintWarning =
  | { kind: 'min-pages'; pages: number }
  | { kind: 'low-dpi'; ref: CellRef; dpi: number }
  | { kind: 'empty-cell'; ref: CellRef }
  | { kind: 'unprinted-photo'; ref: CellRef }
  | { kind: 'missing-photo'; photoId: string };
export function printWarnings(a: Album, available: Set<string>): PrintWarning[];
```

State and storage (Phase 2):

```ts
// src/state/store.ts
export interface AlbumStore {
  album: ReadonlySignal<Album>; canUndo: ReadonlySignal<boolean>; canRedo: ReadonlySignal<boolean>;
  dispatch(op: (a: Album) => Album, opts?: { coalesce?: string }): void;
  undo(): void; redo(): void;
  replace(a: Album): void;                       // no history entry
  subscribe(fn: (a: Album) => void): () => void;  // fires after every change, undo and redo included
}
export function createAlbumStore(initial: Album): AlbumStore;
// src/storage/db.ts — database 'album-builder', version 1, stores 'albums', 'previews', 'handles'
export function saveAlbum(a: Album): Promise<void>;
export function loadAlbum(id: string): Promise<Album | undefined>;
export function listAlbums(): Promise<{ id: string; name: string; updatedAt: number }[]>; // newest first
export function deleteAlbum(id: string): Promise<void>; // also its previews and handle
export function putPreview(photoId: string, kind: 'full' | 'thumb', blob: Blob): Promise<void>;
export function getPreview(photoId: string, kind: 'full' | 'thumb'): Promise<Blob | undefined>;
export function hasPreviews(ids: string[]): Promise<Set<string>>;
export function putDirHandle(albumId: string, h: FileSystemDirectoryHandle): Promise<void>;
export function getDirHandle(albumId: string): Promise<FileSystemDirectoryHandle | undefined>;
export function requestPersistence(): Promise<boolean>;
// src/storage/autosave.ts
export function createAutosaver(save: (a: Album) => Promise<void>, delayMs?: number): { schedule(a: Album): void; flush(): Promise<void>; onError(cb: (e: unknown) => void): void; dispose(): void };
// src/storage/layoutFile.ts — file: { format: 'album-builder', version: 1, album }
export class LayoutFileError extends Error {}
export function serializeLayout(a: Album): string;
export function parseLayout(text: string): Album;
export function saveLayoutFile(a: Album): Promise<number>; // returns the save time
export function openLayoutFile(): Promise<Album>;
```

Photos (Phase 3):

```ts
// src/photos/import.ts
export function isAccepted(name: string): boolean;
export function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]>;
export function pickFolder(): Promise<{ dir: FileSystemDirectoryHandle; files: File[] } | null>;
export function pickFiles(): Promise<File[]>;
export function importFiles(files: File[], onProgress: (done: number, total: number) => void, ids?: Map<File, string>): Promise<{ metas: PhotoMeta[]; skipped: string[] }>;
// src/photos/originals.ts
export function registerOriginals(files: Map<string, File>): void;
export function getOriginal(albumId: string, meta: PhotoMeta): Promise<File | null>;
// src/photos/match.ts
export interface Candidate { name: string; size: number; width: number; height: number; takenAt: string | null }
export function matchPhotos(wanted: PhotoMeta[], candidates: Candidate[]): { matched: Map<string, number>; missing: string[]; ambiguous: string[] };
```

Export (Phase 7):

```ts
// src/export/jpeg.ts
export function setJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array;
// src/export/export.ts
export interface ExportJob { file: string; spreadId: string; regionMm: Rect; px: { w: number; h: number } }
export function exportPlan(a: Album): ExportJob[];
export class MissingOriginalsError extends Error { photoIds: string[] }
export function runExport(a: Album, onProgress: (done: number, total: number) => void): Promise<void>;
// src/export/render.ts
export function renderRegion(a: Album, spread: Spread, regionMm: Rect, px: { w: number; h: number }, load: (meta: PhotoMeta) => Promise<ImageBitmap>): Promise<Blob>;
```

Interface conventions (Phases 4–8): every string the user sees lives in `src/ui/strings.ts`. Test ids are kebab-case: `photo-panel`, `spread-view`, `template-panel`, `spread-strip`; cells `cell-<spreadIndex>-<cellIndex>`; photos `photo-<file name>`; strip items `strip-<index>`. In development builds only, `window.__store` holds the open album's `AlbumStore` for end-to-end tests.

## Decision Log

- **Framework.** Preact with `@preact/signals`, Vite, TypeScript strict. Rejected: React (larger bundle for a phone PWA), no framework (the panels share much state).
- **Model in millimetres, pure functions.** All geometry and album rules are pure and unit-tested. The interface only renders `cellRects` and dispatches operations. Pixels appear only in export.
- **Canvas coordinates include the bleed.** A cell edge that lies on the trim edge extends outward to the canvas edge. So the editor, the crop and the export use one rectangle per cell.
- **Templates as split trees.** Each spread keeps its own copy of the layout tree, so a border drag changes only that spread. The fold gap between two page trees is not a border.
- **Book start keeps the layout.** The editor always shows printed spreads. With `single-right`, the first spread's left half and the last spread's right half show as not printed. Photos there stay in their cells and cause an `unprinted-photo` warning.
- **One photo may be in several cells.** The photo column shows the use count.
- **Cell interaction.** A click or tap selects a cell. A drag of a photo moves it (swap or clear). A double-click or double-tap starts crop mode, where a drag pans, the wheel or a pinch zooms, and Escape ends it.
- **Drag and drop is pointer-based.** HTML5 drag and drop does not work on touch. On touch, a drag starts after a 250 ms press without movement, so the photo column can still scroll.
- **Screen copies.** On import, the app makes a 1600 px and a 320 px JPEG (quality 0.85) of each photo and keeps them in IndexedDB. Originals stay on disk. Import decodes at most 2 photos at the same time.
- **IndexedDB keeps screen copies as bytes, not as Blob.** IndexedDB keeps each screen copy as `{ type, bytes }`, where `bytes` is an `ArrayBuffer`. `getPreview` makes the `Blob` again. Reason: the WebKit build that Playwright uses for the mobile-webkit project cannot store a `Blob` in IndexedDB (the `put` fails), but it stores an `ArrayBuffer`. All browsers store an `ArrayBuffer`. The signatures of `putPreview` and `getPreview` do not change. Phase 3 makes this change in `src/storage/db.ts`, because Phase 3 is the first phase that writes screen copies in a browser.
- **Matching ladder.** Name and size; then name and pixel size; then name stem and aspect ratio (and capture date when both have one); then capture date and aspect ratio. A level accepts only unique pairs. A photo with two or more candidates goes to manual choice.
- **Export renders regions.** Each output file renders its own region of the spread, so a page needs a 3614×3614 canvas, not a 7157×3614 one. JPEG quality 0.95. The JFIF header is patched to 300 dpi.
- **Assumption for Q-2.** "Fast" means: on a computer, an album with 60 photos shows all thumbnails within 2 s after it opens. The user gave no number.
- **Publication needs the user.** Phase 8 writes the GitHub Pages workflow and proves the production build. Creating the GitHub repository and pushing happen only after the user names the repository and agrees.
- **Export continues on a new click after the originals.** When the export needs the original files, the user chooses them and the app matches them. Then the dialog shows the button "Продовжити експорт". The export starts again only on that click. Reason: Chrome opens the folder picker only within about 5 s of a user click. The file dialog and the decode of the chosen files can take longer than that. The user decided this in Phase 7.
- **A phone is a touch screen narrower than 900 px.** The export dialog treats the device as a phone when two conditions are true. `(pointer: coarse)` matches, and the viewport is narrower than 900 px. Only then does it show the note of R-36 and only the pages option. A narrow window on a computer with a mouse can export spreads. The user decided this in Phase 7.
- **The Playwright `expect` timeout is 15 s.** An import of 9 photos in WebKit takes about 1.4 s when one test runs. It takes 4.7 s to 6.5 s when 8 tests run at the same time (measured in Phase 8). The default `expect` timeout of 5 s then fails the test gate at random on mobile-webkit. `playwright.config.ts` sets `expect: { timeout: 15_000 }`. An `expect` waits for a condition, so a fast test does not become slower. The user decided this in Phase 8.

## Phases

### Phase 1: Album model

**Satisfies:** R-2, R-3, R-14, R-15, R-16, R-17, R-18, R-19, R-20, R-21, R-22, R-29, R-30, R-37

**Goal:** All album rules exist as pure, unit-tested TypeScript: the 12 templates, cell geometry with bleed, border moves, crop math, album operations, page mapping and print warnings.

**Files:**
- `src/model/types.ts` (new)
- `src/model/templates.ts` (new)
- `src/model/layout.ts` (new)
- `src/model/crop.ts` (new)
- `src/model/album.ts` (new)
- `src/model/pages.ts` (new)
- `tests/unit/layout.test.ts` (new)
- `tests/unit/crop.test.ts` (new)
- `tests/unit/album.test.ts` (new)
- `tests/unit/pages.test.ts` (new)

**Steps:**
1. Write `types.ts` with the shared types and defaults of *Changed Contracts*.
2. Write `templates.ts`. Copy the `T` array of `.superpowers/brainstorm/1839-1793216938/content/templates-v2.html` verbatim as the source: `w` is a column size, `r` are row sizes, a column with one row is a cell, a page with one column is that column. `pad: 35` becomes `padMm: 35`.
3. Write `layout.ts`. Spread mode area `[m, 600−m] × [m, 300−m]`. Pages mode: left `[m, 300−g/2]`, right `[300+g/2, 600−m]`. With `padMm = p`: left `[p, 300−p]`, right `[300+p, 600−p]`, vertical `[p, 300−p]`. A node splits its extent minus `g·(n−1)` by `sizes`. Then shift by `bleedMm` and extend each edge that lies on a trim edge out to the canvas edge. `moveGutter` keeps the sum of the two sizes and keeps both trim extents at 20 mm or more.
4. Write `crop.ts`: `sw = min(photoW, photoH·a) / zoom`, `sh = sw / a` with `a = cell.w / cell.h`, centred at `(cx·photoW, cy·photoH)`, kept inside the photo. `effectiveDpi = sw / (cell.w / 25.4)`.
5. Write `album.ts`. `createAlbum` gives 1 cover and 15 spreads on `full`. `addPhotos` sorts by name with `localeCompare(…, undefined, { numeric: true })`. `applyTemplate` moves the old photos in cell order into the new cells with `EMPTY_CROP`. The cover cannot be deleted or moved.
6. Write `pages.ts`. `full-spread`: each non-cover spread gives a left and a right page. `single-right`: the first gives only right, the last only left. `min-pages` below 24 pages.
7. Write the four unit test files.

**Completion Criterion:** `npx vitest run tests/unit/layout.test.ts tests/unit/crop.test.ts tests/unit/album.test.ts tests/unit/pages.test.ts` exits 0 and these cases are in the tests:
- `cellRects(templateLayout('full'), DEFAULT_SETTINGS)` equals `[{x:0,y:0,w:606,h:306}]`.
- `two` gives `[{x:0,y:0,w:300,h:306},{x:306,y:0,w:300,h:306}]`.
- `mat` gives `[{x:38,y:38,w:230,h:230},{x:338,y:38,w:230,h:230}]`.
- `full` with `marginMm: 10` gives `[{x:13,y:13,w:580,h:280}]`.
- The cell counts in `TEMPLATES` order are `[1,2,6,6,3,3,5,3,4,8,2,1]`.
- `gutters` gives 0 for `two` and 6 for `g8`. A `moveGutter` of −1000 mm on `row3` leaves the first cell 23 mm wide (20 mm trim + 3 mm bleed).
- `effectiveDpi(6000, 4000, {x:0,y:0,w:606,h:306}, EMPTY_CROP)` is 251.5 ± 0.1, and with zoom 2 it is 125.7 ± 0.1.
- `applyTemplate` from `g8` with 8 photos to `p12` keeps the first 3, in order.
- The default album gives 30 printed pages, and `single-right` gives 28. 11 spreads give `{kind:'min-pages', pages:22}`.
- A switch of `bookStart` and back leaves every cell unchanged.

The gates in `.devflow/project.md` pass.

### Phase 2: Undoable store and persistence

**Depends on:** Phase 1

**Satisfies:** R-4, R-24, R-25, R-26, R-41

**Goal:** Album changes go through an undoable store. IndexedDB stores albums and previews. Each change is saved automatically and survives an immediate tab close. A layout file can be written and read back.

**Files:**
- `src/state/store.ts` (new)
- `src/storage/db.ts` (new)
- `src/storage/autosave.ts` (new)
- `src/storage/layoutFile.ts` (new)
- `tests/unit/store.test.ts` (new)
- `tests/unit/storage.test.ts` (new)

**Steps:**
1. Write `store.ts` with history depth 100. Consecutive dispatches with the same `coalesce` key replace the top entry. An op that returns the same object makes no entry.
2. Write `db.ts` with the `idb` package, in the shape of *Changed Contracts*.
3. Write `autosave.ts`: debounce 300 ms, `flush` on `pagehide` and on `visibilitychange` to hidden, errors to `onError`, and the next `schedule` tries again.
4. Write `layoutFile.ts`: `showSaveFilePicker` / `showOpenFilePicker` when present, otherwise a download and a file input. `parseLayout` throws `LayoutFileError` for bad JSON, a wrong `format` or an unknown `version`.
5. Write the unit tests with `fake-indexeddb/auto` and fake timers.

**Completion Criterion:** `npx vitest run tests/unit/store.test.ts tests/unit/storage.test.ts` exits 0 and these cases are in the tests:
- Undo and redo work as a round trip. Five coalesced dispatches undo in one step. After 150 dispatches, only 100 undos are possible.
- A save, list and load round trip works. `deleteAlbum` also deletes the previews of its photos.
- Three `schedule` calls within 300 ms save once, with the last album.
- After `schedule`, a `pagehide` event saves before the timers advance.
- A rejected save reaches `onError`.
- `parseLayout(serializeLayout(a))` deep-equals `a`, and `parseLayout('{"format":"x"}')` throws `LayoutFileError`.

The gates pass.

### Phase 3: Photo import and matching

**Depends on:** Phase 1, Phase 2

**Satisfies:** R-8, R-9, R-27, R-28, R-44

**Goal:** Photos import from a folder or from files, with oriented dimensions, capture date and two screen copies in IndexedDB. Originals can be found again for export. Photos from another device match by the ladder of the *Decision Log*.

**Files:**
- `src/photos/import.ts` (new)
- `src/photos/originals.ts` (new)
- `src/photos/match.ts` (new)
- `src/harness.ts` (new)
- `src/main.tsx` (modify)
- `src/storage/db.ts` (modify)
- `tests/unit/import.test.ts` (new)
- `tests/unit/match.test.ts` (new)
- `tests/e2e/import.spec.ts` (new)

**Steps:**
1. Write `import.ts`. `importFiles` filters with `isAccepted`. It runs `mapLimit(files, 2, …)` with `createImageBitmap(file, { imageOrientation: 'from-image' })` and reads `DateTimeOriginal` with `exifr`. It writes the `full` (1600 px) and `thumb` (320 px) JPEG 0.85 previews and closes each bitmap. When `ids` maps a file to an existing photo id, it keeps that id.
2. Write `originals.ts`: a memory map first, then the stored folder handle (`queryPermission` / `requestPermission({ mode: 'read' })`), matched by name and size.
3. Write `match.ts` with the ladder of the *Decision Log*.
4. Write `harness.ts`, loaded by `main.tsx` only when `import.meta.env.DEV` and `?harness=import`. It exposes `window.__importFiles` for the end-to-end test.
5. In `db.ts`, store each screen copy as `{ type, bytes }` with `bytes` an `ArrayBuffer`. Make the `Blob` again in `getPreview`. The *Decision Log* entry "IndexedDB keeps screen copies as bytes" gives the reason. The signatures do not change.
6. Write the tests.

**Completion Criterion:** `npx vitest run tests/unit/import.test.ts tests/unit/match.test.ts` and `npx playwright test tests/e2e/import.spec.ts` exit 0 and these cases are in the tests:
- `isAccepted('A.JPG')` is true. `isAccepted('notes.txt')` and `isAccepted('x.heic')` are false.
- `mapLimit` with limit 2 never runs more than 2 at the same time and keeps the input order.
- `rot6.jpg` imports as 1200×1800 with `takenAt` `2026-06-14T15:30:00`. `notes.txt` is in `skipped`. Each imported photo has a `full` and a `thumb` preview.
- `IMG_1.HEIC` 4032×3024 matches `IMG_1.jpg` 2016×1512.
- A renamed file with the same capture date and ratio matches.
- Two wanted `IMG_0001.jpg` (sizes 100 and 200) match the candidates of the same sizes, in either order. Two equal candidates for one photo give `ambiguous`.
- The Playwright test records network requests and finds none to another origin.

The gates pass.

### Phase 4: App shell and spread view

**Depends on:** Phase 1, Phase 2, Phase 3

**Satisfies:** R-1, R-4, R-5, R-6, R-7, R-18, R-19, R-23

**Goal:** The app opens on the album list, opens an album into the editor frame (variant A on a computer, tabs on a phone), and shows the current spread with photos, guides, not-printed halves and draggable borders. Every change autosaves.

**Files:**
- `src/ui/strings.ts` (new)
- `src/ui/App.tsx` (new)
- `src/ui/AlbumList.tsx` (new)
- `src/ui/Editor.tsx` (new)
- `src/ui/SpreadView.tsx` (new)
- `src/ui/previews.ts` (new)
- `src/ui/styles.css` (new)
- `src/main.tsx` (modify)
- `tests/e2e/shell.spec.ts` (new)
- `tests/e2e/spread.spec.ts` (new)

**Steps:**
1. Write `strings.ts` with one exported `strings` object. Later phases add their keys.
2. Write `App.tsx`. The start screen is `AlbumList`. Opening an album creates a store, connects `store.subscribe` to an autosaver, calls `requestPersistence()`, and keeps the album id in `localStorage['lastAlbumId']` to reopen it.
3. Write `AlbumList.tsx`: create (default name "Новий альбом"), open, rename, delete with a confirmation.
4. Write `Editor.tsx`. At 900 px and wider: `photo-panel` left, `spread-view` centre, `template-panel` right, `spread-strip` bottom, top bar with name, undo, redo and buttons that later phases connect. Below 900 px: top bar with `‹ n / N ›`, the spread at full width, tabs "Фото / Шаблони / Розвороти". Keys Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y.
5. Write `previews.ts` with `usePreviewUrl(photoId, kind)`, a shared object-URL cache.
6. Write `SpreadView.tsx`. It draws cells from `cellRects` with the `full` preview placed by `sourceRect`, the background colour, and guides when `showGuides`: bleed area shaded, safe-zone rectangles (`guide-safe`), fold line (`guide-fold`). It greys a side that `sideIsPrinted` says is not printed and labels it. Border hit areas are 12 CSS px or wider and dispatch `moveGutterOp` with `coalesce: 'gutter'`. Clicks select cells.

**Completion Criterion:** `npx playwright test tests/e2e/shell.spec.ts tests/e2e/spread.spec.ts` exits 0 on both projects and these cases are in the tests:
- A created album is in the list after reload, and a rename stays after reload.
- After reload, the last opened album opens.
- The desktop project sees `photo-panel`, `spread-view`, `template-panel` and `spread-strip` at the same time.
- The mobile project sees `spread-view` and the three tabs, and the tab "Шаблони" shows `template-panel`.
- On `row3`, a drag of the first border 60 CSS px to the right makes cell 0 wider and leaves cell 2 unchanged. One Ctrl+Z restores the widths. The drag survives a reload.
- On `two`, no border handle exists.
- 2 `guide-safe` and 1 `guide-fold` are visible by default, and none with `showGuides: false`.

The gates pass.

### Phase 5: Editing interactions

**Depends on:** Phase 4

**Satisfies:** R-10, R-11, R-12, R-13, R-14, R-15, R-21, R-22, R-29

**Goal:** The user adds photos, drags or taps them into cells, swaps and clears cells, applies templates, crops inside cells, and manages spreads in the strip.

**Files:**
- `src/ui/dnd.ts` (new)
- `src/ui/PhotoPanel.tsx` (new)
- `src/ui/TemplatePanel.tsx` (new)
- `src/ui/SpreadStrip.tsx` (new)
- `src/ui/CellToolbar.tsx` (new)
- `src/ui/SpreadView.tsx` (modify)
- `src/ui/Editor.tsx` (modify)
- `src/ui/strings.ts` (modify)
- `src/ui/styles.css` (modify)
- `tests/e2e/dnd.spec.ts` (new)
- `tests/e2e/crop.spec.ts` (new)

**Steps:**
1. Write `dnd.ts`: `startDrag`, `registerDropTarget`, the `drop-hover` class, the touch long-press rule of the *Decision Log*, and `armedPhoto` for tap-to-place.
2. Write `PhotoPanel.tsx`: "Додати папку" (only when `pickFolder` exists) and "Додати фото", import progress, a closable list of skipped files, the counter "використано X / Y", thumbnails in name order, a check mark and use count for used photos, and "Прибрати з альбому".
3. Write `TemplatePanel.tsx`: 12 miniatures drawn with `cellRects` at the current settings, the badge "ваш приклад" for `mine`, a click applies to the current spread, the current template is marked.
4. Write `SpreadStrip.tsx`: miniatures, "Обкладинка" for the cover, select by click, reorder by drag (cover fixed), "+" adds after the current spread, delete with a confirmation.
5. Connect drops: photo to cell = `placePhoto`; cell to cell = `swapCells`; cell to photo column = `clearCell`.
6. Write `CellToolbar.tsx` and crop mode as in the *Decision Log*: zoom slider 1–8, "Кадрувати", "Прибрати фото". Pans and zooms dispatch with `coalesce: 'crop'`. A cell under `LOW_DPI` shows a warning icon with the dpi value.

**Completion Criterion:** `npx playwright test tests/e2e/dnd.spec.ts tests/e2e/crop.spec.ts` exits 0 on both projects and these cases are in the tests:
- 9 fixtures imported show "використано 0 / 9". A drag of `land-1.jpg` onto `cell-1-0` shows it there and "використано 1 / 9".
- On `two`, a drag of cell 0 onto cell 1 swaps them. A drag of a cell onto the photo column empties it.
- Mobile: tap `photo-land-2.jpg`, then tap `cell-1-0`: the photo is placed.
- A placement survives a reload.
- A click on template `g8` gives 8 cells with the earlier photo in cell 0.
- "+" makes 17 strip items. A strip drag reorders, and the cover stays first.
- `land-1.jpg` on `full` shows the low-dpi icon (about 75 dpi).
- In crop mode, a drag of 100 px to the left gives `cx > 0.5` (read from `window.__store`), and one Ctrl+Z restores it. Wheel zoom never goes below 1.

The gates pass.

### Phase 6: Settings and preview

**Depends on:** Phase 5

**Satisfies:** R-16, R-17, R-23, R-30, R-38

**Goal:** A settings dialog changes all album settings live, and a full-screen preview shows the album without guides and bleed.

**Files:**
- `src/ui/SettingsDialog.tsx` (new)
- `src/ui/PreviewMode.tsx` (new)
- `src/ui/Editor.tsx` (modify)
- `src/ui/strings.ts` (modify)
- `src/ui/styles.css` (modify)
- `tests/e2e/settings.spec.ts` (new)

**Steps:**
1. Write `SettingsDialog.tsx` with: проміжок 0–20 мм, поле від краю 0–30 мм, тло (3 colours), виліт 0–5 мм, безпечна зона 0–20 мм, показувати напрямні, початок книги (the two values of R-30), сторінки для експорту ("З вильотом, 3614×3614 px" / "Без вильоту, 3543×3543 px"). Each field dispatches `updateSettings` with `coalesce: 'settings:<field>'`.
2. Write `PreviewMode.tsx`: full screen, trim area only, no guides, one spread at a time, arrow buttons, arrow keys, swipe, Escape closes. A not-printed side shows as blank paper.
3. Connect both to buttons in the `Editor` top bar.

**Completion Criterion:** `npx playwright test tests/e2e/settings.spec.ts` exits 0 on both projects and these cases are in the tests:
- On `two`, a gap of 12 mm gives cells 12 mm apart (from `cellRects` through `window.__store`, and the screen distance is consistent).
- The margin setting does not change `mat`.
- After "Сторінка 1 — окрема права сторінка", the left half of spread 1 shows the not-printed label, and after a switch back every photo is still in its cell.
- In preview, ArrowRight shows the next spread, and no guide element exists.

The gates pass.

### Phase 7: Print export

**Depends on:** Phase 1, Phase 3, Phase 5

**Satisfies:** R-31, R-32, R-33, R-34, R-35, R-36, R-37

**Goal:** The export writes print-ready JPG files for all spreads and pages into a chosen folder or a ZIP, after it shows the print warnings.

**Files:**
- `src/export/jpeg.ts` (new)
- `src/export/export.ts` (new)
- `src/export/render.ts` (new)
- `src/ui/ExportDialog.tsx` (new)
- `src/ui/Editor.tsx` (modify)
- `src/ui/strings.ts` (modify)
- `tests/unit/jpeg.test.ts` (new)
- `tests/unit/exportPlan.test.ts` (new)
- `tests/e2e/export.spec.ts` (new)

**Steps:**
1. Write `setJpegDpi`: with an APP0 JFIF segment, set units to 1 and both densities to the dpi. Without one, insert a JFIF APP0 after SOI.
2. Write `exportPlan`. For each non-cover spread n: `spreads/spread-NN.jpg`, region = whole canvas. For each `printedPages` entry: `pages/page-NNN.jpg`. With `bleed`, the left region is `{x:0, y:0, w:300+2b, h:300+2b}` and the right is `{x:300, …}`. With `trim`, the left is `{x:b, y:b, w:300, h:300}` and the right is `{x:300+b, …}`. Pixel sizes from `mmToPx`.
3. Write `renderRegion` with `OffscreenCanvas` (fallback `HTMLCanvasElement`): background, then each filled cell clipped to its rectangle and drawn with `sourceRect`, JPEG 0.95, then `setJpegDpi(…, 300)`. Close each bitmap after use.
4. Write `runExport`: get originals with `getOriginal`, throw `MissingOriginalsError` when some are missing, write into `showDirectoryPicker({ mode: 'readwrite' })` / `export-<album name>/` when available, else a ZIP with `fflate`. Render one job at a time.
5. Write `ExportDialog.tsx`: the `printWarnings` list, file counts, start, progress. On a phone (see the *Decision Log*), the note of R-36 and only the pages option. On `MissingOriginalsError`, ask the user to choose the originals, match them with `matchPhotos`, and register them. Then show "Продовжити експорт", and continue on that click (see the *Decision Log*).

**Completion Criterion:** `npx vitest run tests/unit/jpeg.test.ts tests/unit/exportPlan.test.ts` and `npx playwright test tests/e2e/export.spec.ts --project desktop-chromium` exit 0 and these cases are in the tests:
- `setJpegDpi` on a JFIF header sets bytes 13–17 to `01 01 2C 01 2C`. Without APP0, it inserts one (+18 bytes).
- The default album gives 15 spread jobs and 30 page jobs. `page-001` has region `{x:0,y:0,w:306,h:306}` and 3614×3614 px. `trim` gives 3543×3543. `single-right` gives 28 page jobs, and `page-001` is the right side of spread 1. No job uses the cover.
- The ZIP path (with `showDirectoryPicker` removed) has `spreads/spread-01.jpg` of 7157×3614 px and `pages/page-001.jpg` of 3614×3614 px.
- `rot6.jpg` on spread 1 exports upright: the arrow colour is above the label, not beside it.
- After a reload, the export asks for originals, and after the fixtures are chosen it completes.

The gates pass.

### Phase 8: Relinking, safety banners, PWA and publishing workflow

**Depends on:** Phase 2, Phase 3, Phase 5, Phase 7

**Satisfies:** R-27, R-39, R-40, R-41, R-42, R-43, R-44

**Goal:** A layout opens on another device and its photos can be found again in the interface. The banners protect against data loss. The app installs as a PWA, works offline, and has a GitHub Pages workflow.

**Files:**
- `src/ui/RelinkDialog.tsx` (new)
- `src/ui/Banners.tsx` (new)
- `src/ui/Editor.tsx` (modify)
- `src/ui/App.tsx` (modify)
- `src/ui/SpreadView.tsx` (modify)
- `src/ui/PhotoPanel.tsx` (modify)
- `src/ui/strings.ts` (modify)
- `src/ui/previews.ts` (modify)
- `src/ui/AlbumList.tsx` (modify)
- `src/ui/styles.css` (modify)
- `src/photos/import.ts` (modify)
- `src/ui/ExportDialog.tsx` (modify)
- `playwright.config.ts` (modify)
- `vite.config.ts` (modify)
- `public/icon-192.png` (new)
- `public/icon-512.png` (new)
- `.github/workflows/pages.yml` (new)
- `README.md` (new)
- `tests/e2e/relink.spec.ts` (new)
- `tests/e2e/pwa.spec.ts` (new)

**Steps:**
1. Opening a layout file: a new album id is stored. An existing id first asks "Замінити наявний альбом?". Photos without previews are missing.
2. Write `RelinkDialog.tsx`: the user chooses files or a folder, `matchPhotos` runs, matched files import under the existing photo ids, `registerOriginals` runs. Ambiguous and missing photos show name, size and date, with a manual choice or skip for each.
3. In `SpreadView.tsx`, a missing photo shows a grey box with its file name and "Знайти фото".
4. Write `Banners.tsx`: (1) storage error from the autosaver `onError`, with "Зберегти у файл"; (2) iPhone Safari not in standalone mode, closable, remembered in `localStorage`; (3) no file save for more than 3 days and changes after it, with "Зберегти у файл"; (4) a short print warnings summary. A file save writes `lastFileSaveAt` with `store.replace`.
5. Configure `vite-plugin-pwa`: name "Конструктор альбому", short name "Альбом", `display: 'standalone'`, `theme_color: '#f4efe6'`, `registerType: 'autoUpdate'`, offline app shell. `base` stays `process.env.BASE_PATH ?? '/'`.
6. Write `.github/workflows/pages.yml`: Node 24, `npm ci`, `npm test`, build with `BASE_PATH=/${{ github.event.repository.name }}/`, `actions/upload-pages-artifact`, `actions/deploy-pages`.
7. Write `README.md` (STE-flavored): what the tool is, how to run it, how to deploy it, the Gramofon notes.

**Completion Criterion:** `npx playwright test tests/e2e/relink.spec.ts tests/e2e/pwa.spec.ts` exits 0 and these cases are in the tests:
- Save a layout file, clear IndexedDB, open the file: the spreads come back, and the cells show grey boxes with file names. A relink with the `land-*` fixtures shows the photos.
- `dup-a/IMG_0001.jpg` and `dup-b/IMG_0001.jpg` relink to the right cells (checked by preview colour).
- With `IDBObjectStore.prototype.put` made to throw `QuotaExceededError`, an edit shows the storage error banner with "Зберегти у файл".
- With the clock 4 days after an edit, the backup banner shows.
- On the mobile-webkit project with an iPhone user agent, the home-screen banner shows, and after close and reload it does not show.
- The production build served by `vite preview` registers a service worker and opens offline after one online visit.

`npm run build` with `BASE_PATH=/album-builder/` exits 0. The gates pass. Creating the GitHub repository and the first deployment are not part of this phase: they wait for the user to name the repository.

## Edge Cases

| Brief id | Handled in | How |
|---|---|---|
| E-1 | Phase 3, Phase 7 | `imageOrientation: 'from-image'` in import and export. `rot6.jpg` tests in both phases |
| E-2 | Phase 3, Phase 8 | matching ladder accepts only unique pairs, so ambiguous photos go to manual choice. Unit test and relink e2e with `dup-a`/`dup-b` |
| E-3 | Phase 3 | `mapLimit` with limit 2, bitmaps closed after use, progress callback. Concurrency unit test |
| E-4 | Phase 3 | `isAccepted('x.heic')` is false, so the file is in `skipped` |
| E-5 | Phase 2, Phase 8 | autosaver `onError`, and the storage error banner. Unit test and e2e with a failing `put` |
| E-6 | Phase 2 | `flush` on `pagehide` and hidden `visibilitychange`. Unit test |
| E-7 | Phase 1, Phase 7 | `printWarnings` gives `empty-cell`. `renderRegion` draws only the background for an empty cell |
| E-8 | Phase 1, Phase 5 | `removePhoto` clears every cell that uses the photo. Unit test, and "Прибрати з альбому" in the photo column |
| E-9 | Phase 8 | the confirmation "Замінити наявний альбом?" before a replace |
| E-10 | Phase 1 | `applyTemplate` keeps extra photos in `photos`. Unit test |
| E-11 | Phase 1, Phase 4 | the 20 mm clamp in `moveGutter`. Unit test |
| E-12 | Phase 1, Phase 5 | `placePhoto` allows repeats, and `photoUsage` drives the use count in the photo column |

## Not Implemented

- Text, captions, stickers, frames and picture backgrounds.
- Cloud sync, accounts and a server.
- Direct ordering in Gramofon or a link to its editor.
- More than one person on one album.
- Album formats other than 30×30 cm Lay Flat (the code does not prevent them, but no format selector exists).
- Export of the cover for print.
- Full-quality export of whole spreads on iPhone. Page export on a phone is offered only if it works.
- Creation of the GitHub repository and the first deployment: they need the user's repository name and agreement.
