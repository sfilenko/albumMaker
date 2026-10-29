// Finds the photos of a layout from another device: the user chooses files or a folder, the
// matching ladder pairs them with the album's photos, and each match gets new screen copies
// under its existing photo id. A photo that the ladder cannot pair gets a manual choice or a skip.
import { useState } from 'preact/hooks';
import type { PhotoMeta } from '../model/types';
import { DECODE_LIMIT, describeFile, importFiles, mapLimit, pickFiles, pickFolder } from '../photos/import';
import { matchPhotos } from '../photos/match';
import { registerOriginals } from '../photos/originals';
import type { AlbumStore } from '../state/store';
import { putDirHandle } from '../storage/db';
import { strings } from './strings';

type RowState = 'open' | 'ambiguous' | 'missing';

export function RelinkDialog({
  store,
  photoIds,
  onRelinked,
  onClose,
}: {
  store: AlbumStore;
  photoIds: string[];
  onRelinked: (photoIds: string[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Map<string, RowState>>(() => new Map(photoIds.map((id) => [id, 'open'])));
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const busy = progress !== null;
  const metas = new Map(store.album.value.photos.map((p) => [p.id, p]));

  /** Imports each file under its photo id, and returns the ids that got screen copies. */
  const relink = async (pairs: [string, File][]): Promise<string[]> => {
    const files = pairs.map(([, f]) => f);
    const ids = new Map(pairs.map(([id, f]) => [f, id] as const));
    const { metas: imported } = await importFiles(files, (done, total) => setProgress(strings.importing(done, total)), ids);
    const done = imported.map((m) => m.id);
    registerOriginals(new Map(pairs.filter(([id]) => done.includes(id))));
    if (done.length > 0) onRelinked(done);
    return done;
  };

  const run = async (files: File[]) => {
    const wanted = [...rows.keys()].map((id) => metas.get(id)).filter((m): m is PhotoMeta => m !== undefined);
    if (files.length === 0 || wanted.length === 0) return;
    setMessage(null);
    try {
      let described = 0;
      setProgress(strings.relinkSearching(0, files.length));
      // At most DECODE_LIMIT files decode at the same time, as on import.
      const candidates = await mapLimit(files, DECODE_LIMIT, async (f) => {
        const c = await describeFile(f);
        setProgress(strings.relinkSearching(++described, files.length));
        return c;
      });
      const { matched, ambiguous, missing } = matchPhotos(wanted, candidates);
      const done = await relink([...matched].map(([id, i]) => [id, files[i]]));
      setRows((prev) => {
        const next = new Map(prev);
        for (const id of done) next.delete(id);
        for (const id of ambiguous) next.set(id, 'ambiguous');
        for (const id of missing) next.set(id, 'missing');
        return next;
      });
      setMessage(strings.relinkFound(done.length));
    } finally {
      setProgress(null);
    }
  };

  const chooseFolder = async () => {
    const picked = await pickFolder();
    if (!picked) return;
    // The export finds the originals in this folder later.
    await putDirHandle(store.album.value.id, picked.dir);
    await run(picked.files);
  };

  const chooseOne = async (id: string) => {
    const [file] = await pickFiles();
    if (!file) return;
    setMessage(null);
    try {
      const done = await relink([[id, file]]);
      if (done.length === 0) setMessage(strings.relinkUnreadable(file.name));
      else
        setRows((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
    } finally {
      setProgress(null);
    }
  };

  const skip = (id: string) =>
    setRows((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });

  return (
    <div class="modal-backdrop">
      <div class="export-dialog relink-dialog" role="dialog" aria-label={strings.findPhoto} data-testid="relink-dialog">
        <div class="settings-head">
          <h2>{strings.findPhoto}</h2>
          <button type="button" data-testid="relink-close" disabled={busy} onClick={onClose}>
            {strings.done}
          </button>
        </div>
        <p class="muted">{strings.relinkIntro}</p>
        <div class="relink-actions">
          {'showDirectoryPicker' in window && (
            <button type="button" data-testid="relink-choose-folder" disabled={busy || rows.size === 0} onClick={() => void chooseFolder()}>
              {strings.relinkChooseFolder}
            </button>
          )}
          <button
            type="button"
            class="primary"
            data-testid="relink-choose-files"
            disabled={busy || rows.size === 0}
            onClick={async () => run(await pickFiles())}
          >
            {strings.relinkChooseFiles}
          </button>
        </div>
        {progress !== null && (
          <p class="progress" data-testid="relink-progress">
            {progress}
          </p>
        )}
        {message !== null && (
          <p class="note" data-testid="relink-message">
            {message}
          </p>
        )}
        {rows.size === 0 ? (
          <p class="note" data-testid="relink-all-found">
            {strings.relinkAllFound}
          </p>
        ) : (
          <ul class="relink-rows">
            {[...rows].map(([id, state]) => {
              const m = metas.get(id);
              if (!m) return null;
              return (
                <li key={id} data-testid="relink-row" data-photo={id} data-state={state}>
                  <span class="relink-name">{m.name}</span>
                  <span class="muted">
                    {strings.photoSize(m.size)} · {m.width}×{m.height} px · {strings.photoDate(m.takenAt)}
                  </span>
                  {state !== 'open' && (
                    <span class="relink-state">{state === 'ambiguous' ? strings.relinkAmbiguous : strings.relinkNotFound}</span>
                  )}
                  <span class="relink-row-actions">
                    <button type="button" data-testid="relink-choose-one" disabled={busy} onClick={() => void chooseOne(id)}>
                      {strings.relinkChooseOne}
                    </button>
                    <button type="button" data-testid="relink-skip" disabled={busy} onClick={() => skip(id)}>
                      {strings.relinkSkip}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
