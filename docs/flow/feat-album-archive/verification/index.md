# feat-album-archive — verification record

Archived 2026-11-02 · git mode · branch `feat/album-archive` · 3 phases

| Phase | Base | Verdict | Blockers | Probe | Review | Unproven |
|---|---|---|---|---|---|---|
| 1 The archive format | `71bad52` | pass | — | skipped · deferred, closed by `all.json` | 0 must-fix, 4 should-fix, 6 suggestions | — |
| 2 Save an archive from the editor | `71bad52` | pass · Q-1, Q-2 answered | — | pass · proven by `all.json` | 1 must-fix fixed, 4 should-fix, 8 suggestions | — |
| 3 Open an archive on any device | `626fdaa` | pass | — (B-1 fixed in an earlier round) | pass · proven by `all.json` | 0 must-fix, 6 should-fix, 6 suggestions | AC-3.30, AC-3.34, AC-3.35 manual, not run |

Feature-wide review (`review/review-all.md`): 0 must-fix, 6 should-fix, 13 suggestions. The person asked for a fix of all findings. A later verifier read the code against the plan. If a finding did not apply any more, the builder made no change.

The base of phase 3 (`626fdaa`) is the snapshot commit that `state.mjs begin` made of the dirty tree. So the work of phases 1 and 2 is in the base. All work of this feature was uncommitted when the verdicts ran.

Feature-wide probe (`probe/all.json`): `pass_with_deviation`, `blocks: false`, 53 checks (42 pass, 11 substituted, 0 fail, 0 carried), 24 regression surfaces, 0 tripwire hits, 5 deviations.

Feature check (`/df:check`, final tree): build 0 · typecheck 0 · lint none · test 0. The test gate gave 203 unit passes, 230 end-to-end passes and 40 skips. The brief join found 16 of 16 `R-n` and 15 of 15 `E-n` claimed by a phase. Each contract row has an owner.

## Overrides

None. No verdict of this feature has an override.

## Probe deviations

From `probe/all.json`:

- **`substituted_facet`**: AC-3.16, AC-3.18, AC-3.19, AC-3.21, AC-3.26, AC-3.27, AC-3.28, AC-3.31, AC-3.36, AC-3.37 and AC-3.38 ran only on desktop Chromium. A tool cannot drive the system dialog of `showOpenFilePicker`. So a stub supplied the file, or the driver deleted the picker function and the app used its file input.
- **AC-3.27**: the row failed two times at one driver step, then passed on the same code after a change to the driver. The old driver read `window.__store` directly after a reload, before the app set it. The prober recorded a race in the driver, not a product failure.
- **AC-2.33**: after 30 Tab presses, the focus was on `archive-close`, so the Enter of the row closed the dialog. The album JSON was equal after the Tab presses and after Enter.
- **Pixels on desktop**: at 1280 px and 900 px, 18 pixels at the rounded corners of one thumb differ after the save dialog opens. The largest channel difference is 5 of 255, and it stays after the close. Element boxes are equal. The prober did not find the cause, and it set the limit of 8 after it saw this result. So this assertion does not prove that the pixels are equal.
- **Double-click measures**: the file input route gave 2 file choosers and 0 alerts. A stub that refuses each call gave 2 calls and 2 alerts. A cancel of a held picker gave 0 alerts, and the next click started a new picker.

## Not proven at runtime

Manual rows, not run by anyone:

- **AC-3.30 (blocking row, R-13)**: 300 photos and about 1.5 GB on a real phone. The phones are an iPhone, in Safari and in Home Screen mode, and an Android phone. This row also answers Q-1, and whether an iPhone gives a file of another size on a new selection.
- **AC-3.34 (blocking row, R-10)**: the print export of a large album after a reload, in real Chrome with a real folder.
- **AC-3.35 (R-2)**: a real ZIP tool lists an archive, and Safari on a Mac keeps the `.album.zip` file.

Also:

- The save picker and the folder picker ran only as stubs. The open picker ran with a real system dialog only for the double click (AC-3.43, headed Chromium).
- The phone rows ran in WebKit or Chromium emulation. Emulation does not have the memory limit of a phone.
- No test drives the relink route into the check of R-16. It uses the same check as the print export route, because the check reads what `readOriginals` gives.

## Open questions

- **Q-1 of the brief**: can a real iPhone and a real Android phone save and read a 1.5 GB ZIP in the browser? Nobody measured this. If they cannot, the app must state a limit. Blocks R-13.

## Decided

From `./decisions/`, and from the person's answers during the feature:

- **Phase 2 · Q-1** — the person chose: the archive also asks about a close file from an earlier dialog (R-16, AC-2.31).
- **Phase 2 · Q-2** — the person chose: the undo and redo keys stop while the archive save dialog is open. The print export dialog does not change (E-14, AC-2.32).
- **Phase 2 · Q-1, later round** — the brief answers this. R-5 asks for a count at the first request. R-6 asks for names when an original is still not found.
- **Phase 2 · Q-2, later round** — phase 3 owns the `SecurityError` branch of the print export dialog, in its step 8.
- **Phase 2 · Q-1, first round** — the history and action buttons keep `font-size: 13px` and `flex: none` at phone widths.
- **R-15, R-16** — the orchestrator proposed both after the feature-wide review, and the person asked for a fix of all findings. Both are easy to reverse.

## Evidence

The probe results cite their evidence as `.devflow/evidence/feat-album-archive/<name>`. That directory is gone. **The files are in `./evidence/` here, under the same basename.** The files of `all.json` are in `./evidence/all-20261101T212520Z/`. Read the file name of a citation, not its directory.

- Moved and **not committed**: 1048 evidence files (39.6 MB). They are in `.devflow/evidence-archive/feat-album-archive/` on the machine that ran the archive.
- **Deleted after the archive, at the user's decision on 2026-11-02: every screenshot.** The project keeps no screenshots. This deleted 92 PNG files (8.4 MB) from `./evidence/` and 325 PNG files (32.5 MB) from the local evidence archive. The evidence had no ZIP file. No copy of these files exists.
- The project's `.gitignore` excludes `*.log`, so the commit holds no console log and no network log. These logs stay in `./evidence/` and in the local evidence archive.
- `./evidence-index.md` lists every evidence file with its sha256 as it was at archive time. For a PNG, the hash is now the only record.
