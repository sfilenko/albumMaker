# Album Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser-only wedding photo album builder (30×30 cm Lay Flat, ~15 spreads, ~60 photos) with templates, drag-and-drop, editable gutters, cropping, autosave, layout files, and 300 dpi JPG export for Gramofon, usable on desktop and phone.

**Architecture:** Pure TypeScript model (`src/model`) holds all geometry and album operations as immutable functions in millimetres; the UI (`src/ui`, Preact + signals) only renders model output and dispatches operations through an undo-aware store. Persistence (`src/storage`) writes every change to IndexedDB and can round-trip a JSON layout file; photos (`src/photos`) are imported once into small preview blobs, and originals are read again only by the export renderer (`src/export`).

**Tech Stack:** Vite 6, TypeScript 5 (strict), Preact 10 + @preact/signals, idb 8, exifr 7, fflate 0.8, vite-plugin-pwa 0.21; Vitest 3 + jsdom + fake-indexeddb for unit tests; Playwright 1.5x (Chromium + mobile WebKit emulation) for end-to-end tests; piexifjs (dev) for fixtures. Hosting: GitHub Pages via GitHub Actions.

**Spec:** `docs/2026-10-28-album-builder-design.md` (Ukrainian). Template proportions come from the `T` array in `.superpowers/brainstorm/1839-1793216938/content/templates-v2.html`, copied verbatim into Task 2.

## Global Constraints

- All UI text is Ukrainian. Strings live in `src/ui/strings.ts`; no Ukrainian literals elsewhere.
- No server, no network calls at runtime except loading the app itself. Photos never leave the device.
- Album geometry: trim spread 600×300 mm, page 300×300 mm, fold at x = 300 mm (trim coordinates).
- Defaults (`DEFAULT_SETTINGS`): `gapMm: 6`, `marginMm: 0`, `background: '#f4efe6'`, `bleedMm: 3`, `safeMm: 10`, `showGuides: true`, `bookStart: 'full-spread'`, `pageExport: 'bleed'`.
- Background options: `#f4efe6` (слонова кістка), `#ffffff` (біле), `#1d1d1d` (чорне).
- Print resolution 300 dpi; `pxPerMm = 300 / 25.4`; pixel size = `Math.round(mm * pxPerMm)`.
- Export sizes: full spread with bleed 7157×3614 px; page with bleed 3614×3614 px; page at trim 3543×3543 px. JPEG quality 0.95, sRGB, JFIF density 300 dpi.
- New album: 1 cover spread + 15 spreads, all on template `full`. Cover is never exported and never counted in pages.
- Gramofon minimum: 24 printed pages. Low-quality badge below 200 effective dpi.
- Template pad for `mat` and `solo`: 35 mm (overrides `marginMm` and the fold gap).
- Minimum cell size when dragging a gutter: 20 mm.
- Undo history depth: 100 entries.
- Preview blobs: `full` long edge 1600 px, `thumb` long edge 320 px, JPEG 0.85.
- Accepted import types: `.jpg .jpeg .png .webp` (case-insensitive). Others are skipped and listed to the user.
- Layout file: extension `.album.json`, `{ format: 'album-builder', version: 1, album }`.
- Desktop layout (variant A) at viewport width ≥ 900 px; mobile tabs below 900 px.
- Repository root is `D:\personal\Photo\composition`. `.superpowers/`, `.playwright-mcp/`, `node_modules/`, `dist/`, `test-results/` are git-ignored.

## Review Focus

1. **Tab closed right after an edit** (phone browser killed, laptop lid shut): the last change must already be in IndexedDB. Test in Task 7 (`flushes on pagehide`).
2. **IndexedDB unavailable or quota exceeded** (private mode, full disk): the user must see a visible error and a "save to file" action, never a silent loss. Tests in Task 7 (`reports save errors`) and Task 16 (`shows storage error banner`).
3. **Two different photos with the same file name** (IMG_0001.jpg from two cameras): matching must not swap them; ambiguous ones go to manual relinking. Test in Task 9 (`does not merge same-name photos`).
4. **Portrait photo with EXIF orientation 6**: preview, crop, and export must all show it upright with swapped width/height. Tests in Task 8 (`reads oriented dimensions`) and Task 15 (`exports oriented photo upright`).
5. **Importing 60 large originals at once on a phone**: import must not decode them all in parallel. Test in Task 8 (`mapLimit never exceeds concurrency`).

---

## File Structure

```
index.html
vite.config.ts            Vite + Preact + PWA, base from env BASE_PATH
playwright.config.ts      projects: desktop-chromium (1280×800), mobile-webkit (iPhone 13)
scripts/make-fixtures.mjs generates tests/fixtures/*.jpg
src/main.tsx              mounts <App/>
src/model/types.ts        all shared types + DEFAULT_SETTINGS
src/model/units.ts        mm/px conversions, canvas sizes
src/model/templates.ts    12 templates as SpreadLayout factories
src/model/layout.ts       cell rects, gutters, moveGutter, guides
src/model/crop.ts         cover crop, clamp, effective dpi
src/model/album.ts        pure album operations
src/model/pages.ts        book-start page mapping, print warnings
src/state/store.ts        signals store with undo/redo + autosave hook
src/storage/db.ts         IndexedDB access
src/storage/autosave.ts   debounced saver with flush on pagehide
src/storage/layoutFile.ts serialize/parse/save/open layout file
src/photos/import.ts      pick files/folder, meta, previews, mapLimit
src/photos/originals.ts   access to original files for export
src/photos/match.ts       relinking ladder
src/export/render.ts      draw a region of a spread to a canvas
src/export/jpeg.ts        JFIF dpi patch
src/export/export.ts      export plan, folder/zip writer
src/ui/strings.ts         Ukrainian strings
src/ui/App.tsx            routes: album list ↔ editor
src/ui/AlbumList.tsx
src/ui/Editor.tsx         desktop 3-column / mobile tabs shell
src/ui/PhotoPanel.tsx
src/ui/SpreadView.tsx     cells, gutters, guides, selection
src/ui/CellToolbar.tsx    crop mode, zoom, remove
src/ui/TemplatePanel.tsx
src/ui/SpreadStrip.tsx
src/ui/SettingsDialog.tsx
src/ui/PreviewMode.tsx
src/ui/ExportDialog.tsx
src/ui/RelinkDialog.tsx
src/ui/Banners.tsx        storage error, iOS home-screen hint, backup reminder, print warnings
src/ui/dnd.ts             pointer-based drag controller
src/ui/previews.ts        object-URL cache for preview blobs
src/ui/styles.css
tests/unit/*.test.ts      Vitest
tests/e2e/*.spec.ts       Playwright
.github/workflows/pages.yml
```

---

### Task 1: Project scaffold and units

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `index.html`, `.gitignore`, `src/main.tsx`, `src/model/units.ts`, `tests/unit/units.test.ts`, `scripts/make-fixtures.mjs`, `tests/fixtures/`

**Interfaces:**
- Produces: `PX_PER_MM: number`, `mmToPx(mm: number): number` (rounded), `TRIM_W = 600`, `TRIM_H = 300`, `PAGE_W = 300`, `FOLD_X = 300`, `canvasSizeMm(bleedMm: number): { w: number; h: number }`.
- Produces: npm scripts `dev`, `build`, `test` (vitest run), `e2e` (playwright test), `fixtures`.
- Produces fixtures: `tests/fixtures/land-1.jpg … land-6.jpg` (1800×1200), `port-1.jpg … port-3.jpg` (1200×1800), `rot6.jpg` (stored 1800×1200 with EXIF Orientation 6 and DateTimeOriginal `2026:06:14 15:30:00`), `dup-a/IMG_0001.jpg` and `dup-b/IMG_0001.jpg` (different content and size), `notes.txt`.

- [ ] **Step 1:** `git init`, write `.gitignore` per Global Constraints, `npm create vite@latest . -- --template preact-ts`, then add deps: `@preact/signals idb exifr fflate` and dev deps `vitest jsdom fake-indexeddb @playwright/test vite-plugin-pwa piexifjs`. Run `npx playwright install chromium webkit`.
- [ ] **Step 2: Write the failing test** `tests/unit/units.test.ts`:

```ts
expect(mmToPx(606)).toBe(7157);
expect(mmToPx(306)).toBe(3614);
expect(mmToPx(300)).toBe(3543);
expect(canvasSizeMm(3)).toEqual({ w: 606, h: 306 });
```

- [ ] **Step 3:** Run `npm test` → FAIL (module not found).
- [ ] **Step 4:** Implement `src/model/units.ts`.
- [ ] **Step 5:** Run `npm test` → PASS.
- [ ] **Step 6:** Write `scripts/make-fixtures.mjs`: launch Playwright Chromium, draw each fixture on a canvas (distinct colour + large number label + an arrow pointing up so orientation is checkable), save as JPEG; insert EXIF with piexifjs for `rot6.jpg`. Run `npm run fixtures` → files exist.
- [ ] **Step 7:** `playwright.config.ts`: `webServer: npm run dev -- --port 5199`, projects `desktop-chromium` (1280×800) and `mobile-webkit` (`devices['iPhone 13']`). Write `tests/e2e/smoke.spec.ts` asserting the page title is `Конструктор альбому`. Run `npm run e2e` → PASS on both projects.
- [ ] **Step 8:** Commit `chore: scaffold album builder`.

---

### Task 2: Types, templates, and layout geometry

**Files:**
- Create: `src/model/types.ts`, `src/model/templates.ts`, `src/model/layout.ts`
- Test: `tests/unit/layout.test.ts`

**Interfaces:**
- Consumes: `units.ts`.
- Produces in `types.ts`:

```ts
export interface Rect { x: number; y: number; w: number; h: number } // mm
export type LayoutNode =
  | { kind: 'cell' }
  | { kind: 'cols' | 'rows'; sizes: number[]; children: LayoutNode[] };
export type SpreadLayout =
  | { mode: 'spread'; root: LayoutNode; padMm?: number }
  | { mode: 'pages'; left: LayoutNode | null; right: LayoutNode | null; padMm?: number };
export interface Crop { cx: number; cy: number; zoom: number } // centre of visible area, 0..1; zoom ≥ 1
export interface Cell { photoId: string | null; crop: Crop }
export interface Spread { id: string; templateId: TemplateId; layout: SpreadLayout; cells: Cell[]; isCover: boolean }
export type BookStart = 'full-spread' | 'single-right';
export type PageExport = 'bleed' | 'trim';
export interface AlbumSettings { gapMm: number; marginMm: number; background: string; bleedMm: number; safeMm: number; showGuides: boolean; bookStart: BookStart; pageExport: PageExport }
export interface PhotoMeta { id: string; name: string; size: number; width: number; height: number; takenAt: string | null; lastModified: number }
export interface Album { id: string; name: string; createdAt: number; updatedAt: number; lastFileSaveAt: number | null; settings: AlbumSettings; photos: PhotoMeta[]; spreads: Spread[] }
export type TemplateId = 'full'|'two'|'ex2'|'ex1'|'pano'|'p12'|'p14'|'row3'|'row4'|'g8'|'mat'|'solo';
export interface CellRef { spreadId: string; cellIndex: number }
export interface GutterRef { side: 'spread' | 'left' | 'right'; path: number[]; index: number }
export const DEFAULT_SETTINGS: AlbumSettings; // values from Global Constraints
export const EMPTY_CROP: Crop = { cx: 0.5, cy: 0.5, zoom: 1 };
```

- Produces in `templates.ts`: `TEMPLATES: { id: TemplateId; name: string; note: string; mine: boolean }[]` in the order below, `templateLayout(id: TemplateId): SpreadLayout`, `cellCount(layout: SpreadLayout): number`.
- Produces in `layout.ts`:
  - `cellRects(layout: SpreadLayout, s: AlbumSettings): Rect[]` — canvas coordinates (origin = top-left of bleed area, canvas = `canvasSizeMm(s.bleedMm)`), depth-first cell order (left page before right page).
  - `gutters(layout: SpreadLayout, s: AlbumSettings): { ref: GutterRef; orientation: 'v' | 'h'; rect: Rect }[]` — the gap strip between sibling children.
  - `moveGutter(layout: SpreadLayout, ref: GutterRef, deltaMm: number, s: AlbumSettings): SpreadLayout` — changes `sizes[index]` and `sizes[index+1]`, keeps their sum, clamps so both affected regions stay ≥ 20 mm.
  - `guides(s: AlbumSettings): { trim: Rect; safeLeft: Rect; safeRight: Rect; foldX: number }` in canvas coordinates.

Template source — copy verbatim; `w` = column size, `r` = row sizes; a column with one row is a `cell`, otherwise a `rows` node; a page/spread with one column is that column itself, otherwise a `cols` node:

```js
{ id:'full', name:'Одне фото на весь розворот', note:'Ваш основний варіант. Lay Flat не ховає центр.', mine:true, spread:[{w:1,r:[1]}] },
{ id:'two', name:'По фото на сторінку', note:'Ваш приклад 3: проміжок по згину.', mine:true, L:[{w:1,r:[1]}], R:[{w:1,r:[1]}] },
{ id:'ex2', name:'Велике + 2 / 2 + велике', note:'Ваш приклад 2: 6 фото, дзеркально.', mine:true, L:[{w:1,r:[1]},{w:1.05,r:[1.2,1]}], R:[{w:1.1,r:[0.8,1.2]},{w:1,r:[1]}] },
{ id:'ex1', name:'Мозаїка з 6 фото', note:'Ваш приклад 1: різні висоти рядів.', mine:true, L:[{w:1,r:[1.6,1]},{w:1,r:[1,1.6]}], R:[{w:1,r:[1,1.6]}] },
{ id:'pano', name:'Панорама + два', note:'Велике фото через згин, збоку два.', spread:[{w:2.2,r:[1]},{w:1,r:[1,1]}] },
{ id:'p12', name:'Фото + два', note:'Ліва сторінка ціла, права ділиться навпіл.', L:[{w:1,r:[1]}], R:[{w:1,r:[1,1]}] },
{ id:'p14', name:'Фото + сітка 4', note:'Герой ліворуч, деталі праворуч.', L:[{w:1,r:[1]}], R:[{w:1,r:[1,1]},{w:1,r:[1,1]}] },
{ id:'row3', name:'Три в ряд', note:'Послідовність: перший танець, торт.', spread:[{w:1,r:[1]},{w:1,r:[1]},{w:1,r:[1]}] },
{ id:'row4', name:'Чотири вертикальні', note:'По два вертикальні фото на сторінку.', L:[{w:1,r:[1]},{w:1,r:[1]}], R:[{w:1,r:[1]},{w:1,r:[1]}] },
{ id:'g8', name:'Сітка 2×2 на кожній сторінці', note:'8 фото: деталі, гості.', L:[{w:1,r:[1,1]},{w:1,r:[1,1]}], R:[{w:1,r:[1,1]},{w:1,r:[1,1]}] },
{ id:'mat', name:'Фото з широкими полями', note:'Одне фото на сторінку в рамці з тла.', pad:35, L:[{w:1,r:[1]}], R:[{w:1,r:[1]}] },
{ id:'solo', name:'Одне фото з полями + пуста сторінка', note:'Пауза в альбомі, акцент на одному кадрі.', pad:35, L:[{w:1,r:[1]}], R:[] }
```

Geometry rule (trim coordinates, then shift by `bleedMm`): spread mode area `[m, 600−m]×[m, 300−m]`; pages mode left area `[m, 300−g/2]`, right `[300+g/2, 600−m]`; with `padMm = p` left `[p, 300−p]`, right `[300+p, 600−p]`, vertical `[p, 300−p]`. A node splits its extent minus `g·(n−1)` proportionally to `sizes`. After shifting, any cell edge that lies on a trim edge (|Δ| < 0.001) is extended outward to the canvas edge.

- [ ] **Step 1: Write the failing tests** in `tests/unit/layout.test.ts`:

```ts
const s = DEFAULT_SETTINGS;
test('full fills canvas incl. bleed', () =>
  expect(cellRects(templateLayout('full'), s)).toEqual([{ x: 0, y: 0, w: 606, h: 306 }]));
test('two splits at fold with gap', () =>
  expect(cellRects(templateLayout('two'), s)).toEqual([{ x: 0, y: 0, w: 300, h: 306 }, { x: 306, y: 0, w: 300, h: 306 }]));
test('mat uses 35 mm pad, no bleed extension', () =>
  expect(cellRects(templateLayout('mat'), s)).toEqual([{ x: 38, y: 38, w: 230, h: 230 }, { x: 338, y: 38, w: 230, h: 230 }]));
test('cell counts match spec', () =>
  expect(TEMPLATES.map(t => cellCount(templateLayout(t.id)))).toEqual([1, 2, 6, 6, 3, 3, 5, 3, 4, 8, 2, 1]));
test('margin 10 disables bleed extension', () =>
  expect(cellRects(templateLayout('full'), { ...s, marginMm: 10 })).toEqual([{ x: 13, y: 13, w: 580, h: 280 }]));
test('moveGutter shifts boundary and keeps sum', () => {
  const l = templateLayout('row3'); const g = gutters(l, s)[0];
  const r = cellRects(moveGutter(l, g.ref, 30, s), s);
  expect(r[0].w).toBeCloseTo(cellRects(l, s)[0].w + 30); expect(r[2].w).toBeCloseTo(cellRects(l, s)[2].w);
});
test('moveGutter clamps at 20 mm', () => {
  const l = templateLayout('row3'); const g = gutters(l, s)[0];
  const r = cellRects(moveGutter(l, g.ref, -1000, s), s);
  expect(r[0].w).toBeCloseTo(20 + 3); // 20 mm inside trim + 3 mm bleed extension
});
test('gutters: two has none (fold gap not draggable), g8 has 6', () => {
  expect(gutters(templateLayout('two'), s)).toHaveLength(0);
  expect(gutters(templateLayout('g8'), s)).toHaveLength(6);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/layout.test.ts` → FAIL.
- [ ] **Step 3:** Implement `types.ts`, `templates.ts`, `layout.ts`. The 20 mm clamp measures the trim-space extent of each affected child (before bleed extension).
- [ ] **Step 4:** Run the same command → PASS.
- [ ] **Step 5:** Commit `feat(model): templates and layout geometry`.

---

### Task 3: Crop math

**Files:**
- Create: `src/model/crop.ts`
- Test: `tests/unit/crop.test.ts`

**Interfaces:**
- Produces:
  - `sourceRect(photoW: number, photoH: number, cell: Rect, crop: Crop): { sx: number; sy: number; sw: number; sh: number }` — `sw = min(photoW, photoH·a)/zoom`, `sh = sw/a`, `a = cell.w/cell.h`, centred at `(cx·photoW, cy·photoH)` and shifted to stay inside the photo.
  - `clampCrop(photoW, photoH, cell: Rect, crop: Crop): Crop` — zoom in `[1, 8]`, centre moved so `sourceRect` needs no shift.
  - `panCrop(photoW, photoH, cell: Rect, crop: Crop, dxMm: number, dyMm: number): Crop` — dragging the picture right by `dxMm` moves the visible area left; result clamped.
  - `effectiveDpi(photoW, photoH, cell: Rect, crop: Crop): number` — `sw / (cell.w / 25.4)`.
  - `LOW_DPI = 200`.

- [ ] **Step 1: Write the failing tests:**

```ts
const cell = { x: 0, y: 0, w: 606, h: 306 };
test('cover crop of 3:2 photo in full spread uses full width', () =>
  expect(sourceRect(6000, 4000, cell, EMPTY_CROP)).toEqual({ sx: 0, sy: expect.closeTo(485.15, 1), sw: 6000, sh: expect.closeTo(3029.7, 1) }));
test('effective dpi', () => expect(effectiveDpi(6000, 4000, cell, EMPTY_CROP)).toBeCloseTo(251.5, 0));
test('zoom 2 halves dpi', () => expect(effectiveDpi(6000, 4000, cell, { cx: .5, cy: .5, zoom: 2 })).toBeCloseTo(125.7, 0));
test('clamp keeps area inside photo', () =>
  expect(clampCrop(6000, 4000, cell, { cx: 0, cy: 0, zoom: 1 })).toEqual({ cx: 0.5, cy: expect.closeTo(0.3787, 3), zoom: 1 }));
test('pan right moves visible area left', () => {
  const c = panCrop(6000, 4000, { x: 0, y: 0, w: 100, h: 100 }, { cx: .5, cy: .5, zoom: 1 }, 10, 0);
  expect(c.cx).toBeLessThan(.5);
});
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/crop.test.ts` → FAIL.
- [ ] **Step 3:** Implement `crop.ts`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(model): crop math`.

---

### Task 4: Album operations

**Files:**
- Create: `src/model/album.ts`
- Test: `tests/unit/album.test.ts`

**Interfaces:**
- Consumes: `templateLayout`, `cellCount`, `moveGutter`, `EMPTY_CROP`.
- Produces (all pure; each returns a new `Album` with `updatedAt = now` where `now` is a parameter-free `Date.now()` call inside — tests use `vi.setSystemTime`):
  - `createAlbum(name: string, id?: string): Album` — cover + 15 spreads on `full`, `DEFAULT_SETTINGS`.
  - `addPhotos(a: Album, metas: PhotoMeta[]): Album` — skips ids already present; keeps `photos` sorted by `name` (`localeCompare` with `numeric: true`).
  - `removePhoto(a, photoId): Album` — also clears every cell that shows it.
  - `placePhoto(a, ref: CellRef, photoId: string): Album` — sets photo, crop reset to `EMPTY_CROP`. A photo may appear in several cells.
  - `swapCells(a, from: CellRef, to: CellRef): Album` — swaps `photoId` and `crop`; works across spreads.
  - `clearCell(a, ref): Album`, `setCrop(a, ref, crop: Crop): Album`.
  - `applyTemplate(a, spreadId, templateId: TemplateId): Album` — new layout from template; existing photos (in cell order, skipping empty) fill new cells in order with crop reset; extra photos are dropped from this spread (they remain in `a.photos`).
  - `moveGutterOp(a, spreadId, ref: GutterRef, deltaMm: number): Album`.
  - `addSpread(a, afterIndex: number): Album` (new spread on `full`), `removeSpread(a, spreadId): Album` (cover cannot be removed — returns `a` unchanged), `moveSpread(a, from: number, to: number): Album` (index 0 cover is fixed; indices clamp to ≥ 1).
  - `renameAlbum(a, name): Album`, `updateSettings(a, patch: Partial<AlbumSettings>): Album`.
  - `photoUsage(a): Map<string, number>` — count of cells per photo id.
  - `newId(): string` — `crypto.randomUUID()`.

- [ ] **Step 1: Write the failing tests** (`tests/unit/album.test.ts`):
  - `createAlbum('Весілля').spreads` has length 16, `[0].isCover === true`, every `templateId === 'full'`.
  - `addPhotos` with names `IMG_10.jpg, IMG_2.jpg` → order `IMG_2.jpg, IMG_10.jpg`.
  - `applyTemplate` from `g8` with photos p1..p8 to `p12` → cells `[p1,p2,p3]`; `photoUsage` has no `p4`.
  - `applyTemplate` from `full` with p1 to `two` → `[p1, null]`.
  - `swapCells` across two spreads swaps photo and crop.
  - `removePhoto(p1)` clears all cells with p1 and removes it from `photos`.
  - `removeSpread(cover)` returns the same album; `moveSpread(a, 3, 0)` puts that spread at index 1.
  - `updatedAt` changes on every operation (fake timers).
- [ ] **Step 2:** Run `npx vitest run tests/unit/album.test.ts` → FAIL.
- [ ] **Step 3:** Implement `album.ts`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(model): album operations`.

---

### Task 5: Book-start page mapping and print warnings

**Files:**
- Create: `src/model/pages.ts`
- Test: `tests/unit/pages.test.ts`

**Interfaces:**
- Consumes: `cellRects`, `effectiveDpi`, `LOW_DPI`, `FOLD_X`.
- Produces:
  - `type Side = 'left' | 'right'`
  - `printedPages(a: Album): { page: number; spreadId: string; side: Side }[]` — cover excluded. `full-spread`: every non-cover spread gives left then right. `single-right`: first non-cover spread gives only right, last gives only left.
  - `sideIsPrinted(a, spreadId, side): boolean`.
  - `cellSides(rect: Rect, bleedMm: number): Side[]` — which pages a cell touches (`'left'` if `rect.x < bleed+300`, `'right'` if `rect.x+rect.w > bleed+300`).
  - `type PrintWarning = { kind: 'min-pages'; pages: number } | { kind: 'low-dpi'; ref: CellRef; dpi: number } | { kind: 'unprinted-photo'; ref: CellRef } | { kind: 'missing-photo'; photoId: string }`.
  - `printWarnings(a: Album, available: Set<string>): PrintWarning[]` — `min-pages` when pages < 24; `low-dpi` per filled cell under 200 dpi (non-cover); `unprinted-photo` for a filled cell whose every side is not printed; `missing-photo` for photo ids used in cells but absent from `available` (ids whose preview or original is present).

- [ ] **Step 1: Write the failing tests:**
  - default album (15 spreads, `full-spread`) → 30 pages, page 1 = spread[1] left, page 30 = spread[15] right, no `min-pages`.
  - `single-right` → 28 pages, page 1 = spread[1] right, page 28 = spread[15] left; `sideIsPrinted(spread[1], 'left') === false`.
  - 11 non-cover spreads, `full-spread` → `{ kind: 'min-pages', pages: 22 }`.
  - `single-right` with a photo on `two` template left cell of spread[1] → `unprinted-photo` warning; switching back to `full-spread` → none, and the photo is still in the cell (setting change keeps layout).
  - a 1000×667 photo on `full` → `low-dpi` with dpi ≈ 41.9.
- [ ] **Step 2:** Run `npx vitest run tests/unit/pages.test.ts` → FAIL.
- [ ] **Step 3:** Implement `pages.ts`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(model): page mapping and print warnings`.

---

### Task 6: Store with undo/redo

**Files:**
- Create: `src/state/store.ts`
- Test: `tests/unit/store.test.ts`

**Interfaces:**
- Consumes: `Album`.
- Produces:

```ts
export interface AlbumStore {
  album: ReadonlySignal<Album>;
  canUndo: ReadonlySignal<boolean>;
  canRedo: ReadonlySignal<boolean>;
  dispatch(op: (a: Album) => Album, opts?: { coalesce?: string }): void;
  undo(): void; redo(): void;
  replace(a: Album): void; // load without history
  subscribe(fn: (a: Album) => void): () => void; // fires after every change incl. undo/redo
}
export function createAlbumStore(initial: Album): AlbumStore;
```

  `coalesce`: consecutive dispatches with the same key update the top history entry instead of pushing (one undo step per pan/gutter drag). A dispatch without a key, or with a different key, ends the run. History depth 100. An op returning the same object reference does nothing.

- [ ] **Step 1: Write the failing tests:** undo/redo round-trip; redo cleared after new dispatch; 5 coalesced dispatches → one undo returns to start; 150 dispatches → only 100 undos possible; no-op op does not create history; `subscribe` fires on undo.
- [ ] **Step 2:** Run `npx vitest run tests/unit/store.test.ts` → FAIL.
- [ ] **Step 3:** Implement with `@preact/signals` `signal`/`computed`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(state): undoable album store`.

---

### Task 7: IndexedDB, autosave, layout file

**Files:**
- Create: `src/storage/db.ts`, `src/storage/autosave.ts`, `src/storage/layoutFile.ts`
- Test: `tests/unit/storage.test.ts` (uses `import 'fake-indexeddb/auto'`)

**Interfaces:**
- Produces in `db.ts` (DB name `album-builder`, version 1, stores `albums` keyPath `id`, `previews` out-of-line keys `${photoId}:full|thumb`, `handles` keyed by album id):
  - `saveAlbum(a: Album): Promise<void>`, `loadAlbum(id): Promise<Album | undefined>`, `listAlbums(): Promise<{ id: string; name: string; updatedAt: number }[]>` (newest first), `deleteAlbum(id): Promise<void>` (also deletes previews of its photos and its handle).
  - `putPreview(photoId, kind: 'full' | 'thumb', blob: Blob)`, `getPreview(photoId, kind): Promise<Blob | undefined>`, `hasPreviews(ids: string[]): Promise<Set<string>>`.
  - `putDirHandle(albumId, h: FileSystemDirectoryHandle)`, `getDirHandle(albumId)`.
  - `requestPersistence(): Promise<boolean>` — wraps `navigator.storage?.persist?.()`.
- Produces in `autosave.ts`:
  - `createAutosaver(save: (a: Album) => Promise<void>, delayMs = 300): { schedule(a: Album): void; flush(): Promise<void>; onError(cb: (e: unknown) => void): void; dispose(): void }` — registers `pagehide` and `visibilitychange` (hidden) listeners that call `flush()`.
- Produces in `layoutFile.ts`:
  - `serializeLayout(a: Album): string`, `parseLayout(text: string): Album` — throws `LayoutFileError` (`message` from `strings.layoutFileInvalid`) on wrong `format`, unknown `version`, or bad JSON.
  - `saveLayoutFile(a: Album): Promise<number>` — `showSaveFilePicker` when present, else download `<name>.album.json`; returns save timestamp.
  - `openLayoutFile(): Promise<Album>` — `showOpenFilePicker` or `<input type=file accept=".json">`.

- [ ] **Step 1: Write the failing tests:**
  - save → list → load round-trip; `deleteAlbum` removes previews of its photos.
  - `schedule` three times within 300 ms → `save` called once with the last album (fake timers).
  - `flushes on pagehide`: `schedule(a)` then `window.dispatchEvent(new Event('pagehide'))` → `save` called before timers advance.
  - `reports save errors`: `save` rejects → `onError` callback receives the error; next `schedule` still retries.
  - `parseLayout(serializeLayout(a))` deep-equals `a`; `parseLayout('{"format":"x"}')` throws `LayoutFileError`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/storage.test.ts` → FAIL.
- [ ] **Step 3:** Implement the three files.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(storage): indexeddb, autosave, layout file`.

---

### Task 8: Photo import and originals

**Files:**
- Create: `src/photos/import.ts`, `src/photos/originals.ts`
- Test: `tests/unit/import.test.ts`, `tests/e2e/import.spec.ts`

**Interfaces:**
- Produces in `import.ts`:
  - `isAccepted(name: string): boolean`.
  - `mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]>`.
  - `pickFolder(): Promise<{ dir: FileSystemDirectoryHandle; files: File[] } | null>` — only when `'showDirectoryPicker' in window`; top-level files only.
  - `pickFiles(): Promise<File[]>` — hidden `<input type=file multiple accept="image/jpeg,image/png,image/webp">`.
  - `importFiles(files: File[], onProgress: (done: number, total: number) => void): Promise<{ metas: PhotoMeta[]; skipped: string[] }>` — filters with `isAccepted`, runs `mapLimit(…, 2, …)`: `createImageBitmap(file, { imageOrientation: 'from-image' })`, width/height from the bitmap, `takenAt` from `exifr.parse(file, ['DateTimeOriginal'])` as ISO string or null, writes `full` (1600) and `thumb` (320) JPEG 0.85 previews via `putPreview`, closes the bitmap.
- Produces in `originals.ts`:
  - `registerOriginals(files: Map<string, File>): void` (photo id → File, in memory for this session).
  - `getOriginal(albumId: string, meta: PhotoMeta): Promise<File | null>` — memory first, then the stored dir handle (`queryPermission`/`requestPermission({ mode: 'read' })`, find by `name` and `size`).

- [ ] **Step 1: Write the failing unit tests:** `isAccepted('A.JPG') === true`, `isAccepted('notes.txt') === false`, `isAccepted('x.heic') === false`; `mapLimit never exceeds concurrency` (track concurrent count with deferred promises, limit 2, 10 items → max observed 2, results in input order).
- [ ] **Step 2:** Run `npx vitest run tests/unit/import.test.ts` → FAIL.
- [ ] **Step 3:** Implement `import.ts` and `originals.ts`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Write e2e test** `tests/e2e/import.spec.ts` that loads a test harness page `/?harness=import` (exposes `window.__importFiles` in dev builds only) and feeds fixtures via `setInputFiles`: `reads oriented dimensions` → `rot6.jpg` meta is 1200×1800 with `takenAt` `2026-06-14T15:30:00`; `notes.txt` lands in `skipped`; previews exist for every meta.
- [ ] **Step 6:** Run `npx playwright test tests/e2e/import.spec.ts` → PASS on both projects.
- [ ] **Step 7:** Commit `feat(photos): import with previews`.

---

### Task 9: Photo relinking

**Files:**
- Create: `src/photos/match.ts`
- Test: `tests/unit/match.test.ts`

**Interfaces:**
- Produces:
  - `interface Candidate { name: string; size: number; width: number; height: number; takenAt: string | null }`
  - `matchPhotos(wanted: PhotoMeta[], candidates: Candidate[]): { matched: Map<string, number>; missing: string[]; ambiguous: string[] }` — `matched` maps photo id → candidate index.
  - Ladder, each level considers only still-unmatched photos and unused candidates; a level accepts a pair only when it is unique in both directions; when a photo has ≥ 2 candidates at the first level where it has any, it goes to `ambiguous` and is not tried at lower levels:
    1. same `name` and `size`;
    2. same `name` and same `width×height`;
    3. same name stem (case-insensitive, extension removed) and aspect ratio within 1%, and `takenAt` equal when both present;
    4. same `takenAt` (both non-null) and aspect ratio within 1%.

- [ ] **Step 1: Write the failing tests:**
  - exact copies match at level 1.
  - `IMG_1.HEIC` (4032×3024) ↔ `IMG_1.jpg` (2016×1512, other size) matches at level 3.
  - renamed `photo-123.jpg` with same `takenAt` and ratio matches at level 4.
  - `does not merge same-name photos`: wanted `IMG_0001.jpg` ×2 (sizes 100, 200), candidates same names sizes 200, 100 → each matched to the right size.
  - two candidates `IMG_0001.jpg` with unknown sizes and same dimensions for one wanted photo → `ambiguous`.
  - no candidate → `missing`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/match.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(photos): relinking ladder`.

---

### Task 10: App shell, album list, responsive editor frame

**Files:**
- Create: `src/ui/strings.ts`, `src/ui/App.tsx`, `src/ui/AlbumList.tsx`, `src/ui/Editor.tsx`, `src/ui/previews.ts`, `src/ui/styles.css`; Modify: `src/main.tsx`, `index.html` (title `Конструктор альбому`)
- Test: `tests/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `createAlbumStore`, `createAutosaver`, `saveAlbum`, `loadAlbum`, `listAlbums`, `deleteAlbum`, `createAlbum`, `renameAlbum`, `requestPersistence`.
- Produces:
  - `App` — on start shows `AlbumList`; opening an album creates a store, wires `store.subscribe(autosaver.schedule)`, calls `requestPersistence()`. Last opened album id is kept in `localStorage['lastAlbumId']` and reopened on start.
  - `AlbumList` — create (default name `Новий альбом`), open, rename, delete (with `confirm`).
  - `Editor({ store })` — at ≥ 900 px: left `PhotoPanel`, centre `SpreadView`, right `TemplatePanel`, bottom `SpreadStrip`, top bar (album name, undo, redo, settings, preview, save file, open file, export). Under 900 px: top bar with spread `‹ n / N ›`, `SpreadView` full width, bottom tabs `Фото / Шаблони / Розвороти` showing the matching panel. Until Tasks 11–14 land, the panels are empty placeholders with `data-testid` `photo-panel`, `spread-view`, `template-panel`, `spread-strip`.
  - `usePreviewUrl(photoId: string, kind: 'full' | 'thumb'): string | null` in `previews.ts` — object-URL cache shared app-wide.
  - Keyboard: `Ctrl+Z` undo, `Ctrl+Shift+Z` / `Ctrl+Y` redo.
  - In dev builds only (`import.meta.env.DEV`): `window.__store` = the open album's `AlbumStore`, for e2e tests.
  - `strings.ts` exports one `strings` object; later tasks add their keys to it (`notPrinted`, `dropHere`, `lowDpi(dpi)`, `layoutFileInvalid`, `storageError`, `iosInstallHint`, `backupReminder`, `exportDesktopOnly`).
- `data-testid` convention: kebab-case component names; cells `cell-<spreadIndex>-<cellIndex>`; tray photos `photo-<name>`; strip items `strip-<index>`.

- [ ] **Step 1: Write the failing e2e tests:** create album → it appears in list after reload; rename persists after reload; `desktop-chromium` shows all four panels at once; `mobile-webkit` shows `spread-view` and tabs, tapping `Шаблони` shows `template-panel`.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/shell.spec.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ui): app shell and album list`.

---

### Task 11: Spread view with guides, selection, gutter drag

**Files:**
- Create: `src/ui/SpreadView.tsx`; Modify: `src/ui/Editor.tsx`, `src/ui/styles.css`
- Test: `tests/e2e/spread.spec.ts`

**Interfaces:**
- Consumes: `cellRects`, `gutters`, `guides`, `sourceRect`, `sideIsPrinted`, `moveGutterOp`, `usePreviewUrl`.
- Produces: `SpreadView({ store, spreadIndex, selected: CellRef | null, onSelect(ref: CellRef | null) })`.
  - Renders an SVG or absolutely positioned box with `viewBox` = canvas mm; background = `settings.background`; each cell shows the `full` preview cropped with `sourceRect` (CSS `object-fit` is not enough because of zoom/centre — use background-size/position computed from `sourceRect`).
  - Guides when `showGuides`: bleed area shaded outside the trim rect, dashed safe-zone rects, a thin fold line at the fold.
  - Non-printed side (Task 5) is shown greyed with the label `strings.notPrinted`.
  - Empty cell shows `strings.dropHere`.
  - Gutters are hit areas at least 12 CSS px wide; pointer drag calls `store.dispatch(a => moveGutterOp(...), { coalesce: 'gutter' })`; cursor `col-resize`/`row-resize`.
  - Click on a cell → `onSelect`; click on background → `onSelect(null)`.
  - Size: fits the available width and height, keeping the 606:306 ratio.

- [ ] **Step 1: Write the failing e2e tests:** apply template via store helper `window.__store` (dev only) to `row3`; drag gutter 0 right by 60 CSS px → first cell box wider, third unchanged; one `Ctrl+Z` restores the original widths; guides visible by default (`data-testid=guide-safe` count 2, `guide-fold` 1); toggling `showGuides` false hides them.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/spread.spec.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ui): spread view with guides and gutter drag`.

---

### Task 12: Drag and drop, photo panel, templates panel, spread strip

**Files:**
- Create: `src/ui/dnd.ts`, `src/ui/PhotoPanel.tsx`, `src/ui/TemplatePanel.tsx`, `src/ui/SpreadStrip.tsx`; Modify: `src/ui/Editor.tsx`, `src/ui/SpreadView.tsx`
- Test: `tests/e2e/dnd.spec.ts`

**Interfaces:**
- Consumes: `importFiles`, `pickFolder`, `pickFiles`, `registerOriginals`, `putDirHandle`, `addPhotos`, `removePhoto`, `placePhoto`, `swapCells`, `clearCell`, `applyTemplate`, `addSpread`, `removeSpread`, `moveSpread`, `photoUsage`, `TEMPLATES`, `cellRects`.
- Produces in `dnd.ts`:
  - `type DragPayload = { kind: 'photo'; photoId: string } | { kind: 'cell'; ref: CellRef } | { kind: 'spread'; index: number }`
  - `startDrag(e: PointerEvent, payload: DragPayload, ghost: HTMLElement): void` — mouse: starts after 4 px movement; touch: after a 250 ms long-press without moving more than 8 px (so the tray still scrolls). Drop targets register with `registerDropTarget(el: HTMLElement, accepts: (p: DragPayload) => boolean, onDrop: (p: DragPayload) => void): () => void`; the hovered target gets class `drop-hover`.
  - `armedPhoto: Signal<string | null>` — tap-to-place: tapping a tray photo arms it; tapping a cell places it and disarms.
- `PhotoPanel`: buttons `Додати папку` (only when `pickFolder` is available) and `Додати фото`; progress bar during import; skipped files listed in a dismissible note; counter `використано X / Y` (X = photos with usage ≥ 1); thumbnails in name order; used ones dimmed with a check mark and a count when > 1; context menu / long-press menu `Прибрати з альбому`.
- `TemplatePanel`: the 12 templates as miniature spreads rendered with `cellRects` at current settings; click (tap) applies to the current spread; current template highlighted; badge `ваш приклад` for `mine`.
- `SpreadStrip`: miniatures of all spreads (cover labelled `Обкладинка`), current highlighted, click to select, drag to reorder (cover fixed), buttons `+` (add after current) and delete (with `confirm`).
- Drag rules: tray photo → cell = `placePhoto`; cell → cell = `swapCells` (also onto a cell of another spread via strip hover switching the current spread after 600 ms); cell → tray = `clearCell`.

- [ ] **Step 1: Write the failing e2e tests** (fixtures via `setInputFiles`): import 9 fixtures → counter `використано 0 / 9`; drag `land-1.jpg` onto `cell-1-0` → cell shows it, counter `1 / 9`, tray item dimmed; on `two` template, drag cell 0 onto cell 1 → swapped; drag cell to tray → empty; on `mobile-webkit`, tap `photo-land-2.jpg` then tap `cell-1-0` → placed; reload page → placement still there (autosave); click template `g8` → 8 cells, previous photo in cell 0; strip `+` adds a spread (17 items), drag strip item 2 to position 1 reorders.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/dnd.spec.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ui): drag and drop, photo, template and spread panels`.

---

### Task 13: Crop mode and quality badge

**Files:**
- Create: `src/ui/CellToolbar.tsx`; Modify: `src/ui/SpreadView.tsx`
- Test: `tests/e2e/crop.spec.ts`

**Interfaces:**
- Consumes: `panCrop`, `clampCrop`, `setCrop`, `clearCell`, `effectiveDpi`, `LOW_DPI`.
- Produces: `CellToolbar({ store, ref })` shown near the selected filled cell: zoom slider (1–8), `Кадрувати` toggle, `Прибрати фото`.
  - Selection model: a single click/tap selects a cell; drag on a selected cell in crop mode pans (`dispatch(…, { coalesce: 'crop' })`); double-click (desktop) or double-tap enters crop mode; outside crop mode a drag moves the photo (Task 12). Mouse wheel over the cell in crop mode zooms around the pointer; two-finger pinch zooms on touch. `Escape` or tapping outside leaves crop mode.
  - A cell with `effectiveDpi < 200` shows a warning icon with tooltip `strings.lowDpi(dpi)`.

- [ ] **Step 1: Write the failing e2e tests:** place `land-1.jpg` (1800×1200) on `full` → low-dpi icon visible (dpi ≈ 75); double-click cell, drag 100 px left → crop `cx` > 0.5 (read via `window.__store`), single `Ctrl+Z` restores; wheel zoom raises `zoom` and lowers no further than 1; `Прибрати фото` empties the cell.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/crop.spec.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ui): crop mode and quality badge`.

---

### Task 14: Settings dialog and preview mode

**Files:**
- Create: `src/ui/SettingsDialog.tsx`, `src/ui/PreviewMode.tsx`; Modify: `src/ui/Editor.tsx`
- Test: `tests/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `updateSettings`, `cellRects`, `printedPages`.
- Produces:
  - `SettingsDialog({ store, onClose })` — fields: проміжок (0–20 мм), поле від краю (0–30 мм), тло (3 options), виліт (0–5 мм), безпечна зона (0–20 мм), показувати напрямні, початок книги (`Сторінка 1 — ліва половина першого розвороту` / `Сторінка 1 — окрема права сторінка`), сторінки для експорту (`З вильотом, 3614×3614 px` / `Без вильоту, 3543×3543 px`). Changes apply live through one coalesced dispatch per field (`coalesce: 'settings:<field>'`).
  - `PreviewMode({ store, onClose })` — full-screen, guides hidden, bleed cropped to trim, one spread at a time, arrows/keys/swipe to flip, `Escape` closes. Non-printed sides shown as blank paper.

- [ ] **Step 1: Write the failing e2e tests:** set gap to 12 → on `two` template the two cells are 12 mm apart (measure via `cellRects` through `window.__store` and visually via box positions ratio); switch book start to single-right → first spread left half shows `strings.notPrinted`; preview opens, `ArrowRight` advances, no guide elements in preview.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/settings.spec.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ui): settings and preview mode`.

---

### Task 15: Print export

**Files:**
- Create: `src/export/render.ts`, `src/export/jpeg.ts`, `src/export/export.ts`, `src/ui/ExportDialog.tsx`
- Test: `tests/unit/jpeg.test.ts`, `tests/unit/exportPlan.test.ts`, `tests/e2e/export.spec.ts`

**Interfaces:**
- Consumes: `cellRects`, `sourceRect`, `printedPages`, `getOriginal`, `mmToPx`, `canvasSizeMm`.
- Produces:
  - `setJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array` — if the JPEG starts with an APP0 JFIF segment, set units = 1 and X/Y density = dpi; otherwise insert a JFIF APP0 after SOI.
  - `interface ExportJob { file: string; spreadId: string; regionMm: Rect; px: { w: number; h: number } }`
  - `exportPlan(a: Album): ExportJob[]` — for each non-cover spread `n` (1-based): `spreads/spread-NN.jpg` region = whole canvas, px 7157×3614 (for `bleedMm: 3`); then for each `printedPages` entry `pages/page-NNN.jpg`: with `pageExport: 'bleed'` left region `{x:0,y:0,w:306,h:306}`, right `{x:300,y:0,w:306,h:306}`; with `'trim'` left `{x:3,y:3,w:300,h:300}`, right `{x:303,y:3,w:300,h:300}` (values shown for bleed 3; compute from `bleedMm`).
  - `renderRegion(a: Album, spread: Spread, regionMm: Rect, px: { w: number; h: number }, load: (meta: PhotoMeta) => Promise<ImageBitmap>): Promise<Blob>` — `OffscreenCanvas` (fallback `HTMLCanvasElement`), fill background, for each filled cell clip to its rect and `drawImage` with `sourceRect`, `convertToBlob({ type: 'image/jpeg', quality: 0.95 })`, then `setJpegDpi(…, 300)`. Bitmaps decoded with `imageOrientation: 'from-image'` and closed after use.
  - `runExport(a: Album, onProgress: (done: number, total: number) => void): Promise<void>` — collects originals via `getOriginal`; if any are missing, throws `MissingOriginalsError` listing photo ids (UI then opens `RelinkDialog` from Task 16). Writes into a user-chosen folder `export-<album name>/` with `showDirectoryPicker({ mode: 'readwrite' })` when available, else builds a ZIP with `fflate` and downloads `<album name>.zip`. Renders one job at a time.
  - `ExportDialog({ store, onClose })` — shows print warnings (`printWarnings`), counts of files, a start button, progress, and on mobile-webkit a note `strings.exportDesktopOnly` and only the pages option.

- [ ] **Step 1: Write the failing unit tests:**
  - `setJpegDpi` on a minimal JFIF header sets bytes 13..17 to `01 01 2C 01 2C`; on a JPEG without APP0 inserts one (length +18).
  - `exportPlan(default album with 15 spreads)` → 15 spread jobs + 30 page jobs; first page job `pages/page-001.jpg` region `{x:0,y:0,w:306,h:306}` px 3614×3614; `pageExport: 'trim'` → px 3543×3543; `single-right` → 28 page jobs, `page-001` is the right side of spread 1; cover never appears.
- [ ] **Step 2:** Run `npx vitest run tests/unit/jpeg.test.ts tests/unit/exportPlan.test.ts` → FAIL.
- [ ] **Step 3:** Implement `jpeg.ts` and `exportPlan`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Write the failing e2e test** (desktop-chromium only; uses ZIP path by deleting `window.showDirectoryPicker` in an init script): import fixtures, place photos on 12 spreads, export → downloaded ZIP contains `spreads/spread-01.jpg` decoded as 7157×3614 and `pages/page-001.jpg` as 3614×3614; `exports oriented photo upright`: `rot6.jpg` on `full` of spread 1 → sample pixel above the drawn arrow tip is arrow colour (arrow points up).
- [ ] **Step 6:** Implement `renderRegion`, `runExport`, `ExportDialog`.
- [ ] **Step 7:** Run `npx playwright test tests/e2e/export.spec.ts` → PASS.
- [ ] **Step 8:** Commit `feat(export): print-ready jpg export`.

---

### Task 16: Relinking, layout files across devices, banners

**Files:**
- Create: `src/ui/RelinkDialog.tsx`, `src/ui/Banners.tsx`; Modify: `src/ui/Editor.tsx`, `src/ui/App.tsx`, `src/ui/SpreadView.tsx`, `src/ui/PhotoPanel.tsx`
- Test: `tests/e2e/relink.spec.ts`

**Interfaces:**
- Consumes: `matchPhotos`, `importFiles`, `registerOriginals`, `hasPreviews`, `saveLayoutFile`, `openLayoutFile`, `parseLayout`, `printWarnings`, autosaver `onError`.
- Produces:
  - Opening a layout file creates (or, if the album id exists, asks `Замінити наявний альбом?`) the album. Photos whose previews are absent are "missing".
  - `RelinkDialog({ store, missing: string[], mode: 'previews' | 'originals', onDone })` — user picks files/folder; `matchPhotos` runs; matched files are imported under the **existing** photo ids (previews regenerated, `registerOriginals`); `ambiguous` and remaining `missing` are listed with the expected name, size, date; for each the user can choose a file manually or skip.
  - A missing photo in a cell renders as a grey box with its file name and a `Знайти фото` button that opens `RelinkDialog`.
  - `Banners({ store })`: (1) storage error — shown when the autosaver reports an error, text `strings.storageError` and a `Зберегти у файл` button; (2) iOS hint — when `navigator.userAgent` is iOS and `!matchMedia('(display-mode: standalone)').matches`, text `strings.iosInstallHint`, dismissible, remembered in `localStorage`; (3) backup reminder — when `lastFileSaveAt` is null or older than 3 days and `updatedAt > lastFileSaveAt`, text `strings.backupReminder` with `Зберегти у файл`; (4) print warnings summary (`min-pages`, count of `low-dpi`, `unprinted-photo`, `missing-photo`).
  - `saveLayoutFile` success updates `lastFileSaveAt` through `store.dispatch` (no undo entry: use `store.replace`).

- [ ] **Step 1: Write the failing e2e tests:** save layout file (download), clear IndexedDB, open the file → spreads restored, cells show missing boxes with names; relink with `land-*` fixtures → cells show photos; `dup-a/IMG_0001.jpg` and `dup-b/IMG_0001.jpg` both in album, relink with both → each cell gets the right one (compare preview colour); `shows storage error banner`: init script makes `IDBObjectStore.prototype.put` throw `QuotaExceededError` after load → edit → banner visible with `Зберегти у файл`; backup reminder visible with fake clock 4 days after an edit.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/relink.spec.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(ui): relinking, layout files and banners`.

---

### Task 17: PWA and GitHub Pages deployment

**Files:**
- Modify: `vite.config.ts`; Create: `public/icon-192.png`, `public/icon-512.png`, `.github/workflows/pages.yml`, `README.md`

**Interfaces:**
- Consumes: the built app.
- Produces: installable PWA (`name: 'Конструктор альбому'`, `short_name: 'Альбом'`, `display: 'standalone'`, `theme_color: '#f4efe6'`), offline app shell via `vite-plugin-pwa` `registerType: 'autoUpdate'`; `base` = `process.env.BASE_PATH ?? '/'`. Workflow builds with `BASE_PATH=/<repo>/`, runs `npm test`, uploads `dist` with `actions/upload-pages-artifact`, deploys with `actions/deploy-pages`.

- [ ] **Step 1:** Configure PWA and icons (simple album glyph on `#f4efe6`).
- [ ] **Step 2:** Run `npm run build && npx vite preview --port 5300`; open in Playwright Chromium, assert `navigator.serviceWorker.controller` is set after reload and the manifest link resolves. Expected: PASS.
- [ ] **Step 3:** Write `.github/workflows/pages.yml` and `README.md` (STE-flavored: what it is, how to run locally, how to deploy, Gramofon notes).
- [ ] **Step 4:** Run `npm test && npm run e2e` → all PASS.
- [ ] **Step 5:** Commit `feat: pwa and github pages deployment`.
- [ ] **Step 6: Stop and ask the user** for the repository name and visibility before creating anything on GitHub. Then `gh repo create <name> --source . --push`, enable Pages with source "GitHub Actions" (`gh api -X POST repos/{owner}/{repo}/pages -f build_type=workflow`), wait for the workflow, and report the final URL. The URL must not change afterwards (autosave is bound to it).
