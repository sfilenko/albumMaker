// IndexedDB: albums, screen copies of photos, and folder handles for the originals.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Album } from '../model/types';

export type PreviewKind = 'full' | 'thumb';

// A screen copy as bytes: some WebKit builds cannot store a Blob in IndexedDB.
interface StoredPreview { type: string; bytes: ArrayBuffer }

interface Schema extends DBSchema {
  albums: { key: string; value: Album };
  previews: { key: string; value: StoredPreview };
  handles: { key: string; value: FileSystemDirectoryHandle };
}

const DB_NAME = 'album-builder';
const DB_VERSION = 1;
const KINDS: PreviewKind[] = ['full', 'thumb'];

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(d) {
      d.createObjectStore('albums', { keyPath: 'id' });
      d.createObjectStore('previews');
      d.createObjectStore('handles');
    },
  });
  return dbPromise;
}

const previewKey = (photoId: string, kind: PreviewKind) => `${photoId}:${kind}`;

export async function saveAlbum(a: Album): Promise<void> {
  await (await db()).put('albums', a);
}

export async function loadAlbum(id: string): Promise<Album | undefined> {
  return (await db()).get('albums', id);
}

/** Newest first. */
export async function listAlbums(): Promise<{ id: string; name: string; updatedAt: number }[]> {
  const all = await (await db()).getAll('albums');
  return all
    .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    .sort((x, y) => y.updatedAt - x.updatedAt);
}

/** Deletes the album, the screen copies of its photos and its folder handle. */
export async function deleteAlbum(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['albums', 'previews', 'handles'], 'readwrite');
  const album = await tx.objectStore('albums').get(id);
  const previews = tx.objectStore('previews');
  for (const p of album?.photos ?? []) {
    for (const kind of KINDS) await previews.delete(previewKey(p.id, kind));
  }
  await tx.objectStore('albums').delete(id);
  await tx.objectStore('handles').delete(id);
  await tx.done;
}

export async function putPreview(photoId: string, kind: PreviewKind, blob: Blob): Promise<void> {
  const stored: StoredPreview = { type: blob.type, bytes: await blob.arrayBuffer() };
  await (await db()).put('previews', stored, previewKey(photoId, kind));
}

export async function getPreview(photoId: string, kind: PreviewKind): Promise<Blob | undefined> {
  const stored = await (await db()).get('previews', previewKey(photoId, kind));
  return stored && new Blob([stored.bytes], { type: stored.type });
}

/** The ids that have both screen copies. */
export async function hasPreviews(ids: string[]): Promise<Set<string>> {
  const tx = (await db()).transaction('previews');
  const found = new Set<string>();
  for (const id of ids) {
    const keys = await Promise.all(KINDS.map((k) => tx.store.getKey(previewKey(id, k))));
    if (keys.every((k) => k !== undefined)) found.add(id);
  }
  await tx.done;
  return found;
}

export async function putDirHandle(albumId: string, h: FileSystemDirectoryHandle): Promise<void> {
  await (await db()).put('handles', h, albumId);
}

export async function getDirHandle(albumId: string): Promise<FileSystemDirectoryHandle | undefined> {
  return (await db()).get('handles', albumId);
}

/** Asks the browser not to evict this origin's storage. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
