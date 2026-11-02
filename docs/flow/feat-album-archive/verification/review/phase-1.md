# Review: feat-album-archive phase 1

_Reviewed 2026-11-01 · 2 files · `df:devflow-reviewer` · verdict at review time: pass_

## Should fix
- `should-fix` — **`src/storage/archive.ts:96`** — `archiveFileName` copies the regex and the `'album'` fallback of the private `fileName` at `src/storage/layoutFile.ts:48`. Only the extension differs. A third variant is at `src/export/export.ts:55`. It also collapses runs of marks and trims, so `a::b` is `a_b` in an export and `a__b` here. A later change to the character rule (for example, adding a control character or a trailing dot) has to find each copy, or a layout file and an archive of one album get different base names.
  → In `layoutFile.ts`, export one function that takes the album and the extension, with the same regex and the same fallback. Call it from `fileName` and from `archiveFileName`. `archive.ts` already imports from `./layoutFile` (line 7). This edit touches a file outside this phase's list, so it may belong to a small follow-up. Leave `safeName` as it is: its `+`, its `.trim()` and its `export-` prefix are different behaviour, and changing them changes the names of existing exports. The cases at `tests/unit/archive.test.ts:506-511` stay valid.

- `should-fix` — **`src/storage/archive.ts:300`** and **`src/storage/archive.ts:56`** — The doc comments give a closed list of errors: "Throws ArchiveError or LayoutFileError", and for `verify`, "Throws ArchiveError('damaged')". The reads at lines 290, 307 and 332 let a raw `DOMException` through when the file changed or went away, for example a file on a cloud drive that `verify` reads long after the open. The write side does map this case (line 212), and line 36 says that `reason` lets the interface show a message for each case. An interface written against this comment has no branch for the read failure.
  → Add the read failure to both comments, so the next phase handles it: "A failed read of the file rejects with the browser's DOMException." Do not map it to `damaged`, because that tells the user that a good archive is corrupt. Add a test that uses the `UnreadableBlob` pattern at `tests/unit/archive.test.ts:392-401`.

- `should-fix` — **`tests/unit/archive.test.ts:419`** — The memory rule is the reason this module exists (`src/storage/archive.ts:2-4`), and only the build side has a test for it. The regression: `verify` or `readArchive` calls `arrayBuffer()` on a whole photo. Each current test still goes green, because the photos are small, and a 1.5 GB archive fails on a phone.
  → Add a read-side test with a 3 MB photo. Spy on `Blob.prototype.arrayBuffer` after `archiveOf` returns, because `archiveOf` reads the whole blob through `bytesOf`. Run `readArchive` and `verify`. Assert from `mock.contexts` that each blob read is at most 1 MB, apart from the end-of-file read in `readDirectory`, which is at most 65,557 bytes.

- `should-fix` — **`tests/unit/archive.test.ts:304`** — The reader has refusals that no test reaches: the multi-disk fields (`src/storage/archive.ts:259`), a bad central signature or a count that is too high (`:270`), the encrypted flag and `packed !== size` (`:277`), a name that overruns the directory (`:280`), a bad local header (`:291`) and content that overruns the directory (`:293`). The regression: someone removes or weakens one of these. A crafted or damaged file then gives a `RangeError` from `DataView`, or a `File` that holds the wrong bytes, instead of `ArchiveError('zip')`.
  → Use the method of line 306, which patches one field in a built archive and expects `zip`. One table-driven test can cover all seven cases, and the offsets are few.

## Suggestions
- **`src/storage/archive.ts:227`** — `a.lastFileSaveAt ?? a.updatedAt` is a fallback that no caller reaches. The comment at line 186 says that `a` comes from `archivableAlbum`, which always sets a number (line 92), and each test goes through that function. The fallback exists because the type allows `null`, and it would silently date the layout entry with the wrong time.
  → Keep the type honest with a named parameter or a narrowed type, or add a one-line comment that says why the fallback is there.

- **`src/storage/archive.ts:211`** — The bare `catch` also catches an error from the caller's `onProgress`, because `crc32OfBlob` calls it inside the `try` (line 210). A bug in a progress handler then tells the user that a photo cannot be read.
  → Use the form of `src/photos/import.ts:42-45`: test `e instanceof DOMException`, and `throw e` for anything else. The `e.name === 'AbortError'` part does not carry across, because a read can fail with `NotReadableError` or `NotFoundError`. The test at `tests/unit/archive.test.ts:394` rejects with a `DOMException`, so it stays valid.

- **`src/storage/archive.ts:204-215`** and **`src/storage/archive.ts:328-335`** — These are the same loop: sum the sizes, call `onProgress(0, total)`, run `crc32OfBlob` with `done + n`, add the size to `done`. They share one progress contract, and `tests/unit/archive.test.ts:450` already asserts that the two give identical sequences, so they will change together.
  → Extract a helper that takes the files and `onProgress` and calls back with the CRC of each file. The `try` for `UnreadablePhotoError` stays on the build side.

- **`src/storage/archive.ts:255`** — This loop condition holds two tests and the comment-length sum on one line. `readDirectory` also does two jobs: it finds the end record and it parses the directory.
  → Extract `findEndRecord`, with a named `reachesEndOfFile` for the second half of the condition.

- **`src/storage/archive.ts:273-282`** — The central-header offsets are bare numbers, and the writer spells the same layout differently (`6` + `at + 10` in `writeSharedFields` is `at + 16` here). `src/export/jpeg.ts:7-9` names its main offsets (`UNITS_AT`), although it also has some literal offsets. A wrong offset on one side is a defect that only a round trip with a second reader finds.
  → Name the central-header offsets once, as constants next to `CENTRAL_HEADER_BYTES`, and use them on both sides.

- **`tests/unit/archive.test.ts:123`** — `reasonOf` returns `undefined` for no throw and also for a throw that is not an `ArchiveError`. So the "accepts" cases at lines 375-377 stay green if `assertFitsArchive` throws a `TypeError`.
  → Use `expect(() => assertFitsArchive(...)).not.toThrow()` for those three lines.

## Verifier follow-up
- **`src/storage/archive.ts:76-93`** against **`src/storage/archive.ts:315`** — The writer accepts a name that the reader refuses. `a\b.jpg` is a legal file name on macOS and Linux, and `src/photos/import.ts:9` and `:136` let it in, as does an album opened from a `.album.json` file with any name. `archivableAlbum` and `buildArchive` save that photo without an error, and then `readArchive` refuses the whole archive with `content`. The user finds out only at the open, possibly after deleting the album on the saving device. The tests at `tests/unit/archive.test.ts:345-355` cover the refusal only, not a build of such a name, and no probe row drives this phase.

## Summary
Nothing here reaches the top severity. There are four should-fix findings: a copied file-name helper, a doc comment that omits the read failure, and two test gaps (the read-side memory rule and seven reader refusals). The main correctness tip is under `Verifier follow-up`: a photo name with a backslash saves and then cannot be opened.

I read both changed files in full. I also read `src/storage/layoutFile.ts`, `src/storage/autosave.ts`, `src/storage/db.ts`, `src/export/export.ts`, the head of `src/export/jpeg.ts` and `src/photos/import.ts`, and part of `tests/unit/storage.test.ts`. The error classes, the `reason` pattern, the local naming and the flat `test()` style match these neighbours. The module's own ZIP writer does not duplicate the fflate use in `export.ts`, because `export.ts:89` reads each file whole, and this module exists to avoid that.

The runtime coverage list is empty: the contract has no probe row for this phase, so no check is planned to drive this code at runtime. `lessons.mjs match` exited 0 and reported that this project has no lessons file, so no lesson fired. The prompt held a plan section marked for scope only. I used it only to see which files are in bounds, and it changed no finding. No verdict, probe result, or implementer narrative reached me.

## Orchestrator notes

These notes are from the main session, not from the reviewer. They compare the `Verifier follow-up` section with `probe/feat-album-archive/all.json` (`outcome: pass`, 39 checks).

- `src/storage/archive.ts:76-93` against `:315` (a photo name with a backslash): nothing has driven it at runtime. `all.json` has no row or sweep surface with such a name. The follow-up item went to `/df:build fix`, and the writer now replaces this character. Unit tests in `tests/unit/archive.test.ts` cover the fix. A new contract row and `/df:probe all` would drive it in a browser.
