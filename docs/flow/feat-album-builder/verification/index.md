# feat-album-builder — verification record

Archived 2026-10-29 · git mode · branch `feat/album-builder` · 8 phases · published at https://sfilenko.github.io/albumMaker/ (commit `7cb4e2f`)

| Phase | Base | Verdict | Blockers | Probe | Review | Unproven |
|---|---|---|---|---|---|---|
| 1 Album model | `045c959` | pass · Q-1 answered | — | skipped · deferred, closed by `all.json` | clean | — |
| 2 Undoable store and persistence | `045c959` | pass | — | skipped · deferred, closed by `all.json` | clean | — |
| 3 Photo import and matching | `045c959` | pass | — | skipped · deferred, closed by `all.json` | clean | — |
| 4 App shell and spread view | `f0e1fb0` | pass | — | pass (phase result stale) · proven by `all.json` | clean | — |
| 5 Editing interactions | `bf97b4c` | pass | — | pass (phase result stale) · proven by `all.json` | clean | — |
| 6 Settings and preview | `ede4fd3` | pass | — | pass_with_deviation (phase result stale) · proven by `all.json` | 1 must-fix, fixed | AC-6.14 substituted |
| 7 Print export | `fafa415` | pass · Q-1, Q-2 answered | — | pass (phase result stale) · proven by `all.json` | 1 must-fix, fixed | — |
| 8 Relinking, banners, PWA, publishing | `695fcba` | pass | — | pass_with_deviation (phase result stale) · proven by `all.json` | 1 must-fix, fixed | AC-8.16, 8.18, 8.19, 8.21 substituted · AC-8.25 manual |

Feature-wide probe (`probe/all.json`): `pass_with_deviation`, `blocks: false`, 60 checks (14 pass, 5 substituted, 41 carried from the earlier `all` run, 0 fail), 6 regression surfaces, 0 tripwire hits. The phase results of phases 4 to 8 are stale because later fixes moved their files. The current `all.json` proves each of these phases.

Feature check (`/df:check`, final tree): build 0 · typecheck 0 · lint none · test 0. The brief join found 44 of 44 `R-n` and 12 of 12 `E-n` claimed by a phase.

## Overrides

None. No verdict of this feature has an override.

## Not proven at runtime

- **AC-6.14** (swipe in the preview): Playwright WebKit has no finger swipe. The probe used a pointer drag in WebKit and CDP touch events in Chromium.
- **AC-8.16, AC-8.18, AC-8.19, AC-8.21** (save and open of a layout file): the probe cannot drive the native File System Access pickers. It disabled them, so the app used its download and `<input type=file>` fallback.
- **AC-8.25** (GitHub Pages serves the app at one fixed address): `manual` in the contract. On 2026-10-29 the workflow deployed commit `7cb4e2f`, and https://sfilenko.github.io/albumMaker/ opened the app in Chromium with no console errors. This was a hand check, not a contract run.
- **AC-8.2** on Windows: Git Bash rewrites `BASE_PATH=/album-builder/` to a Windows path, so the row passes with the wrong base path. With `MSYS_NO_PATHCONV=1` the build uses the right base path. The Linux CI runner is not affected.
- Review follow-ups that no run drove:
  - an export with a renamed original
  - an import when storage is full
  - the text of export errors
  - a partial pick of originals
  - a spreads export on an iPad
  - a file open when the stored album cannot be read
  - a relink that does not update the size and date of the photo.

## Open questions of the brief

- **Q-1**: does Gramofon treat page 1 as a left half or as a single right page? Does it crop or shrink a page with bleed? Both behaviours are settings. Check with Gramofon before the first print.
- **Q-2**: "fast" means that 60 thumbnails show within 2 s on a computer. Nobody checked this number.
- **Q-3**: personal acceptance: lay out one real wedding album, continue on the phone, export and upload to Gramofon.

## Decided

From `./decisions/`. These are the answers. The verdicts still carry the questions.

- **Phase 1 · Q-1** — answered 2026-10-28: "The gates are judged on the whole working tree, as DevFlow defines them. The failing run happened while Phase 3 was half built. Phase 3 is now complete and the whole tree is green (build 0, typecheck 0, test 0), so Phase 1 is verified again on that tree."
- **Phase 7 · Q-1** — answered 2026-10-29: "Show a 'Продовжити експорт' button after the originals are matched; the export (and the folder picker) starts only on that new click. Recorded in the plan's Decision Log."
- **Phase 7 · Q-2** — answered 2026-10-29: "A phone is (pointer: coarse) AND a viewport narrower than 900 px. A narrow window with a mouse exports spreads. Recorded in the plan's Decision Log."
- **Phase 8 plan gaps** — the Files list of Phase 8 grew three times during the build. The user agreed each time:
  1. `src/ui/previews.ts`, `src/ui/AlbumList.tsx` and `src/ui/styles.css`
  2. `src/photos/import.ts`
  3. `src/ui/ExportDialog.tsx` and `playwright.config.ts`
- **Test gate timeout** — the Playwright `expect` timeout is 15 s. A 9-photo import in WebKit takes 1.4 s alone. It takes up to 6.5 s while 8 tests run at the same time. The plan's Decision Log records this decision.

## Review findings not actioned

- The code has a fix for each must-fix:
  - phase 6: the `PreviewPhoto` copy
  - phase 7: the parallel decode of originals
  - phase 8: the `captureDate` copy
  - `review-all.md`: the `candidate` copy of `describe`
- `review-all.md` lists 9 should-fix items and 21 suggestions that nobody actioned. Examples:
  - the rule for printed halves is in 3 places
  - two file-name sanitizers and two download helpers
  - async dialog handlers without `catch`
  - `import.ts` reports a storage failure as "not a photo".

## Evidence

The probe results cite their evidence as `.devflow/evidence/feat-album-builder/<name>`. That directory is gone. **The files are in `./evidence/` here, under the same basename.** Read the file name of a citation, not its directory.

- Moved and **not committed**: 426 evidence files (16.5 MB), among them 168 network logs (`*.net.log`). They are in `.devflow/evidence-archive/feat-album-builder/` on the machine that ran the archive.
- **Deleted after the archive, at the user's decision on 2026-10-29: every screenshot and every export ZIP.** The project keeps no screenshots. This deleted 158 files from `./evidence/` (156 PNG and 2 ZIP, 19.6 MB). It also deleted 62 files from the local evidence archive (60 PNG and 2 ZIP, 12.7 MB). No copy of these files exists.
- The JSON evidence stays in the commit. The project's `.gitignore` excludes `*.log`, so the commit holds no console log and no network log. These logs stay in `./evidence/` and in the local evidence archive on the machine that ran the archive.
- `./evidence-index.md` lists every evidence file with its sha256 as it was at archive time. For a PNG or a ZIP, the hash is now the only record.
