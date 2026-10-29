// The open album, with undo and redo. Every change goes through dispatch.
import { computed, signal, type ReadonlySignal } from '@preact/signals';
import type { Album } from '../model/types';

const HISTORY_DEPTH = 100;

export interface AlbumStore {
  album: ReadonlySignal<Album>;
  canUndo: ReadonlySignal<boolean>;
  canRedo: ReadonlySignal<boolean>;
  dispatch(op: (a: Album) => Album, opts?: { coalesce?: string }): void;
  undo(): void;
  redo(): void;
  /** Sets the album without a history entry. */
  replace(a: Album): void;
  /** Fires after every change, undo and redo included. */
  subscribe(fn: (a: Album) => void): () => void;
}

export function createAlbumStore(initial: Album): AlbumStore {
  const album = signal(initial);
  const past = signal<Album[]>([]);
  const future = signal<Album[]>([]);
  const listeners = new Set<(a: Album) => void>();
  // The coalesce key of the last dispatch. A run of dispatches with one key is one undo step.
  let runKey: string | null = null;

  const set = (a: Album) => {
    album.value = a;
    for (const fn of listeners) fn(a);
  };

  return {
    album,
    canUndo: computed(() => past.value.length > 0),
    canRedo: computed(() => future.value.length > 0),

    dispatch(op, opts) {
      const prev = album.value;
      const next = op(prev);
      if (next === prev) return;
      const key = opts?.coalesce ?? null;
      if (key === null || key !== runKey) {
        // The top entry is the album before the run, so the rest of the run adds none.
        past.value = [...past.value, prev].slice(-HISTORY_DEPTH);
      }
      runKey = key;
      future.value = [];
      set(next);
    },

    undo() {
      const stack = past.value;
      if (stack.length === 0) return;
      runKey = null;
      future.value = [album.value, ...future.value];
      past.value = stack.slice(0, -1);
      set(stack[stack.length - 1]);
    },

    redo() {
      const [next, ...rest] = future.value;
      if (!next) return;
      runKey = null;
      past.value = [...past.value, album.value].slice(-HISTORY_DEPTH);
      future.value = rest;
      set(next);
    },

    replace(a) {
      runKey = null;
      set(a);
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
