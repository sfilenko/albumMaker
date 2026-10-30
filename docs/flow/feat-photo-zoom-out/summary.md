---
description: A photo can be smaller than its cell, down to half of the whole-photo size, with the album background around it
area: ui
paths: ["src/export/render.ts", "src/model/crop.ts", "src/ui/CellToolbar.tsx", "src/ui/SpreadView.tsx", "tests/e2e/crop.spec.ts", "tests/e2e/zoom-out.spec.ts", "tests/unit/crop.test.ts"]
last_verified: 1e74b0faf1dea7baf2efdbc681af656fc948a2e4
---

# feat-photo-zoom-out

_Archived 2026-10-30 · 2 phases · verification record in `verification/index.md`_

## What shipped

Before this feature, the smallest zoom was `1×`, and a photo always covered its cell. Now the zoom slider, the mouse wheel and the pinch go down to half of the "whole photo" size. A zoomed-out photo stays inside its cell, and the album background colour shows around it. The editor, the full-screen preview and the print export get the geometry from one place (`cellWindow` in `src/model/crop.ts`). The dpi warning uses the printed size of the photo.

## Requirements delivered

Both phase verdicts are `pass`. The feature-wide probe `all.json` is `pass` (14 of 14 checks).

| Id | Requirement | Phase | Outcome |
|---|---|---|---|
| R-1 | A photo can be smaller than its cell, with the album background around it (replaces C-20) | 1 | delivered |
| R-2 | The smallest size is half of the "whole photo" size. The largest zoom stays 8× (replaces the lower limit of C-21) | 1 | delivered |
| R-3 | The slider, the wheel and the pinch go down to the limit of R-2 | 1, 2 | delivered |
| R-4 | A zoomed-out photo moves on its free axis and stays fully inside the cell | 1 | delivered |
| R-5 | On an axis where the photo is larger than the cell, the photo always covers the cell | 1 | delivered |
| R-6 | A new photo in a cell starts at `1×` | 2 | delivered |
| R-7 | The editor, the preview and the export show the same size and position | 1, 2 | delivered |
| R-8 | The dpi warning uses the printed size of the photo | 1 | delivered |
| R-9 | One zoom-out gesture is one undo step | 2 | delivered |

## What broke along the way

No verdict failed, and no fix round ran. These problems came up before or around the build:

- Brief: the first edge case E-1 said that a template change keeps the zoom. The code resets every crop to `1×` on a template change (`src/model/album.ts:109`). The plan step changed the brief.
- Brief: the context quoted the requirement ids R-20 and R-21 of the earlier feature. The requirement join read them as requirements of this feature that no phase claimed. They were rewritten as "requirement 20/21".
- Feature name: on the branch `feat/album-builder`, the new feature resolved to `feat-album-builder`, the name of the archived feature. A new branch `feat/photo-zoom-out` fixed the name before the first artifact.
- Contract review by a subagent found a blocker before the build: a border-drag check used template `two`, which has no gutter. Gutters also do not show in crop mode. The check moved to template `row3`.
- Contract: a wheel step that gives "about 0.6" gave 0.5286 on this machine. Windows scales the screen to 125 %, and this enlarges each wheel step. A check that names a zoom after a wheel step depends on the scaling of the host.
- Review of the whole feature: the pinch and the wheel multiply the stored zoom, not the clamped one. After a border drag widens a cell, the stored zoom can be under the new limit. A pinch then has a dead zone at its start. No check drove this. It is not fixed.
- Recurring class from `feat-album-builder`: a value with two copies drifts. The slider had its own `MIN_ZOOM` and `MAX_ZOOM`, which phase 2 deleted. The cover-width formula still has two copies in `src/model/crop.ts` (`visibleSize` and `zoomLimits`).

## Not implemented

From the brief's Out of Scope:

- a warning about a cell that has an area of background
- a move of the photo across the cell edge
- a start zoom other than `1×` for a new photo
- a fill of the empty area with something other than the album background colour
- a change to the largest zoom (8×)

The feature dropped no requirement.
