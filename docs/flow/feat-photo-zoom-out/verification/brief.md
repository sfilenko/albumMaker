# Brief: Zoom a photo out inside its cell

_Created: 2026-10-30_

## Goal

The user can make a photo smaller than its cell. Then the whole photo shows, with an area of the album background around it.

## Context

Today the smallest zoom is `1×`, and at `1×` the photo exactly covers its cell. The user sees that the zoom can only go up.

- `src/model/crop.ts:5` sets `MIN_ZOOM = 1`. `clampCrop` (`src/model/crop.ts:33`) clamps every zoom to 1..8. `visibleSize` (`src/model/crop.ts:12`) defines `1×` as the cover fit: the photo touches all four sides of the cell and the app crops the photo at two edges.
- `src/ui/CellToolbar.tsx:10` repeats `MIN_ZOOM = 1` for the zoom slider. The mouse wheel (`src/ui/SpreadView.tsx:159`) and the two-finger pinch (`src/ui/SpreadView.tsx:136`) call `zoomCrop`, so the same clamp stops them at `1×`.
- This is not a defect. The brief of `feat-album-builder` asked for it. Its requirement 20 says "A photo always fills its cell completely". Its requirement 21 says "zoom from 1× to 8× … The photo always covers the cell". The capability record has these as C-20 and C-21. On 2026-10-30 the user decided that this feature replaces C-20. It also replaces the lower limit of C-21 (R-1, R-2).
- One function, `sourceRect` (`src/model/crop.ts:19`), gives the visible part of the photo to three readers:
  - the editor (`CellPhoto`, `src/ui/SpreadView.tsx:45`)
  - the full-screen preview (`src/ui/PreviewMode.tsx:116`)
  - the print export (`src/export/render.ts:56`).

  All three draw that part over the whole cell. At a zoom under the cover fit, the photo must cover only a part of the cell, so all three readers change.
- The export fills the background colour first (`src/export/render.ts:42`) and then draws each photo.
- The dpi warning (`effectiveDpi`, `src/model/crop.ts:61`, used at `src/ui/SpreadView.tsx:162` and `src/model/pages.ts:73`) divides the visible photo width by the cell width. When the photo is smaller than the cell, this formula is wrong: the printed width of the photo is smaller than the cell width.

## Requirements

| Id | Requirement | How it will be observed |
|---|---|---|
| R-1 | A photo can be smaller than its cell. The area of the cell that the photo does not cover shows the album background colour (setting "Фон"). This replaces C-20 "A photo always fills its cell". | Put a portrait photo into a landscape cell and zoom out: bands of the background colour show at the left and right of the photo. |
| R-2 | The smallest photo size is half of the "whole photo" size. The "whole photo" size is the largest size at which the whole photo shows in the cell. At that size, the photo touches two opposite sides of the cell. The largest zoom stays 8× of the cover fit. This replaces the lower limit `1×` of C-21. | Put a portrait photo into a landscape cell. Move the zoom slider to its left end. The whole photo shows, and its height is half of the cell height. |
| R-3 | The zoom slider, the mouse wheel in crop mode and the two-finger pinch in crop mode all go down to the limit of R-2. | Use each of the three controls on a photo at `1×`: the photo gets smaller with each one, and stops at the limit of R-2. |
| R-4 | A photo that is smaller than its cell along one axis can be moved along that axis in crop mode. It stays fully inside the cell: it stops at the cell edge and the cell edge never cuts it. | Zoom out a landscape photo in a square cell, then drag it up and down. It moves, and it stops when its edge touches the cell edge. |
| R-5 | On an axis where the photo is larger than the cell, the move works as it does today. The photo always covers the cell on that axis. | Zoom a portrait photo in a landscape cell to a size between "whole photo" and `1×`. Drag it up and down. No band of background shows at the top or the bottom. |
| R-6 | A photo that the user puts into a cell starts at `1×` and covers the cell, as it does today. | Drop a photo into an empty cell: no background shows in the cell. |
| R-7 | The editor, the full-screen preview and the print export show a zoomed-out photo at the same size and position. Each one shows the album background colour around it. | Zoom out a photo, open the preview, and export the spread. In all three, the photo has the same position in its cell and the same background bands. |
| R-8 | The dpi warning uses the printed size of the photo. When the photo is smaller than its cell, the dpi is the photo width in pixels divided by the printed photo width in inches. The cell width is not used. | An 1800×1200 px photo in a 150×150 mm cell at the "whole photo" size is 150 mm wide and shows about 305 dpi. At the smallest size it is 75 mm wide and shows about 610 dpi. Today the formula gives a wrong value for both. |
| R-9 | One zoom-out gesture (one slider movement, one wheel series, one pinch) is one undo step, as a zoom-in is today. | Zoom out with the slider, then press undo once: the photo goes back to its size before the movement. |

## Out of Scope

- A warning about a cell that has an area of background. The user decided on 2026-10-30 that the empty area is a deliberate choice, so the print summary and the export do not mention it.
- A move of the photo across the cell edge. The cell edge never cuts a zoomed-out photo (R-4).
- A start size other than `1×` for a new photo (R-6).
- A fill of the empty area with something other than the album background colour. Examples: a blurred copy of the photo, a colour for one cell.
- A change to the largest zoom (8×).

## Edge Cases

| Id | Case | Expected behaviour |
|---|---|---|
| E-1 | A drag of the border between two cells changes the proportions of a cell that has a zoomed-out photo. | The photo keeps its zoom when the new cell allows it. When the zoom is now under the new limit of R-2, the photo shows at the new limit. The photo stays fully inside the cell (R-4). It covers the cell on each axis where it is larger than the cell (R-5). A template change resets each photo to `1×`, as it does today (`src/model/album.ts:109`). |
| E-2 | An album or a `.album.json` file from before this feature: every zoom is 1 or more. | It opens with no change. Each photo shows exactly as before. |
| E-3 | A `.album.json` file that has a zoom under the limit of R-2 for its cell. | The app shows the photo at the nearest allowed zoom. It does not show an error. |
| E-4 | The photo has the same proportions as its cell. | The "whole photo" size and `1×` are the same. The zoom goes down to half of it, and the photo can move in both axes (R-4). |
| E-5 | A zoomed-out photo in a cell at the edge of the spread, where the cell goes into the bleed. | The background colour fills the bleed area that the photo does not cover, in the export too. |
| E-6 | A photo that has no screen copy on this device (a grey box with its file name). | No change: the grey box fills the cell. After the relink, the photo shows at its stored zoom. |
| E-7 | A crop gesture starts at a zoom above `1×` and goes below `1×` without a stop. | The photo gets smaller with no jump at `1×`. |

## Constraints

- The format of the `.album.json` layout file does not change in a way that stops an older file from opening (E-2).
- The editor, the preview and the export get the visible part of the photo from one place, as they do now. A second copy of the crop calculation is not allowed. In `feat-album-builder`, a second copy of a helper drifted from the first one more than once (`docs/flow/feat-album-builder/summary.md`, "What broke along the way").

## Open Questions

| Id | Question | Blocks |
|---|---|---|
| — | none | — |
