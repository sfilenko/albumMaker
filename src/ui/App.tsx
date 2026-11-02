// The start screen is the album list. Opening an album creates its store and autosaver.
// A layout file and an album archive open here too, from the list or from the editor.
import { signal, type ReadonlySignal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Album } from '../model/types';
import { createAlbumStore, type AlbumStore } from '../state/store';
import { ArchiveError, isZip, readArchive, type OpenedArchive } from '../storage/archive';
import { createAutosaver, restoreBackups } from '../storage/autosave';
import { loadAlbum, requestPersistence, saveAlbum } from '../storage/db';
import { LayoutFileError, parseLayout, pickAlbumFile } from '../storage/layoutFile';
import { AlbumList } from './AlbumList';
import { ArchiveOpenDialog } from './ArchiveOpenDialog';
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

function openFileMessage(e: unknown): string {
  if (e instanceof LayoutFileError) return e.reason === 'version' ? strings.layoutFileVersion : strings.layoutFileInvalid;
  if (e instanceof ArchiveError) return strings.archiveInvalid;
  return strings.openFileError(e instanceof Error ? e.message : String(e));
}

/** `unsaved`: the album is not in IndexedDB yet (it comes from a file), so save it now. */
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
  const [openingArchive, setOpeningArchive] = useState<OpenedArchive | null>(null);
  // One open at a time: the dialog verifies only the archive that it got first. This flag is set from
  // the start of a read until the read ends or the dialog closes. It is a ref because a state value
  // is old after the wait for a picker.
  const opening = useRef(false);
  const lastPickError = useRef<unknown>(null);

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

  const replaceSession = async (album: Album) => {
    // The open album saves its last change first, so that change cannot overwrite the file's album.
    await session?.close();
    setSession(openSession(album, true));
  };

  const openFile = async () => {
    if (opening.current) return;
    let file: File;
    try {
      // The flag stays clear during the wait: a browser with no cancel event never ends this wait.
      file = await pickAlbumFile();
    } catch (e) {
      // A second click shares the wait of the first click, so both get this error and one alert is enough.
      const seen = e === lastPickError.current;
      lastPickError.current = e;
      if (!seen && !(e instanceof DOMException && e.name === 'AbortError')) alert(openFileMessage(e));
      return;
    }
    // A second click shares the wait of the first click, and it stops here. A second file chooser can
    // also end while the first file is in a read or in the dialog.
    if (opening.current) return;
    opening.current = true;
    let dialogShows = false;
    try {
      let archive: OpenedArchive | null = null;
      let album: Album;
      try {
        if (await isZip(file)) {
          archive = await readArchive(file);
          album = archive.album;
        } else {
          album = parseLayout(await file.text());
        }
      } catch (e) {
        alert(openFileMessage(e));
        return;
      }
      let existing: Album | undefined;
      try {
        existing = await loadAlbum(album.id);
      } catch {
        existing = undefined;
      }
      if (existing && !confirm(strings.confirmReplaceAlbum(existing.name))) return;
      if (archive) {
        dialogShows = true;
        setOpeningArchive(archive);
      } else {
        await replaceSession(album);
      }
    } finally {
      if (!dialogShows) opening.current = false;
    }
  };

  const closeArchiveDialog = () => {
    opening.current = false;
    setOpeningArchive(null);
  };

  if (starting) return <p class="loading">{strings.loading}</p>;
  return (
    <>
      {session ? (
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
      ) : (
        <AlbumList onOpen={(a) => setSession(openSession(a))} onOpenFile={openFile} />
      )}
      {openingArchive && <ArchiveOpenDialog opened={openingArchive} onReplace={replaceSession} onClose={closeArchiveDialog} />}
    </>
  );
}
