// The start screen is the album list. Opening an album creates its store and autosaver.
// A layout file opens here too, from the list or from the editor.
import { signal, type ReadonlySignal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import type { Album } from '../model/types';
import { createAlbumStore, type AlbumStore } from '../state/store';
import { createAutosaver, restoreBackups } from '../storage/autosave';
import { loadAlbum, requestPersistence, saveAlbum } from '../storage/db';
import { LayoutFileError, openLayoutFile } from '../storage/layoutFile';
import { AlbumList } from './AlbumList';
import { Editor } from './Editor';
import { strings } from './strings';

const LAST_ALBUM_KEY = 'lastAlbumId';

declare global {
  interface Window {
    __store?: AlbumStore;
  }
}

function remember(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(LAST_ALBUM_KEY);
    else localStorage.setItem(LAST_ALBUM_KEY, id);
  } catch {
    // Storage can be off (a private window). The app still works; it only forgets the album.
  }
}

function lastAlbumId(): string | null {
  try {
    return localStorage.getItem(LAST_ALBUM_KEY);
  } catch {
    return null;
  }
}

interface Session {
  key: number;
  store: AlbumStore;
  /** True after a save to IndexedDB failed, until a later save succeeds. */
  storageError: ReadonlySignal<boolean>;
  close(): Promise<void>;
}

let sessions = 0;

/** `unsaved`: the album is not in IndexedDB yet (it comes from a layout file), so save it now. */
function openSession(album: Album, unsaved = false): Session {
  const store = createAlbumStore(album);
  const storageError = signal(false);
  const saver = createAutosaver(async (a) => {
    await saveAlbum(a);
    storageError.value = false;
  });
  saver.onError(() => (storageError.value = true));
  let fileSaveAt = album.lastFileSaveAt;
  const off = store.subscribe((a) => {
    if (fileSaveAt !== null && (a.lastFileSaveAt ?? 0) < fileSaveAt) {
      // Undo and redo bring back an album from before the last file save. The save still
      // happened, and the layout now differs from the file.
      store.replace({ ...a, lastFileSaveAt: fileSaveAt, updatedAt: Math.max(a.updatedAt, Date.now()) });
      return;
    }
    fileSaveAt = a.lastFileSaveAt;
    saver.schedule(a);
  });
  if (unsaved) saver.schedule(album);
  void requestPersistence();
  remember(album.id);
  if (import.meta.env.DEV) window.__store = store;
  return {
    key: ++sessions,
    store,
    storageError,
    async close() {
      off();
      await saver.flush();
      saver.dispose();
      if (import.meta.env.DEV && window.__store === store) window.__store = undefined;
    },
  };
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    // A copy that the last page kept at reload or close goes into IndexedDB before any read.
    void restoreBackups(saveAlbum)
      .then(async () => {
        const id = lastAlbumId();
        if (id === null) return;
        const a = await loadAlbum(id);
        if (a) setSession(openSession(a));
        else remember(null);
      })
      .catch(() => remember(null))
      .finally(() => setStarting(false));
  }, []);

  const openFile = async () => {
    let album: Album;
    try {
      album = await openLayoutFile();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      alert(e instanceof LayoutFileError ? strings.layoutFileInvalid : strings.openFileError(e instanceof Error ? e.message : String(e)));
      return;
    }
    let existing: Album | undefined;
    try {
      existing = await loadAlbum(album.id);
    } catch {
      existing = undefined;
    }
    if (existing && !confirm(strings.confirmReplaceAlbum(existing.name))) return;
    // The open album saves its last change first, so that change cannot overwrite the file's album.
    await session?.close();
    setSession(openSession(album, true));
  };

  if (starting) return <p class="loading">{strings.loading}</p>;
  if (session) {
    return (
      <Editor
        key={session.key}
        store={session.store}
        storageError={session.storageError.value}
        onOpenFile={openFile}
        onClose={async () => {
          await session.close();
          remember(null);
          setSession(null);
        }}
      />
    );
  }
  return <AlbumList onOpen={(a) => setSession(openSession(a))} onOpenFile={openFile} />;
}
