# Review: feat-album-builder phase 4

_Reviewed 2026-10-29 · 10 files · `df:devflow-reviewer` · verdict at review time: pass_

## Should fix
- `should-fix` — **`src/ui/App.tsx:40`** — `openSession` creates the autosaver but never calls `saver.onError`. The autosaver exposes that channel and a unit test covers it (`src/storage/autosave.ts:46`, `tests/unit/storage.test.ts:87`). App is its only consumer. Because no handler is registered, a failed IndexedDB write (quota, a WebKit private window) makes no sound. `close()` at `App.tsx:47-50` then calls `flush()` and `dispose()`, so an album that failed to save is dropped with no signal, and the user still thinks every change autosaved.
  → Register a handler in `openSession` and surface it through Session (for example, an `error` signal that the Editor top bar can read), with a `strings` key for the message. At minimum, log the error until a later phase gives it a UI.

- `should-fix` — **`src/ui/AlbumList.tsx:15-17`** (also `:20-44`) — no AlbumList handler catches anything. If `listAlbums()` rejects, `entries` stays `null`, the screen shows `strings.loading` indefinitely, and the rejection goes unhandled. `create`, `open`, `commitRename` and `remove` fail silently the same way. The other UI module in this phase does guard the same db layer: `App.tsx:66-72` catches a failed `loadAlbum` and falls back to the list. So there are now two conventions inside one phase.
  → Copy App's approach: `.catch` in `refresh` and set an empty list or an error state (a `strings` key for "could not read albums"). Wrap each async handler the same way, so a rejected promise does not escape an `onClick`.

- `should-fix` — **`tests/e2e/spread.spec.ts:51-55`** — the comment at `src/ui/SpreadView.tsx:107` says each drag gets its own coalesce key (`gutter:${e.timeStamp}`) so that one drag is one undo step. No test exercises that. The test runs drag, Ctrl+Z, drag, and `store.undo()` resets `runKey` (`src/state/store.ts:55`), so the second drag would start a fresh step even with a constant key. The regression this misses: someone changes the key back to a constant `'gutter'`, two consecutive drags merge into one history entry, and one Ctrl+Z undoes both.
  → Add a case that does two drags with no undo between them, then one Ctrl+Z, and asserts the widths equal the state after the first drag.

## Suggestions
- **`src/ui/SpreadView.tsx:161-166`** — `s.bleedMm + FOLD_X` is written three times. The fold position is already in scope as `g.foldX` (`SpreadView.tsx:79`, from `guides()` at `src/model/layout.ts:156`), and line 181 uses it for the fold line. `pages.ts:34` is a third spelling. If the canvas origin ever changes, the grey half and the fold line can drift apart. → Use `g.foldX` for the not-printed rectangles: `w: g.foldX` on the left side, `x: g.foldX, w: canvas.w - g.foldX` on the right. `g` is computed whether or not `showGuides` is set, so this needs no other change.

- **`src/ui/SpreadView.tsx:92-99` and `:185-192`** — one gutter's identity and centre are worked out in three places. `centreNow` compares refs field by field with `path.join()`. Line 192 builds a key from the same three fields with `path.join('.')`. Line 98 and line 189 hold the same centre expression. These will change together when `GutterRef` gains a field. → Define a local `gutterKey(ref)` and use it for both the `find` comparison and the `key`. Define a `centreOf(b)` and use it at both centre sites.

- **`src/ui/SpreadView.tsx:86`** — `pointerMm` locates the stage with `ref.current?.querySelector('.stage')`, but the component renders that element itself. A class rename in the CSS would quietly break dragging. → Put a second `useRef` on the `.stage` div. Separately, `ref0` (line 119) sits next to the DOM `ref` and reads as a typo. `gref` or `borderRef` would be clearer.

- **`src/ui/previews.ts:5,14`** — the shared cache never calls `URL.revokeObjectURL`. Each `full` URL keeps its Blob alive for the rest of the tab's life, across album switches and after `deleteAlbum`. Browsing a large album on a phone builds up decoded-size memory. The one other place that creates an object URL revokes it (`src/storage/layoutFile.ts:68`). → Export a `clearPreviews()` that revokes and empties `urls` and `pending`, and call it from `Session.close()` in `App.tsx:47`.

- **`src/ui/previews.ts:29-36`** — `photoId: string | null` and the `photoId === null` branch have no caller. The only call site (`SpreadView.tsx:39`) passes `meta.id`, which is a `string`. This is dead defensive code. → Narrow the parameter to `string` until a caller needs `null`.

- **`src/ui/AlbumList.tsx:73`** — `ref={(el) => el?.focus()}` is a new function on every render. Preact re-applies a changed ref, so the input is focused again on every keystroke and on any re-render, not only when the rename form opens. → Use a `useRef` plus a `useEffect` keyed on `editing`.

- **`tests/e2e/spread.spec.ts:15,78`** — `await import(path)` with a variable path is typed `any`, so `m.applyTemplate` and `m.updateSettings` escape `tsc --strict` (tests are in `tsconfig.json` `include`). A renamed model export would fail only at runtime, and with an unclear message. → Cast the result: `(await import(path)) as typeof import('../../src/model/album')`. The type-only import is erased, so the in-page import is unchanged.

- **`tests/e2e/spread.spec.ts:57`** — `waitForTimeout(600)` is a magic number tied to `DEFAULT_DELAY_MS = 300` in `src/storage/autosave.ts:4`. It is too slow when nothing is pending and too fast if the delay grows. → Poll the stored album: `expect.poll(() => page.evaluate(...import('/src/storage/db.ts').loadAlbum(id)...))` until the layout `sizes` differ from the template's. This is the in-page import technique the file already uses for `ALBUM`.

- **`tests/e2e/shell.spec.ts:22-27`** — the rename test covers only the happy path. `commitRename` refuses an empty or whitespace-only name (`AlbumList.tsx:35`), and Cancel discards the draft (`:76`). No test covers either. The regression this misses: a blank album name gets saved. → Add one case: fill `'   '`, press Enter, and assert that the old name stays after a reload.

## Verifier follow-up
- `src/ui/SpreadView.tsx:25-28` together with `src/ui/styles.css:65,73`: on the mobile layout, `.spread-area` is a block with no height, so `.spread-host` is only as tall as the stage it contains. `clientHeight / ch` then equals the current `scale`, and `min(w / cw, h / ch)` can only shrink. A phone that rotates to landscape (still below 900 px) keeps the portrait-sized spread. The desktop layout is not affected, because the grid row gives the host its height. No runtime row plans to resize or rotate the viewport.
- The redo bindings (Ctrl+Shift+Z, Ctrl+Y at `src/ui/Editor.tsx:41`), the undo and redo buttons, the `isTyping` guard (`Editor.tsx:22`), and the mobile `‹ n / N ›` spread navigation (`Editor.tsx:71-81`) are not in any e2e test or any runtime coverage row. No check plans to drive them.

## Summary
The code reads well and matches its neighbours in naming, module headers, the `declare global` placement for test hooks (as `src/harness.ts` does), and millimetre geometry from the model. The two findings most worth fixing are about error handling. The autosaver's error channel has no listener, so a failed save is silent. AlbumList catches none of the db failures that App.tsx does catch. The test gap on per-drag undo steps is the third: the current test sequence cannot detect a regression in the coalesce key. The rest are small consistency items, mostly in `SpreadView.tsx`.

`lessons.mjs match` exited 0. The project has no lessons file, so no lesson fired and none was undecided. A runtime coverage list was supplied (AC-4.9 to AC-4.18 and AC-4.19), and I dropped the follow-ups those rows cover. The prompt says a verifier has ruled. No result reached me.

Leak note: the prompt included the plan's Phase 4 section, which was supplied for file scope. I used it only for that. One difference between its wording and the code (the coalesce key) is plan conformance, so it is not a finding here. The test-coverage finding on that key rests on the code comment at `SpreadView.tsx:107`, not on the plan.

I read all ten changed files in full and these neighbours in full: `src/state/store.ts`, `src/storage/autosave.ts`, `src/storage/db.ts`, `src/model/{album,layout,pages,units,crop,types,templates}.ts`, `src/harness.ts`, `tests/e2e/{import,smoke}.spec.ts`, `playwright.config.ts`, `tsconfig.json`, and part of `src/photos/import.ts`. I read the `main.tsx` diff against the base with a pathspec.

## Orchestrator notes

Written by the `/df:cycle` driver after `/df:probe phase-4`, not by the reviewer. Source: `.devflow/probe/feat-album-builder/phase-4.json` (`outcome: pass`, 11/11 checks, `evidence.current: true`).

- **Mobile spread that can only shrink (`SpreadView.tsx:25-28`, `styles.css:65,73`): nothing has driven it.** The probe used a 390x844 viewport and did not resize or rotate it. `/df:probe phase-4` with a rotation or resize step would drive it.
- **Redo bindings, undo and redo buttons, the `isTyping` guard, the mobile `‹ n / N ›` navigation (`Editor.tsx`): runtime answered part of it.** The `regression_sweep` has "desktop editor toolbar Undo and Redo buttons ...: undo row3 -> 2 cells, redo -> 3 cells" and "mobile (390x844 touch) spread navigation: '1 / 15' -> prev -> 'Обкладинка' (1 cover cell, prev disabled) -> next twice -> '2 / 15'", both `tripwire_clean: true`. AC-4.18 drove Ctrl+Z. Nothing drove Ctrl+Shift+Z, Ctrl+Y or the `isTyping` guard. `/df:probe phase-4` would drive them.
