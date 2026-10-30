# feat-photo-zoom-out — verification record

Archived 2026-10-30 · git mode · branch `feat/photo-zoom-out` · 2 phases

| Phase | Base | Verdict | Blockers | Probe | Review | Unproven |
|---|---|---|---|---|---|---|
| 1 Zoom-out geometry and its readers | `1e74b0f` | pass | — | pass_with_deviation · proven by `all.json` | 0 must-fix, 0 should-fix, 3 suggestions | — |
| 2 Zoom slider and end-to-end checks | `41ce9b5` | pass | — | pass | 0 must-fix, 1 should-fix, 4 suggestions | — |

The base of phase 2 (`41ce9b5`) is the snapshot commit that `state.mjs begin` made of the dirty tree. So the work of phase 1 is in the base, not in the diff of phase 2.

Feature-wide probe (`probe/all.json`): `pass`, `blocks: false`, 14 checks (14 pass, 0 carried), 4 regression surfaces, 0 tripwire hits, 0 deviations.

Feature check (`/df:check`, final tree): build 0 · typecheck 0 · lint none · test 0 (89 unit tests, 81 end-to-end tests pass, 9 skip). The brief join found 9 of 9 `R-n` and 7 of 7 `E-n` claimed by a phase. Contract coverage: phase 1 23 of 23 rows, phase 2 19 of 19 rows. 0 gaps, 0 owed, 0 manual.

## Overrides

None. No verdict of this feature has an override.

## Probe deviations

The result of phase 1 is `pass_with_deviation`. `all.json` drove the same rows again and recorded no deviation.

- **AC-1.16**: the `given` says that one `mouse.wheel(0, 255)` sets a zoom of about 0.6. It set 0.5286, because Windows display scaling of 125 % enlarges each wheel step. The check stays valid, because 0.5286 is between the "whole photo" zoom (0.3366) and 1.
- **AC-1.20**: the `given` says desktop Chromium with `hasTouch`. The probe turned on touch in the existing browser session with CDP `Emulation.setTouchEmulationEnabled`, so the console and network capture stayed in place. The pinch used two touch points.

## Not proven at runtime

- **The arrow keys on the zoom slider.** With `step="any"`, an arrow key may not reach exactly `1`. AC-2.18 set the value directly. (Phase 2 review, verifier follow-up.)
- **A pinch or a wheel turn on a stored zoom under the current limit**, after a border drag widened the cell. The feature-wide review expects a dead zone at the start of the gesture (`src/ui/SpreadView.tsx:133-136`, `:159`). AC-1.20, AC-1.23 and AC-2.17 drive these separately.
- **A photo with no screen copy (E-6)** at runtime. Only the end-to-end gate covers it (`tests/e2e/relink.spec.ts`).
- **AC-2.14** ran in Chromium with iPhone 13 emulation, not in WebKit. The contract does not name an engine. The test gate runs `zoom-out.spec.ts` on `mobile-webkit`.
- **The pages export** (`pages/page-*.jpg`) of a zoomed-out photo. The probe examined only `spreads/spread-01.jpg`.
- **The spread strip** draws its miniatures without the crop (`src/ui/SpreadStrip.tsx`, `object-fit: cover`), so a zoomed-out photo appears there with no bands. This existed before the feature and is outside its files.

## Open questions of the brief

None.

## Decided

No `./decisions/` directory: no verdict question and no review finding needed a recorded decision. Decisions made with the user during the feature:

- 2026-10-30, brief: the feature replaces C-20 ("A photo always fills its cell") and the lower limit of C-21. The smallest size is half of the "whole photo" size. A zoomed-out photo can move, but only inside the cell. No warning about the background area before print. A new photo starts at `1×`.
- 2026-10-30, contract: the feature is named `feat-photo-zoom-out`, on the new branch `feat/photo-zoom-out`, because the old branch name resolved to the archived `feat-album-builder`.

## Review findings not actioned

No must-fix in any report.

- **Should-fix, phase 2**: the undo test (`tests/e2e/zoom-out.spec.ts:126`) starts at zoom 1 and sends one `input` event, so it cannot catch a broken undo grouping. The probe drove the behaviour at runtime (AC-2.15 in `all.json`: 12 input events, one undo, zoom 1).
- **Should-fix, `review-all.md`**: the comment on the `Crop` type (`src/model/types.ts:13`) still says "zoom (1..8)".
- 7 suggestions in `review-all.md`, 3 in phase 1 and 4 in phase 2. Examples:
  - the cover-width formula has two copies in `src/model/crop.ts`
  - the wheel test takes its expected limit from `zoomLimits`, the code under test
  - the export test does not check the dialog or the `.zip` file name.

## Evidence

The probe results cite their evidence as `.devflow/evidence/feat-photo-zoom-out/<name>`. That directory is gone. **The files are in `./evidence/` here, under the same basename.** The files of `all.json` are in `./evidence/all-20261030T115851Z/`. Read the file name of a citation, not its directory.

- Moved and **not committed**: 48 evidence files (1.7 MB), among them 32 network logs (`*.net.log`). They are in `.devflow/evidence-archive/feat-photo-zoom-out/` on the machine that ran the archive.
- **Deleted after the archive, at the user's decision on 2026-10-30: every screenshot.** The project keeps no screenshots. This deleted 31 PNG files (2.1 MB) from `./evidence/` and 8 PNG files (0.5 MB) from the local evidence archive. The feature had no export ZIP. No copy of these files exists.
- The project's `.gitignore` excludes `*.log`, so the commit holds no console log and no network log. These logs stay in `./evidence/` and in the local evidence archive.
- `./evidence-index.md` lists every evidence file with its sha256 as it was at archive time. For a PNG, the hash is now the only record.
