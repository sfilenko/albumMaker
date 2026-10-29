// The list of albums in this browser: create, open, rename and delete, and open a layout file.
import { useEffect, useState } from 'preact/hooks';
import { createAlbum, renameAlbum } from '../model/album';
import type { Album } from '../model/types';
import { deleteAlbum, listAlbums, loadAlbum, saveAlbum } from '../storage/db';
import { strings } from './strings';

type Entry = { id: string; name: string; updatedAt: number };

export function AlbumList({ onOpen, onOpenFile }: { onOpen: (a: Album) => void; onOpenFile: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const refresh = () => listAlbums().then(setEntries);
  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    const a = createAlbum(strings.newAlbum);
    await saveAlbum(a);
    onOpen(a);
  };

  const open = async (id: string) => {
    const a = await loadAlbum(id);
    if (a) onOpen(a);
  };

  const commitRename = async (id: string) => {
    const name = draft.trim();
    setEditing(null);
    const a = await loadAlbum(id);
    if (!a || name === '' || name === a.name) return;
    await saveAlbum(renameAlbum(a, name));
    await refresh();
  };

  const remove = async (e: Entry) => {
    if (!confirm(strings.confirmDelete(e.name))) return;
    await deleteAlbum(e.id);
    await refresh();
  };

  return (
    <main class="album-list" data-testid="album-list">
      <h1>{strings.appTitle}</h1>
      <div class="album-list-head">
        <h2>{strings.albums}</h2>
        <span class="actions">
          <button type="button" data-testid="open-file" onClick={onOpenFile}>
            {strings.openFile}
          </button>
          <button type="button" class="primary" data-testid="create-album" onClick={create}>
            {strings.createAlbum}
          </button>
        </span>
      </div>
      {entries === null && <p>{strings.loading}</p>}
      {entries?.length === 0 && <p class="muted">{strings.noAlbums}</p>}
      <ul>
        {entries?.map((e) => (
          <li key={e.id} data-testid="album-item">
            {editing === e.id ? (
              <form
                class="rename"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void commitRename(e.id);
                }}
              >
                <input
                  aria-label={strings.renameLabel}
                  data-testid="rename-input"
                  value={draft}
                  onInput={(ev) => setDraft((ev.target as HTMLInputElement).value)}
                  ref={(el) => el?.focus()}
                />
                <button type="submit">{strings.save}</button>
                <button type="button" onClick={() => setEditing(null)}>
                  {strings.cancel}
                </button>
              </form>
            ) : (
              <>
                <button type="button" class="album-name" data-testid="album-name" onClick={() => open(e.id)}>
                  {e.name}
                </button>
                <span class="muted">{strings.updatedAt(new Date(e.updatedAt))}</span>
                <span class="actions">
                  <button type="button" onClick={() => open(e.id)}>
                    {strings.open}
                  </button>
                  <button
                    type="button"
                    data-testid="rename-album"
                    onClick={() => {
                      setDraft(e.name);
                      setEditing(e.id);
                    }}
                  >
                    {strings.rename}
                  </button>
                  <button type="button" data-testid="delete-album" onClick={() => remove(e)}>
                    {strings.delete}
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
