import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { addPhotos, createAlbum, renameAlbum } from '../../src/model/album';
import type { Album } from '../../src/model/types';
import { createAutosaver, restoreBackups } from '../../src/storage/autosave';
import {
  deleteAlbum,
  deleteDirHandle,
  deletePreviews,
  getDirHandle,
  getPreview,
  hasPreviews,
  listAlbums,
  loadAlbum,
  putDirHandle,
  putPreview,
  saveAlbum,
  storedPhotoIds,
} from '../../src/storage/db';
import { LayoutFileError, parseLayout, serializeLayout } from '../../src/storage/layoutFile';

const photo = (id: string) => ({ id, name: `${id}.jpg`, size: 1, width: 10, height: 10, takenAt: null, lastModified: 0 });

let savers: ReturnType<typeof createAutosaver>[] = [];
const autosaver = (save: (a: Album) => Promise<void>) => {
  const s = createAutosaver(save);
  savers.push(s);
  return s;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const s of savers) s.dispose();
  savers = [];
  localStorage.clear();
  vi.useRealTimers();
});

test('save, list and load round trip, newest first', async () => {
  vi.useRealTimers();
  const a = { ...createAlbum('Перший'), updatedAt: 1 };
  const b = { ...createAlbum('Другий'), updatedAt: 2 };
  await saveAlbum(a);
  await saveAlbum(b);
  const list = await listAlbums();
  expect(list.filter((x) => x.id === a.id || x.id === b.id).map((x) => x.name)).toEqual(['Другий', 'Перший']);
  expect(await loadAlbum(a.id)).toEqual(a);
});

test('deleteAlbum also deletes the previews of its photos', async () => {
  vi.useRealTimers();
  const a = addPhotos(createAlbum('x'), [photo('p1')]);
  await saveAlbum(a);
  await putPreview('p1', 'full', new Blob(['f']));
  await putPreview('p1', 'thumb', new Blob(['t']));
  expect(await hasPreviews(['p1', 'p2'])).toEqual(new Set(['p1']));
  await deleteAlbum(a.id);
  expect(await loadAlbum(a.id)).toBeUndefined();
  expect(await getPreview('p1', 'full')).toBeUndefined();
  expect(await getPreview('p1', 'thumb')).toBeUndefined();
});

test('deletePreviews deletes both screen copies of the named photos and no other copy', async () => {
  vi.useRealTimers();
  for (const id of ['gone-1', 'gone-2', 'kept']) {
    await putPreview(id, 'full', new Blob(['f']));
    await putPreview(id, 'thumb', new Blob(['t']));
  }
  await deletePreviews(['gone-1', 'gone-2', 'never-stored']);
  expect(await hasPreviews(['gone-1', 'gone-2', 'kept'])).toEqual(new Set(['kept']));
  for (const id of ['gone-1', 'gone-2']) {
    expect(await getPreview(id, 'full')).toBeUndefined();
    expect(await getPreview(id, 'thumb')).toBeUndefined();
  }
  expect(await getPreview('kept', 'thumb')).toBeDefined();
});

test('storedPhotoIds gives the photos of each stored album, and a deleted album gives none', async () => {
  vi.useRealTimers();
  const a = addPhotos(createAlbum('a'), [photo('held-1'), photo('shared')]);
  const b = addPhotos(createAlbum('b'), [photo('held-2'), photo('shared')]);
  await saveAlbum(a);
  await saveAlbum(b);
  let ids = await storedPhotoIds();
  for (const id of ['held-1', 'held-2', 'shared']) expect(ids.has(id)).toBe(true);
  await deleteAlbum(a.id);
  ids = await storedPhotoIds();
  expect(ids.has('held-1')).toBe(false);
  expect(ids.has('held-2')).toBe(true);
  expect(ids.has('shared')).toBe(true);
});

test('deleteDirHandle deletes the handle of the named album and no other handle', async () => {
  vi.useRealTimers();
  const handle = (name: string) => ({ name }) as unknown as FileSystemDirectoryHandle;
  await putDirHandle('album-1', handle('one'));
  await putDirHandle('album-2', handle('two'));
  await deleteDirHandle('album-1');
  await deleteDirHandle('never-stored');
  expect(await getDirHandle('album-1')).toBeUndefined();
  expect((await getDirHandle('album-2'))?.name).toBe('two');
});

test('three schedule calls within 300 ms save once, with the last album', async () => {
  const save = vi.fn(async (_a: Album) => {});
  const saver = autosaver(save);
  const a = createAlbum('x');
  saver.schedule(a);
  vi.advanceTimersByTime(100);
  saver.schedule(renameAlbum(a, 'y'));
  vi.advanceTimersByTime(100);
  const last = renameAlbum(a, 'z');
  saver.schedule(last);
  vi.advanceTimersByTime(299);
  expect(save).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(last);
});

test('after schedule, a pagehide event saves before the timers advance', () => {
  const save = vi.fn(async (_a: Album) => {});
  const saver = autosaver(save);
  const a = createAlbum('x');
  saver.schedule(a);
  window.dispatchEvent(new Event('pagehide'));
  expect(save).toHaveBeenCalledWith(a);
});

test('pagehide keeps a copy in localStorage at once, and the completed save removes it', async () => {
  let done!: () => void;
  const save = vi.fn((_a: Album) => new Promise<void>((r) => (done = r)));
  const saver = autosaver(save);
  const a = createAlbum('x');
  saver.schedule(a);
  window.dispatchEvent(new Event('pagehide'));
  expect(JSON.parse(localStorage.getItem(`albumBackup:${a.id}`)!)).toEqual(a);
  done();
  await vi.advanceTimersByTimeAsync(0);
  expect(localStorage.getItem(`albumBackup:${a.id}`)).toBeNull();
});

test('a late save of an older change does not remove the copy of a newer one', async () => {
  const resolvers: (() => void)[] = [];
  const save = vi.fn((_a: Album) => new Promise<void>((r) => resolvers.push(r)));
  const saver = autosaver(save);
  const a = createAlbum('x');
  saver.schedule(a);
  await vi.advanceTimersByTimeAsync(300);
  const b = renameAlbum(a, 'y');
  saver.schedule(b);
  window.dispatchEvent(new Event('pagehide'));
  resolvers[0]();
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(localStorage.getItem(`albumBackup:${a.id}`)!)).toEqual(b);
});

test('pagehide while the timer save is still running keeps a copy of that change', async () => {
  let done!: () => void;
  const save = vi.fn((_a: Album) => new Promise<void>((r) => (done = r)));
  const saver = autosaver(save);
  const a = createAlbum('x');
  saver.schedule(a);
  await vi.advanceTimersByTimeAsync(300);
  expect(save).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('pagehide'));
  expect(JSON.parse(localStorage.getItem(`albumBackup:${a.id}`)!)).toEqual(a);
  done();
  await vi.advanceTimersByTimeAsync(0);
  expect(localStorage.getItem(`albumBackup:${a.id}`)).toBeNull();
});

test('restoreBackups saves each kept copy and removes it, and drops a broken one', async () => {
  vi.useRealTimers();
  const a = renameAlbum({ ...createAlbum('x'), updatedAt: 1 }, 'після');
  await saveAlbum({ ...a, name: 'до' });
  localStorage.setItem(`albumBackup:${a.id}`, JSON.stringify(a));
  localStorage.setItem('albumBackup:broken', '{');
  localStorage.setItem('lastAlbumId', a.id);
  await restoreBackups(saveAlbum);
  expect((await loadAlbum(a.id))?.name).toBe('після');
  expect(Object.keys(localStorage).filter((k) => k.startsWith('albumBackup:'))).toEqual([]);
  expect(localStorage.getItem('lastAlbumId')).toBe(a.id);
});

test('a hidden tab saves at once', () => {
  const save = vi.fn(async (_a: Album) => {});
  const saver = autosaver(save);
  saver.schedule(createAlbum('x'));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(save).toHaveBeenCalledTimes(1);
});

test('a rejected save reaches onError, and the next schedule tries again', async () => {
  const err = new DOMException('full', 'QuotaExceededError');
  const save = vi.fn(async (_a: Album) => {
    throw err;
  });
  const saver = autosaver(save);
  const onError = vi.fn();
  saver.onError(onError);
  saver.schedule(createAlbum('x'));
  await vi.advanceTimersByTimeAsync(300);
  expect(onError).toHaveBeenCalledWith(err);
  saver.schedule(createAlbum('y'));
  await vi.advanceTimersByTimeAsync(300);
  expect(save).toHaveBeenCalledTimes(2);
});

test('parseLayout of serializeLayout gives the same album', () => {
  const a = addPhotos(createAlbum('Весілля'), [photo('p1')]);
  expect(parseLayout(serializeLayout(a))).toEqual(a);
});

test('parseLayout rejects bad JSON, a wrong format and an unknown version', () => {
  expect(() => parseLayout('{"format":"x"}')).toThrow(LayoutFileError);
  expect(() => parseLayout('not json')).toThrow(LayoutFileError);
  expect(() => parseLayout('{"format":"album-builder","version":2,"album":{}}')).toThrow(LayoutFileError);
});
