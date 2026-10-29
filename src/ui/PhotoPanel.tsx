// The photo column: import, the used counter, thumbnails in name order, tap-to-place,
// the drop target that empties a cell, and the photos that this device does not have.
import { useEffect, useRef, useState } from 'preact/hooks';
import { addPhotos, clearCell, newId, photoUsage, removePhoto } from '../model/album';
import type { PhotoMeta } from '../model/types';
import { importFiles, pickFiles, pickFolder } from '../photos/import';
import { registerOriginals } from '../photos/originals';
import type { AlbumStore } from '../state/store';
import { putDirHandle } from '../storage/db';
import { armedPhoto, registerDropTarget, startDrag } from './dnd';
import { usePreviewUrl } from './previews';
import { strings } from './strings';

const hasFolderPicker = () => 'showDirectoryPicker' in window;

function Thumb({ meta, uses, missing }: { meta: PhotoMeta; uses: number; missing: boolean }) {
  const url = usePreviewUrl(meta.id, 'thumb');
  const ref = useRef<HTMLButtonElement>(null);
  const armed = armedPhoto.value === meta.id;
  return (
    <button
      type="button"
      ref={ref}
      class={`thumb${uses > 0 ? ' used' : ''}${armed ? ' armed' : ''}${missing ? ' missing' : ''}`}
      data-testid={`photo-${meta.name}`}
      data-uses={uses}
      data-missing={missing}
      title={meta.name}
      onPointerDown={(e) => ref.current && startDrag(e, { kind: 'photo', photoId: meta.id }, ref.current)}
      onClick={() => (armedPhoto.value = armed ? null : meta.id)}
    >
      {url && !missing ? <img src={url} alt={meta.name} draggable={false} /> : <span class="thumb-name">{meta.name}</span>}
      {uses > 0 && (
        <span class="used-mark" aria-label={strings.usedMark}>
          ✓{uses > 1 ? ` ${strings.usedTimes(uses)}` : ''}
        </span>
      )}
    </button>
  );
}

export function PhotoPanel({
  store,
  missing,
  onFindPhotos,
}: {
  store: AlbumStore;
  /** Photos that have no screen copy on this device. */
  missing: ReadonlySet<string>;
  onFindPhotos: (photoIds: string[]) => void;
}) {
  const album = store.album.value;
  const usage = photoUsage(album);
  const used = album.photos.filter((p) => (usage.get(p.id) ?? 0) > 0).length;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const panel = useRef<HTMLElement>(null);
  const armed = album.photos.find((p) => p.id === armedPhoto.value) ?? null;
  const missingIds = album.photos.filter((p) => missing.has(p.id)).map((p) => p.id);

  useEffect(() => {
    if (!panel.current) return;
    return registerDropTarget(
      panel.current,
      (p) => p.kind === 'cell',
      (p) => p.kind === 'cell' && store.dispatch((a) => clearCell(a, p.ref)),
    );
  }, [store]);

  const run = async (files: File[]) => {
    if (files.length === 0) return;
    const ids = new Map(files.map((f) => [f, newId()] as const));
    setSkipped([]);
    try {
      const { metas, skipped: names } = await importFiles(files, (done, total) => setProgress({ done, total }), ids);
      registerOriginals(new Map(metas.map((m) => [m.id, files.find((f) => ids.get(f) === m.id)!] as const)));
      store.dispatch((a) => addPhotos(a, metas));
      setSkipped(names);
    } finally {
      setProgress(null);
    }
  };

  const addFolder = async () => {
    const picked = await pickFolder();
    if (!picked) return;
    await putDirHandle(album.id, picked.dir);
    await run(picked.files);
  };

  const remove = (meta: PhotoMeta) => {
    if (!confirm(strings.confirmRemovePhoto(meta.name))) return;
    armedPhoto.value = null;
    store.dispatch((a) => removePhoto(a, meta.id));
  };

  return (
    <aside class="panel photo-panel" data-testid="photo-panel" aria-label={strings.tabPhotos} ref={panel}>
      <div class="panel-head">
        {hasFolderPicker() && (
          <button type="button" data-testid="add-folder" disabled={progress !== null} onClick={addFolder}>
            {strings.addFolder}
          </button>
        )}
        <button type="button" data-testid="add-photos" disabled={progress !== null} onClick={async () => run(await pickFiles())}>
          {strings.addPhotos}
        </button>
      </div>
      {progress && (
        <div class="progress" data-testid="import-progress">
          <span>{strings.importing(progress.done, progress.total)}</span>
          <progress max={progress.total} value={progress.done} />
        </div>
      )}
      {skipped.length > 0 && (
        <p class="note" data-testid="skipped-note">
          <span>{strings.skipped(skipped)}</span>
          <button type="button" aria-label={strings.close} onClick={() => setSkipped([])}>
            ×
          </button>
        </p>
      )}
      {missingIds.length > 0 && (
        <div class="missing-bar" data-testid="missing-bar">
          <span>{strings.missingPhotos(missingIds.length)}</span>
          <button type="button" class="primary" data-testid="find-missing" onClick={() => onFindPhotos(missingIds)}>
            {strings.findPhoto}
          </button>
        </div>
      )}
      <p class="counter" data-testid="photo-counter">
        {strings.used(used, album.photos.length)}
      </p>
      {armed && (
        <div class="armed-bar" data-testid="armed-bar">
          <span>{strings.armed(armed.name)}</span>
          <button type="button" data-testid="remove-photo-from-album" onClick={() => remove(armed)}>
            {strings.removeFromAlbum}
          </button>
        </div>
      )}
      {album.photos.length === 0 ? (
        <p class="muted">{strings.noPhotos}</p>
      ) : (
        <div class="thumbs">
          {album.photos.map((m) => (
            <Thumb key={m.id} meta={m} uses={usage.get(m.id) ?? 0} missing={missing.has(m.id)} />
          ))}
        </div>
      )}
    </aside>
  );
}
