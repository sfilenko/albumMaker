// Saves the album shortly after each change, and at once when the tab is hidden or closed.
import type { Album } from '../model/types';

const DEFAULT_DELAY_MS = 300;

// A reload can stop the IndexedDB write that pagehide starts, so the page also keeps a
// synchronous copy in localStorage until a save of that change or a later one completes.
const BACKUP_PREFIX = 'albumBackup:';

function writeBackup(a: Album): boolean {
  try {
    localStorage.setItem(BACKUP_PREFIX + a.id, JSON.stringify(a));
    return true;
  } catch {
    // Storage is off or full. The IndexedDB write still runs.
    return false;
  }
}

function removeBackup(id: string): void {
  try {
    localStorage.removeItem(BACKUP_PREFIX + id);
  } catch {
    // Nothing to remove when storage is off.
  }
}

/** Saves each album copy that an earlier page kept in localStorage. Call it before the first load. */
export async function restoreBackups(save: (a: Album) => Promise<void>): Promise<void> {
  let keys: string[];
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(BACKUP_PREFIX));
  } catch {
    return;
  }
  for (const key of keys) {
    let album: Album;
    try {
      album = JSON.parse(localStorage.getItem(key) ?? '') as Album;
    } catch {
      localStorage.removeItem(key);
      continue;
    }
    try {
      await save(album);
      localStorage.removeItem(key);
    } catch {
      // Keep the copy for the next start.
    }
  }
}

export function createAutosaver(
  save: (a: Album) => Promise<void>,
  delayMs = DEFAULT_DELAY_MS,
): { schedule(a: Album): void; flush(): Promise<void>; onError(cb: (e: unknown) => void): void; dispose(): void } {
  // Each schedule gets the next number, so a late save of an older change keeps a newer backup.
  let gen = 0;
  let pending: { album: Album; gen: number } | null = null;
  // The save that the timer already started. A reload can stop it before it commits.
  let inFlight: { album: Album; gen: number } | null = null;
  let backup: { id: string; gen: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const errorHandlers = new Set<(e: unknown) => void>();

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  // `save` is called before the first await, so a pagehide handler starts the write in time.
  const flush = (): Promise<void> => {
    clearTimer();
    const p = pending;
    if (p === null) return Promise.resolve();
    pending = null;
    inFlight = p;
    const settle = () => {
      if (inFlight === p) inFlight = null;
    };
    return save(p.album).then(
      () => {
        settle();
        if (backup !== null && backup.id === p.album.id && p.gen >= backup.gen) {
          removeBackup(backup.id);
          backup = null;
        }
      },
      (e: unknown) => {
        settle();
        // Keep the album for the next try, unless a newer change already waits.
        pending ??= p;
        for (const cb of errorHandlers) cb(e);
      },
    );
  };

  const leave = () => {
    const latest = pending ?? inFlight;
    if (latest !== null && writeBackup(latest.album)) backup = { id: latest.album.id, gen: latest.gen };
    void flush();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') leave();
  };
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    schedule(a) {
      pending = { album: a, gen: ++gen };
      clearTimer();
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    onError(cb) {
      errorHandlers.add(cb);
    },
    dispose() {
      clearTimer();
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
