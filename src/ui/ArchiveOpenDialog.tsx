// Opens an album archive. The order keeps the current album safe: check the photos, write the
// folder files, make the screen copies, and only then change the folder handle, the memory of
// originals and the session. A failure before these last steps leaves all of them as they were.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Album } from '../model/types';
import { deleteReplacedPreviews, deleteStrayPreviews, makeScreenCopies, ScreenCopyError, writeToFolder } from '../photos/archiveFolder';
import { registerOriginals } from '../photos/originals';
import { ArchiveError, type OpenedArchive } from '../storage/archive';
import { deleteDirHandle, loadAlbum, putDirHandle } from '../storage/db';
import { folderPicker } from '../storage/layoutFile';
import { forgetPreviews } from './previews';
import { strings } from './strings';

type State =
  | { step: 'verifying'; done: number; total: number }
  | { step: 'folder' }
  | { step: 'picking' }
  | { step: 'writing'; done: number; total: number }
  | { step: 'importing'; done: number; total: number }
  | { step: 'done'; undecodable: string[] }
  | { step: 'error'; message: string };

function errorMessage(e: unknown): string {
  if (e instanceof ArchiveError && e.reason === 'damaged') return strings.archiveOpenDamaged;
  if (e instanceof ScreenCopyError) return strings.archiveOpenStorage;
  return strings.archiveOpenError(e instanceof Error ? e.message : String(e));
}

export function ArchiveOpenDialog({
  opened,
  onReplace,
  onClose,
}: {
  opened: OpenedArchive;
  /** Closes the current session and opens this album. */
  onReplace: (album: Album) => Promise<void>;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ step: 'verifying', done: 0, total: 0 });
  const busy = state.step === 'verifying' || state.step === 'picking' || state.step === 'writing' || state.step === 'importing';
  // A render comes after the click, so this flag stops a second click and a close before the render.
  const running = useRef(false);
  const panel = useRef<HTMLDivElement>(null);

  // Before the first paint: the Enter key must not reach the open button behind the dialog. The
  // panel takes the focus and not a button, so that Enter starts no step of the open.
  useLayoutEffect(() => {
    panel.current?.focus();
  }, []);

  const claim = () => {
    if (running.current) return false;
    running.current = true;
    return true;
  };

  const finish = async (root: FileSystemDirectoryHandle | null) => {
    setState(root ? { step: 'writing', done: 0, total: 0 } : { step: 'importing', done: 0, total: opened.originals.size });
    const ids = opened.album.photos.map((p) => p.id);
    try {
      const replaced = await loadAlbum(opened.album.id).catch(() => undefined);
      const written = root && (await writeToFolder(root, opened, (done, total) => setState({ step: 'writing', done, total })));
      const album = written?.album ?? opened.album;
      const files = written?.files ?? opened.originals;
      setState({ step: 'importing', done: 0, total: files.size });
      const undecodable = await makeScreenCopies(files, (done, total) => setState({ step: 'importing', done, total }));

      forgetPreviews(ids);
      // An old handle can point to another photo with the same name and size.
      if (written) await putDirHandle(album.id, written.dir);
      else await deleteDirHandle(album.id);
      registerOriginals(files);
      await onReplace(album);
      forgetPreviews(await deleteReplacedPreviews(album, replaced));
      running.current = false;
      setState({ step: 'done', undecodable });
    } catch (e) {
      forgetPreviews(await deleteStrayPreviews(ids));
      running.current = false;
      setState({ step: 'error', message: errorMessage(e) });
    }
  };

  const openWithoutFolder = () => {
    if (claim()) void finish(null);
  };

  const chooseFolder = async () => {
    if (!claim()) return;
    setState({ step: 'picking' });
    let root: FileSystemDirectoryHandle;
    try {
      root = await folderPicker()!({ mode: 'readwrite' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        void finish(null);
      } else {
        running.current = false;
        setState({ step: 'error', message: errorMessage(e) });
      }
      return;
    }
    void finish(root);
  };

  useEffect(() => {
    void opened.verify((done, total) => setState({ step: 'verifying', done, total })).then(
      () => {
        // The folder picker needs a fresh click, so the person starts it. No photo needs no folder.
        if (folderPicker() && opened.originals.size > 0) setState({ step: 'folder' });
        else openWithoutFolder();
      },
      (e: unknown) => setState({ step: 'error', message: errorMessage(e) }),
    );
  }, []);

  return (
    <div class="modal-backdrop">
      <div ref={panel} class="export-dialog" role="dialog" tabIndex={-1} aria-label={strings.archiveOpenTitle} data-testid="archive-open-dialog" data-state={state.step}>
        <div class="settings-head">
          <h2>{strings.archiveOpenTitle}</h2>
          <button
            type="button"
            data-testid="archive-open-close"
            disabled={busy}
            onClick={() => {
              if (!running.current) onClose();
            }}
          >
            {strings.close}
          </button>
        </div>

        {busy && (
          <p class="progress" data-testid="archive-open-progress">
            {state.step === 'verifying' && strings.archiveOpenVerifying(state.done, state.total)}
            {state.step === 'picking' && strings.archiveOpenPicking}
            {state.step === 'writing' && strings.archiveOpenWriting(state.done, state.total)}
            {state.step === 'importing' && strings.archiveOpenImporting(state.done, state.total)}
          </p>
        )}
        {state.step === 'folder' && (
          <div class="note" data-testid="archive-open-folder">
            <p>{strings.archiveOpenFolder(opened.originals.size)}</p>
            <button type="button" class="primary" data-testid="archive-open-choose-folder" onClick={() => void chooseFolder()}>
              {strings.archiveOpenChooseFolder}
            </button>
            <button type="button" data-testid="archive-open-continue" onClick={openWithoutFolder}>
              {strings.archiveOpenContinue}
            </button>
          </div>
        )}
        {state.step === 'done' && <p class="note" data-testid="archive-open-done">{strings.archiveOpenDone}</p>}
        {state.step === 'done' && state.undecodable.length > 0 && (
          <p class="note" data-testid="archive-open-undecodable">
            {strings.archiveOpenUndecodable(state.undecodable)}
          </p>
        )}
        {state.step === 'error' && <p class="note" data-testid="archive-open-error">{state.message}</p>}
      </div>
    </div>
  );
}
