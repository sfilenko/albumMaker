import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  addPhotos,
  addSpread,
  applyTemplate,
  clearCell,
  createAlbum,
  moveSpread,
  photoUsage,
  placePhoto,
  removePhoto,
  removeSpread,
  swapCells,
  updateSettings,
} from '../../src/model/album';
import type { Album, PhotoMeta } from '../../src/model/types';

const meta = (id: string, name = `${id}.jpg`): PhotoMeta => ({
  id,
  name,
  size: 1000,
  width: 6000,
  height: 4000,
  takenAt: null,
  lastModified: 0,
});

function withPhotos(n: number): Album {
  return addPhotos(createAlbum('Весілля'), Array.from({ length: n }, (_, i) => meta(`p${i + 1}`)));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
});

afterEach(() => {
  vi.useRealTimers();
});

test('a new album has a cover and 15 spreads on template full', () => {
  const a = createAlbum('Весілля');
  expect(a.spreads).toHaveLength(16);
  expect(a.spreads[0].isCover).toBe(true);
  expect(a.spreads.slice(1).every((s) => !s.isCover)).toBe(true);
  expect(a.spreads.every((s) => s.templateId === 'full' && s.cells.length === 1)).toBe(true);
});

test('addPhotos keeps photos in numeric-aware name order', () => {
  const a = addPhotos(createAlbum('x'), [meta('a', 'IMG_10.jpg'), meta('b', 'IMG_2.jpg')]);
  expect(a.photos.map((p) => p.name)).toEqual(['IMG_2.jpg', 'IMG_10.jpg']);
});

test('applyTemplate from g8 with 8 photos to p12 keeps the first 3 in order', () => {
  let a = withPhotos(8);
  const sp = a.spreads[1];
  a = applyTemplate(a, sp.id, 'g8');
  for (let i = 0; i < 8; i++) a = placePhoto(a, { spreadId: sp.id, cellIndex: i }, `p${i + 1}`);
  a = applyTemplate(a, sp.id, 'p12');
  expect(a.spreads[1].cells.map((c) => c.photoId)).toEqual(['p1', 'p2', 'p3']);
  expect(photoUsage(a).has('p4')).toBe(false);
  expect(a.photos).toHaveLength(8);
});

test('applyTemplate from full to two leaves the second cell empty', () => {
  let a = withPhotos(1);
  const id = a.spreads[1].id;
  a = placePhoto(a, { spreadId: id, cellIndex: 0 }, 'p1');
  a = applyTemplate(a, id, 'two');
  expect(a.spreads[1].cells.map((c) => c.photoId)).toEqual(['p1', null]);
});

test('swapCells across two spreads swaps photo and crop', () => {
  let a = withPhotos(2);
  const x = { spreadId: a.spreads[1].id, cellIndex: 0 };
  const y = { spreadId: a.spreads[2].id, cellIndex: 0 };
  a = placePhoto(placePhoto(a, x, 'p1'), y, 'p2');
  a = { ...a, spreads: a.spreads.map((s, i) => (i === 1 ? { ...s, cells: [{ ...s.cells[0], crop: { cx: 0.4, cy: 0.5, zoom: 2 } }] } : s)) };
  a = swapCells(a, x, y);
  expect(a.spreads[1].cells[0]).toEqual({ photoId: 'p2', crop: { cx: 0.5, cy: 0.5, zoom: 1 } });
  expect(a.spreads[2].cells[0]).toEqual({ photoId: 'p1', crop: { cx: 0.4, cy: 0.5, zoom: 2 } });
});

test('the same photo can be in two cells, and photoUsage counts both', () => {
  let a = withPhotos(1);
  a = placePhoto(a, { spreadId: a.spreads[1].id, cellIndex: 0 }, 'p1');
  a = placePhoto(a, { spreadId: a.spreads[2].id, cellIndex: 0 }, 'p1');
  expect(photoUsage(a).get('p1')).toBe(2);
});

test('removePhoto empties every cell that uses the photo', () => {
  let a = withPhotos(2);
  a = placePhoto(a, { spreadId: a.spreads[1].id, cellIndex: 0 }, 'p1');
  a = placePhoto(a, { spreadId: a.spreads[2].id, cellIndex: 0 }, 'p1');
  a = placePhoto(a, { spreadId: a.spreads[3].id, cellIndex: 0 }, 'p2');
  a = removePhoto(a, 'p1');
  expect(a.photos.map((p) => p.id)).toEqual(['p2']);
  expect(a.spreads[1].cells[0].photoId).toBeNull();
  expect(a.spreads[2].cells[0].photoId).toBeNull();
  expect(a.spreads[3].cells[0].photoId).toBe('p2');
});

test('clearCell empties one cell', () => {
  let a = withPhotos(1);
  const ref = { spreadId: a.spreads[1].id, cellIndex: 0 };
  a = clearCell(placePhoto(a, ref, 'p1'), ref);
  expect(a.spreads[1].cells[0].photoId).toBeNull();
});

test('the cover cannot be removed or moved', () => {
  const a = createAlbum('x');
  expect(removeSpread(a, a.spreads[0].id)).toBe(a);
  expect(moveSpread(a, 0, 4)).toBe(a);
  const moved = moveSpread(a, 3, 0);
  expect(moved.spreads[0].isCover).toBe(true);
  expect(moved.spreads[1].id).toBe(a.spreads[3].id);
});

test('addSpread adds a spread after the given index, and removeSpread removes one', () => {
  const a = createAlbum('x');
  const b = addSpread(a, 2);
  expect(b.spreads).toHaveLength(17);
  expect(b.spreads[2].id).toBe(a.spreads[2].id);
  expect(b.spreads[4].id).toBe(a.spreads[3].id);
  expect(removeSpread(b, b.spreads[3].id).spreads).toHaveLength(16);
});

test('a switch of bookStart and back leaves every cell unchanged', () => {
  let a = withPhotos(2);
  a = placePhoto(a, { spreadId: a.spreads[1].id, cellIndex: 0 }, 'p1');
  a = placePhoto(a, { spreadId: a.spreads[15].id, cellIndex: 0 }, 'p2');
  const cells = a.spreads.map((s) => s.cells);
  a = updateSettings(a, { bookStart: 'single-right' });
  a = updateSettings(a, { bookStart: 'full-spread' });
  expect(a.spreads.map((s) => s.cells)).toEqual(cells);
});

test('every operation gives a new updatedAt', () => {
  const a = createAlbum('x');
  vi.setSystemTime(2_000);
  expect(addSpread(a, 1).updatedAt).toBe(2_000);
  expect(updateSettings(a, { gapMm: 12 }).updatedAt).toBe(2_000);
});
