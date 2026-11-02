// The album archive: the count of used photos, a request for originals that this session cannot
// read, then two clicks. The first click builds the Blob. The second click starts the download or
// calls the save picker, so each browser gets a fresh click and no file exists before the build.
// The album in the store does not change. The editor sets the save time through `onSaved`.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PhotoMeta } from '../model/types';
import { pickFiles } from '../photos/import';
import { forgetOriginal, isExactOriginal, MissingOriginalsError, readOriginals, registerChosenOriginals } from '../photos/originals';
import type { AlbumStore } from '../state/store';
import {
  archivableAlbum,
  archivablePhotos,
  ArchiveError,
  archiveFileName,
  buildArchive,
  saveArchiveBlob,
  UnreadablePhotoError,
} from '../storage/archive';
import type { PickerWindow } from '../storage/layoutFile';
import { strings } from './strings';

/** Why the last round of the file chooser left photos with no file. */
interface RoundNotes {
  unmatched: string[];
  ambiguous: string[];
  sameName: string[];
}

const NO_NOTES: RoundNotes = { unmatched: [], ambiguous: [], sameName: [] };

type InexactState = RoundNotes & { step: 'inexact'; photos: PhotoMeta[]; left: string[] };

type State =
  | { step: 'ready' }
  | { step: 'running'; done: number; total: number }
  | { step: 'matching'; done: number; total: number }
  | (RoundNotes & { step: 'originals'; photoIds: string[]; unreadable: string | null })
  | InexactState
  | { step: 'matched' }
  | { step: 'link'; blob: Blob }
  | { step: 'picking' }
  | { step: 'writing'; done: number; total: number }
  | { step: 'done'; message: string }
  | { step: 'error'; message: string };

const hasSavePicker = () => Boolean((window as unknown as PickerWindow).showSaveFilePicker);

function errorState(e: unknown): State {
  if (e instanceof ArchiveError && e.reason === 'too-large') return { step: 'error', message: strings.archiveTooLarge };
  return { step: 'error', message: strings.archiveError(e instanceof Error ? e.message : String(e)) };
}

/** The request for the photos in `left`. The save goes on only on a new click. */
function afterRound(left: string[], { unmatched, ambiguous, sameName }: RoundNotes): State {
  return left.length > 0
    ? { step: 'originals', photoIds: left, unmatched, ambiguous, sameName, unreadable: null }
    : { step: 'matched' };
}

export function ArchiveSaveDialog({
  store,
  onSaved,
  onClose,
}: {
  store: AlbumStore;
  /** Gets the save time after a saved result and after a received result. */
  onSaved: (at: number) => void;
  onClose: () => void;
}) {
  const album = store.album.value;
  const [state, setState] = useState<State>({ step: 'ready' });
  const busy = state.step === 'running' || state.step === 'matching' || state.step === 'picking' || state.step === 'writing';
  // A render comes after the click, so this flag stops a second click and a close before the render.
  const running = useRef(false);
  // The photos whose close file the person accepted. A new dialog asks again.
  const accepted = useRef(new Set<string>());
  const panel = useRef<HTMLDivElement>(null);

  // Before the first paint: the editor behind the dialog is inert, so the focus must leave it. The
  // panel takes the focus and not a button, so that Enter starts no step of the save.
  useLayoutEffect(() => {
    panel.current?.focus();
  }, []);

  const claim = () => {
    if (running.current) return false;
    running.current = true;
    return true;
  };

  const start = async () => {
    setState({ step: 'running', done: 0, total: 0 });
    const current = store.album.value;
    try {
      // The originals come under the names in the album. Only the archive holds the changed names.
      const used = archivablePhotos(current);
      const originals = await readOriginals(current.id, used);
      // The print export and the relink dialog can put a close file in memory with no question.
      const inexact = used.filter((p) => !accepted.current.has(p.id) && !isExactOriginal(originals.get(p.id)!, p));
      if (inexact.length > 0) {
        setState({ step: 'inexact', photos: inexact, left: [], ...NO_NOTES });
        return;
      }
      const blob = await buildArchive(archivableAlbum(current, Date.now()), originals, (done, total) =>
        setState({ step: 'running', done, total }),
      );
      setState({ step: 'link', blob });
    } catch (e) {
      if (e instanceof MissingOriginalsError) {
        setState({ step: 'originals', photoIds: e.photoIds, unreadable: null, ...NO_NOTES });
      } else if (e instanceof UnreadablePhotoError) {
        forgetOriginal(e.photoId);
        const name = current.photos.find((p) => p.id === e.photoId)?.name ?? e.photoId;
        setState({ step: 'originals', photoIds: [e.photoId], unreadable: name, ...NO_NOTES });
      } else {
        setState(errorState(e));
      }
    }
  };

  const chooseOriginals = async (photoIds: string[]) => {
    const files = await pickFiles();
    if (files.length === 0) return;
    setState({ step: 'matching', done: 0, total: files.length });
    const wanted = store.album.value.photos.filter((p) => photoIds.includes(p.id));
    const { left, inexact, unmatched, ambiguous, sameName } = await registerChosenOriginals(wanted, files, (done, total) =>
      setState({ step: 'matching', done, total }),
    );
    const notes = { unmatched, ambiguous, sameName };
    const leftIds = left.map((p) => p.id);
    setState(inexact.length > 0 ? { step: 'inexact', photos: inexact, left: leftIds, ...notes } : afterRound(leftIds, notes));
  };

  const acceptInexact = ({ photos, left, unmatched, ambiguous, sameName }: InexactState) => {
    for (const p of photos) accepted.current.add(p.id);
    setState(afterRound(left, { unmatched, ambiguous, sameName }));
  };

  const chooseOtherFiles = ({ photos, left, unmatched, ambiguous, sameName }: InexactState) => {
    for (const p of photos) forgetOriginal(p.id);
    setState(afterRound([...photos.map((p) => p.id), ...left], { unmatched, ambiguous, sameName }));
  };

  const save = async (blob: Blob) => {
    if (!claim()) return;
    if (hasSavePicker()) setState({ step: 'picking' });
    try {
      const result = await saveArchiveBlob(blob, archiveFileName(store.album.value), (done) =>
        setState({ step: 'writing', done, total: blob.size }),
      );
      running.current = false;
      onSaved(Date.now());
      setState({ step: 'done', message: result === 'saved' ? strings.archiveSaved : strings.archiveReceived });
    } catch (e) {
      running.current = false;
      // A cancel keeps the built archive: the person can click again with no second build.
      setState(e instanceof DOMException && e.name === 'AbortError' ? { step: 'link', blob } : errorState(e));
    }
  };

  const close = () => {
    if (!running.current) onClose();
  };

  return (
    <div class="modal-backdrop">
      <div ref={panel} class="export-dialog" role="dialog" tabIndex={-1} aria-label={strings.archiveTitle} data-testid="archive-dialog" data-state={state.step}>
        <div class="settings-head">
          <h2>{strings.archiveTitle}</h2>
          <button type="button" data-testid="archive-close" disabled={busy} onClick={close}>
            {strings.close}
          </button>
        </div>

        <p class="muted" data-testid="archive-count">{strings.archiveCount(archivablePhotos(album).length)}</p>

        {state.step === 'running' && (
          <p class="progress" data-testid="archive-progress">
            {strings.archiveProgress(state.done, state.total)}
          </p>
        )}
        {state.step === 'matching' && (
          <p class="progress" data-testid="archive-matching">
            {strings.archiveMatching(state.done, state.total)}
          </p>
        )}
        {state.step === 'originals' && (
          <div class="note" data-testid="archive-need-originals">
            <p>{strings.archiveNeedOriginals(state.photoIds.length)}</p>
            {state.unreadable !== null && <p>{strings.archiveUnreadable(state.unreadable)}</p>}
            {state.unmatched.length > 0 && <p>{strings.archiveUnmatched(state.unmatched)}</p>}
            {state.ambiguous.length > 0 && <p>{strings.originalsAmbiguous(state.ambiguous)}</p>}
            {state.sameName.length > 0 && <p>{strings.originalsSameName(state.sameName)}</p>}
            <button type="button" class="primary" data-testid="archive-choose-originals" onClick={() => void chooseOriginals(state.photoIds)}>
              {strings.chooseOriginals}
            </button>
          </div>
        )}
        {state.step === 'inexact' && (
          <div class="note" data-testid="archive-inexact">
            <p>{strings.archiveInexact([...new Set(state.photos.map((p) => p.name))])}</p>
            <button type="button" class="primary" data-testid="archive-inexact-accept" onClick={() => acceptInexact(state)}>
              {strings.archiveInexactAccept}
            </button>
            <button type="button" data-testid="archive-inexact-choose" onClick={() => chooseOtherFiles(state)}>
              {strings.archiveInexactChoose}
            </button>
          </div>
        )}
        {state.step === 'matched' && (
          <div class="note" data-testid="archive-originals-found">
            <p>{strings.originalsFound}</p>
            <button type="button" class="primary" data-testid="archive-continue" onClick={() => void start()}>
              {strings.archiveContinue}
            </button>
          </div>
        )}
        {state.step === 'link' && (
          <div class="note" data-testid="archive-link">
            <p>{strings.archiveReady}</p>
            <button type="button" class="primary" data-testid="archive-save" onClick={() => void save(state.blob)}>
              {hasSavePicker() ? strings.archiveSave : strings.archiveDownload}
            </button>
          </div>
        )}
        {state.step === 'picking' && <p class="progress">{strings.archivePicking}</p>}
        {state.step === 'writing' && (
          <p class="progress" data-testid="archive-write-progress">
            {strings.archiveWriting(state.done, state.total)}
          </p>
        )}
        {state.step === 'done' && <p class="note" data-testid="archive-done">{state.message}</p>}
        {state.step === 'error' && <p class="note" data-testid="archive-error">{state.message}</p>}

        {(state.step === 'ready' || state.step === 'error') && (
          <button type="button" class="primary" data-testid="archive-start" onClick={() => void start()}>
            {strings.archiveStart}
          </button>
        )}
      </div>
    </div>
  );
}
