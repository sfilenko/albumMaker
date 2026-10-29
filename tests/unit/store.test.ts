import { expect, test, vi } from 'vitest';
import { createAlbum, renameAlbum, updateSettings } from '../../src/model/album';
import { createAlbumStore } from '../../src/state/store';

const fresh = () => createAlbumStore(createAlbum('Весілля'));

test('undo and redo are a round trip', () => {
  const store = fresh();
  const start = store.album.value;
  store.dispatch((a) => renameAlbum(a, 'Б'));
  const renamed = store.album.value;
  expect(store.canUndo.value).toBe(true);
  store.undo();
  expect(store.album.value).toBe(start);
  expect(store.canRedo.value).toBe(true);
  store.redo();
  expect(store.album.value).toBe(renamed);
  expect(store.canRedo.value).toBe(false);
});

test('a new dispatch clears redo', () => {
  const store = fresh();
  store.dispatch((a) => renameAlbum(a, 'Б'));
  store.undo();
  store.dispatch((a) => renameAlbum(a, 'В'));
  expect(store.canRedo.value).toBe(false);
});

test('five coalesced dispatches undo in one step', () => {
  const store = fresh();
  const start = store.album.value;
  for (let i = 1; i <= 5; i++) store.dispatch((a) => updateSettings(a, { gapMm: 6 + i }), { coalesce: 'gutter' });
  expect(store.album.value.settings.gapMm).toBe(11);
  store.undo();
  expect(store.album.value).toBe(start);
  expect(store.canUndo.value).toBe(false);
});

test('a different coalesce key starts a new undo step', () => {
  const store = fresh();
  store.dispatch((a) => updateSettings(a, { gapMm: 8 }), { coalesce: 'settings:gapMm' });
  store.dispatch((a) => updateSettings(a, { marginMm: 4 }), { coalesce: 'settings:marginMm' });
  store.undo();
  expect(store.album.value.settings).toMatchObject({ gapMm: 8, marginMm: 0 });
});

test('after 150 dispatches only 100 undos are possible', () => {
  const store = fresh();
  for (let i = 0; i < 150; i++) store.dispatch((a) => renameAlbum(a, `n${i}`));
  let undos = 0;
  while (store.canUndo.value) {
    store.undo();
    undos++;
  }
  expect(undos).toBe(100);
  expect(store.album.value.name).toBe('n49');
});

test('an op that returns the same album makes no history entry', () => {
  const store = fresh();
  store.dispatch((a) => a);
  expect(store.canUndo.value).toBe(false);
});

test('replace makes no history entry', () => {
  const store = fresh();
  store.replace(renameAlbum(store.album.value, 'Б'));
  expect(store.album.value.name).toBe('Б');
  expect(store.canUndo.value).toBe(false);
});

test('subscribe fires on dispatch, undo, redo and replace', () => {
  const store = fresh();
  const fn = vi.fn();
  const off = store.subscribe(fn);
  store.dispatch((a) => renameAlbum(a, 'Б'));
  store.undo();
  store.redo();
  store.replace(store.album.value);
  expect(fn).toHaveBeenCalledTimes(4);
  off();
  store.undo();
  expect(fn).toHaveBeenCalledTimes(4);
});
