# Plan: Zoom a photo out inside its cell

_Brief: `.devflow/brief.md` · Created: 2026-10-30_

## Overview

Phase 1 changes the crop geometry in `src/model/crop.ts`, so that the zoom can go under the cover fit. It also changes the readers of that geometry:

- the editor and the preview, both through `CellPhoto`
- the print export
- the dpi warning.

 The mouse wheel and the pinch call `zoomCrop`, so they get the new lower limit in Phase 1 too. Phase 2 changes the zoom slider, which has its own copy of the limits. It also adds the end-to-end checks of the zoomed-out photo in the editor, the preview and the export. Phase 1 comes first because each control and each check of Phase 2 needs the new geometry.

## Changed Contracts

`Crop` (`src/model/types.ts:14`) keeps its shape `{ cx, cy, zoom }`. Only the allowed values change:

- `zoom` stays relative to the cover fit (`1` = the photo exactly covers the cell). It can now be under `1`, down to the limit of `zoomLimits`.
- On an axis where the photo is smaller than the cell, `cx` or `cy` can be under `0` or over `1`. The value still names the photo point at the centre of the cell.

`src/model/crop.ts`:

```ts
/** The allowed zoom for this photo in this cell. min is half of the "whole photo" zoom; max is 8. */
export function zoomLimits(photoW: number, photoH: number, cell: Rect): { min: number; max: number }

/** Replaces sourceRect. src is the visible part in photo pixels, always inside the photo.
 *  dst is where src lands, in millimetres from the top-left corner of the cell, always inside the cell. */
export function visiblePart(photoW: number, photoH: number, cell: Rect, crop: Crop): {
  src: { sx: number; sy: number; sw: number; sh: number };
  dst: Rect;
}

/** The rectangle of the whole photo, in millimetres from the top-left corner of the cell. It can extend past the cell. */
export function photoBox(photoW: number, photoH: number, cell: Rect, crop: Crop): Rect
```

- Phase 1 deletes `sourceRect`. Its consumers move to the new functions: `CellPhoto` (`src/ui/SpreadView.tsx:45`, also used by `src/ui/PreviewMode.tsx:116`) uses `photoBox`. The export (`src/export/render.ts:56`) uses `visiblePart`. `tests/unit/crop.test.ts` tests both.
- `clampCrop`, `panCrop` and `zoomCrop` keep their signatures. `clampCrop` takes its zoom range from `zoomLimits`.
- `effectiveDpi` keeps its signature. It divides `src.sw` by the width of `dst` in inches. Its consumers `src/ui/SpreadView.tsx:162` and `src/model/pages.ts:73` do not change.

## Decision Log

- **The zoom stays relative to the cover fit.** A zoom of 1 or more gives the same picture as before. So albums and `.album.json` files from before this feature open with no migration (E-2). The `Crop` type does not change. The rejected option was a zoom relative to the "whole photo" size. It needs a migration of every stored crop.
- **The code calculates the limits each time it reads a crop.** It does not store them. `visiblePart`, `photoBox` and `effectiveDpi` clamp the crop with `clampCrop` before they use it. A border drag can change the cell (E-1), and a file can have a zoom under the limit (E-3). In both cases the photo shows correctly. The store and the file loader need no extra code.
- **The export gives `drawImage` a source rectangle inside the photo.** The rejected option was a source rectangle that extends past the photo. The canvas specification clips such a rectangle. Browsers do not all clip it the same way, and the export must also work in Safari.
- **The slider uses `step="any"`.** The lower limit is different for each photo and cell, for example `0.33` or `0.22`. With a step of a set size, the slider cannot always reach both the limit and `1×`.

## Phases

### Phase 1: Zoom-out geometry and its readers

**Satisfies:** R-1, R-2, R-3, R-4, R-5, R-7, R-8 · changes C-20, C-21

**Goal:** The crop model allows a zoom down to half of the "whole photo" size. The editor, the preview, the export and the dpi warning all show a zoomed-out photo correctly. The mouse wheel and the pinch go down to the new limit.

**Files:**
- `src/model/crop.ts` (change)
- `src/ui/SpreadView.tsx` (change)
- `src/export/render.ts` (change)
- `tests/unit/crop.test.ts` (change)
- `tests/e2e/crop.spec.ts` (change)

**Steps:**
1. In `src/model/crop.ts`, add `zoomLimits`. The "whole photo" zoom is `min(photoW, photoH × a) / max(photoW, photoH × a)`, where `a` is the cell width divided by the cell height. `min` is half of that value. `max` is 8.
2. Change `clampCrop` to use `zoomLimits`. On each axis, when the visible area is smaller than the photo, clamp the centre as today. When it is larger, clamp the centre so that the photo stays fully inside the cell (R-4).
3. Add `visiblePart` and `photoBox`, and delete `sourceRect`. Both new functions call `clampCrop` first. Calculate both from one private function, so that the geometry exists in one place only (brief, Constraints).
4. Change `effectiveDpi` to divide `src.sw` by the width of `dst` in inches (R-8).
5. In `src/ui/SpreadView.tsx`, change `CellPhoto` to place the `<img>` from `photoBox`, as percentages of the cell. The preview uses `CellPhoto`, so it changes too (R-7).
6. In `src/export/render.ts`, draw `src` of `visiblePart` into `dst` of `visiblePart`, offset by the cell position in the region. Keep the background fill and the clip of the cell as they are.
7. In `tests/unit/crop.test.ts`, change the test "zoomCrop keeps zoom between 1 and 8" to the new limits. Add tests for R-2, R-4, R-5, R-8, E-1, E-2, E-3, E-4 and E-7.
8. In `tests/e2e/crop.spec.ts`, change the test "wheel zoom never goes below 1". The wheel now goes below 1 and stops at the limit of `zoomLimits` for that photo and cell.

**Completion Criterion:** `npx vitest run tests/unit/crop.test.ts` exits 0. It includes these cases:
- An 1800×1200 photo in a 150×150 mm cell has `zoomLimits(...).min` of about `0.333`.
- At the "whole photo" zoom, `effectiveDpi` is about 305. At the lower limit, it is about 610.
- At zoom `0.5` of a portrait photo in a landscape cell, `visiblePart(...).dst` is narrower than the cell and is inside it.
- A crop with zoom `0.01` reads as the lower limit.
- A crop with a centre far outside the cell reads as a photo inside the cell.
- Every crop with a zoom of 1 or more gives the same `src` as the old `sourceRect` for the existing test values.

`npx playwright test tests/e2e/crop.spec.ts` exits 0, and the wheel test reads a zoom under 1 from the store. The four gates of `project.md` exit 0.

### Phase 2: Zoom slider and end-to-end checks of a zoomed-out photo

**Depends on:** Phase 1

**Satisfies:** R-3, R-6, R-7, R-9 · changes C-21

**Goal:** The zoom slider goes from the lower limit of R-2 to 8×. End-to-end tests show a zoomed-out photo in the editor, the preview and the export, and show the undo of a zoom-out.

**Files:**
- `src/ui/CellToolbar.tsx` (change)
- `tests/e2e/crop.spec.ts` (change)
- `tests/e2e/zoom-out.spec.ts` (new)

**Steps:**
1. In `src/ui/CellToolbar.tsx`, delete the local `MIN_ZOOM` and `MAX_ZOOM`. Set the `min` and `max` of the slider from `zoomLimits` for the selected photo and cell. Set `step="any"` (Decision Log).
2. In `tests/e2e/crop.spec.ts`, change the test "the zoom slider goes from 1 to 8 and never below 1". The slider `min` is now the lower limit for the photo and cell, and a value of `0` gives that limit.
3. Add `tests/e2e/zoom-out.spec.ts` with these tests:
   - Put the portrait fixture `port-1.jpg` into a landscape cell and zoom it out with the slider. The editor shows the album background at the left and the right of the photo. The `<img>` box is inside the cell box.
   - The same spread in the preview has the photo at the same position, relative to its cell, as in the editor (R-7).
   - The export of that spread has the background colour in the band and the photo colours at the centre of the cell (R-7, E-5).
   - A drag in crop mode moves the zoomed-out photo on the free axis and stops at the cell edge (R-4).
   - One slider movement down, then one undo, gives back the zoom before the movement (R-9).
   - A photo dropped into an empty cell has zoom 1 and no background band (R-6).
   - A drag of the border between two cells with a zoomed-out photo keeps the photo inside its cell (E-1).

**Completion Criterion:** `npx playwright test tests/e2e/zoom-out.spec.ts tests/e2e/crop.spec.ts` exits 0 on `desktop-chromium` and `mobile-webkit`. A test that needs a mouse wheel or a mouse drag can skip `mobile-webkit` with a reason, as `tests/e2e/crop.spec.ts` does now. The four gates of `project.md` exit 0.

## Edge Cases

| Brief id | Handled in | How |
|---|---|---|
| E-1 | Phase 1, Phase 2 | `visiblePart` and `photoBox` clamp the stored crop against the current cell each time they read it. A unit test changes the cell of a stored crop. A Phase 2 test drags a border. A template change keeps its reset to `EMPTY_CROP` (`src/model/album.ts:109`). |
| E-2 | Phase 1 | The zoom stays relative to the cover fit (Decision Log). A unit test compares `src` for a zoom of 1 or more with the values of the old `sourceRect`. |
| E-3 | Phase 1 | The clamp each time the code reads a crop (Decision Log). A unit test uses a crop with zoom `0.01`. |
| E-4 | Phase 1 | `zoomLimits` gives a "whole photo" zoom of `1` and a lower limit of `0.5`. A unit test pans on both axes at zoom `0.5`. |
| E-5 | Phase 2 | The export fills the whole region with the background before it draws the photos (`src/export/render.ts:42`), and Phase 1 keeps that fill. The Phase 2 export test samples a pixel of the background band. |
| E-6 | Phase 1 | No change. A photo with no screen copy shows the grey box, and `CellPhoto` is not used. After the relink, `CellPhoto` uses the stored crop. |
| E-7 | Phase 1 | `zoomCrop` has no step at `1`. A unit test zooms from `1.2` to `0.8` in small steps and checks that the visible width changes in the same direction at each step. |

## Not Implemented

From the brief's Out of Scope:

- a warning about a cell that has an area of background
- a move of the photo across the cell edge
- a start zoom other than `1×` for a new photo
- a fill of the empty area with something other than the album background colour
- a change to the largest zoom (8×)
