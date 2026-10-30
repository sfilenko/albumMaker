# Review: feat-photo-zoom-out phase 1

_Reviewed 2026-10-30 · 5 files · `df:devflow-reviewer` · verdict at review time: pass_

## Suggestions
- **`src/model/crop.ts:13-14` and `src/model/crop.ts:20-22`** — the cover-fit width `Math.min(photoW, photoH * a)`, with `a = cell.w / cell.h`, is calculated in two places: in `visibleSize` and in `zoomLimits`. Both lines define what zoom 1 means, so they must change together. If someone changes the definition of zoom 1 in `visibleSize` only, the lower limit no longer equals half of the "whole photo" zoom, and no type error shows it. The rest of the phase keeps the geometry in one place (`cellWindow` feeds both `visiblePart` and `photoBox`).
  → extract a private `coverWidth(photoW, photoH, cell)` and call it from `visibleSize` and `zoomLimits`. `zoomLimits` then reads `whole = coverWidth(...) / Math.max(photoW, photoH * a)`.

- **`tests/unit/crop.test.ts:76-86`** — `visiblePart(...).dst` is only checked for a band at the left and the right (portrait photo, landscape cell). No unit test checks `dst` when the photo is shorter than the cell (`vy < 0`, bands at the top and the bottom). The `square150` tests at lines 68-73 and 95-100 check `photoBox` only. The export draws from `visiblePart.dst`, so a mistake on the y line of `crop.ts:59-61` (for example `y: (sy - vy)` changed, or `h` taken from `src.sw`) passes every unit test.
  → add `visiblePart(1800, 1200, square150, { cx: 0.5, cy: 0.5, zoom: min })` and expect `dst` ≈ `{ x: 37.5, y: 50, w: 75, h: 50 }`. Those are the same numbers as `photoBox` for that crop, so the test also ties the export rectangle to the editor rectangle.

- **`tests/e2e/crop.spec.ts:77-88`** — the expected lower limit comes from `zoomLimits`, which is the code under test. If `zoomLimits` returns a wrong value under 1, this test still passes, because only `expect(limit).toBeLessThan(1)` limits it. The literal values in the unit tests (`crop.test.ts:55-59`, `:88-93`) pin `zoomLimits`, so the risk is small. But this e2e test proves only that the wheel stops where the model says it stops, not where it should stop.
  → in the same `page.evaluate`, calculate the expected value from `photo.width`, `photo.height` and the cell rect with the formula itself (`min(w, h·a) / max(w, h·a) / 2`), and compare it with both `zoomLimits(...).min` and the stored zoom.

## Verifier follow-up
- `src/ui/CellToolbar.tsx:10,54,57` — the zoom slider keeps `MIN_ZOOM = 1`, but the model now allows a lower zoom. With a zoomed-out crop, `value={cell.crop.zoom}` is under `min`, so the slider shows 1, and any slider input moves the zoom to 1 or more. `tests/e2e/crop.spec.ts:94-111` still asserts a slider `min` of 1. No check in the runtime coverage list drives the slider (`AC-1.20` is the pinch, `AC-1.14` is the wheel). Possibly a later phase. Also, `CellToolbar.tsx:11` `MAX_ZOOM` is a second copy of `crop.ts:6`, and `zoomLimits(...).max` now returns that value.

## Summary
I found no `must-fix` and no `should-fix` items. The phase follows the conventions of its neighbours: `photoW`/`photoH`/`cell`/`crop` parameter order, the British `centre` spelling used in `SpreadView.tsx`, inline return-type shapes like the deleted `sourceRect`, and the `page.evaluate(import(path))` pattern used in the other e2e specs. `visiblePart` and `photoBox` share one private `cellWindow`, so the export and the editor cannot disagree on geometry. The three suggestions are about one duplicated formula and two gaps in test strength.

I read all five changed files in full, the base versions of `crop.ts` and of the two test files, and the unchanged neighbours `CellToolbar.tsx`, `PreviewMode.tsx` (the `CellPhoto` consumer), `pages.ts` (the `effectiveDpi` consumer), `types.ts` and the `.cell`/`.cell-photo` CSS. I also searched `src`, `tests` and `scripts` for a `clamp`, intersect or percent helper that already exists. `SpreadStrip.tsx:33` and `TemplatePanel.tsx:14` each have a local `pct`, but neither is exported, and the base `CellPhoto` already wrote its percentages inline. `lessons.mjs match` exited 0. It reported no lessons file in this project, so no lesson fired and none is undecided. I had the runtime coverage list (AC-1.14 to AC-1.20 and AC-1.23), so I wrote no follow-up about wheel, pan, preview, export band, dpi or pinch behaviour. No verdict, probe result or implementer narrative reached me.

## Orchestrator notes

The `/df:cycle` driver wrote this section, not the reviewer. It reconciles the follow-up items against `.devflow/probe/feat-photo-zoom-out/phase-1.json` (`outcome: pass_with_deviation`, `blocks: false`).

- **The zoom slider still stops at 1** (`src/ui/CellToolbar.tsx:10,54,57`). Nothing has driven it. The phase-1 probe has no `checks[]` row for the slider: AC-1.14 drives the wheel and AC-1.20 the pinch. The plan puts the slider in Phase 2, and the Phase 2 contract drives it in AC-2.13, AC-2.14, AC-2.15 and AC-2.18. `/df:probe phase-2` is the run that answers this item.
