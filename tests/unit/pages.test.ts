import { expect, test } from 'vitest';
import { addPhotos, applyTemplate, createAlbum, placePhoto, removeSpread, updateSettings } from '../../src/model/album';
import { cellSides, printedPages, printWarnings, sideIsPrinted } from '../../src/model/pages';
import type { Album, PhotoMeta } from '../../src/model/types';

const meta = (id: string, width: number, height: number): PhotoMeta => ({
  id,
  name: `${id}.jpg`,
  size: 1000,
  width,
  height,
  takenAt: null,
  lastModified: 0,
});

test('the default album gives 30 printed pages and no min-pages warning', () => {
  const a = createAlbum('x');
  const pages = printedPages(a);
  expect(pages).toHaveLength(30);
  expect(pages[0]).toEqual({ page: 1, spreadId: a.spreads[1].id, side: 'left' });
  expect(pages[29]).toEqual({ page: 30, spreadId: a.spreads[15].id, side: 'right' });
  expect(printWarnings(a, new Set()).some((w) => w.kind === 'min-pages')).toBe(false);
});

test('single-right gives 28 printed pages', () => {
  const a = updateSettings(createAlbum('x'), { bookStart: 'single-right' });
  const pages = printedPages(a);
  expect(pages).toHaveLength(28);
  expect(pages[0]).toEqual({ page: 1, spreadId: a.spreads[1].id, side: 'right' });
  expect(pages[27]).toEqual({ page: 28, spreadId: a.spreads[15].id, side: 'left' });
  expect(sideIsPrinted(a, a.spreads[1].id, 'left')).toBe(false);
  expect(sideIsPrinted(a, a.spreads[15].id, 'right')).toBe(false);
});

test('11 spreads give the min-pages warning', () => {
  let a = createAlbum('x');
  for (const s of a.spreads.slice(12)) a = removeSpread(a, s.id);
  expect(a.spreads).toHaveLength(12);
  expect(printWarnings(a, new Set())).toContainEqual({ kind: 'min-pages', pages: 22 });
});

test('a photo on a half that is not printed gives a warning and stays in its cell', () => {
  let a = addPhotos(createAlbum('x'), [meta('p1', 6000, 4000)]);
  const id = a.spreads[1].id;
  a = applyTemplate(a, id, 'two');
  a = placePhoto(a, { spreadId: id, cellIndex: 0 }, 'p1');
  a = updateSettings(a, { bookStart: 'single-right' });
  expect(printWarnings(a, new Set(['p1']))).toContainEqual({ kind: 'unprinted-photo', ref: { spreadId: id, cellIndex: 0 } });
  a = updateSettings(a, { bookStart: 'full-spread' });
  expect(printWarnings(a, new Set(['p1'])).some((w) => w.kind === 'unprinted-photo')).toBe(false);
  expect(a.spreads[1].cells[0].photoId).toBe('p1');
});

test('a small photo on the full spread gives a low-dpi warning', () => {
  let a = addPhotos(createAlbum('x'), [meta('p1', 1000, 667)]);
  a = placePhoto(a, { spreadId: a.spreads[1].id, cellIndex: 0 }, 'p1');
  const w = printWarnings(a, new Set(['p1'])).find((x) => x.kind === 'low-dpi');
  expect(w).toBeDefined();
  expect(w!.kind === 'low-dpi' && w!.dpi).toBeCloseTo(41.9, 1);
});

test('empty printed cells and missing photos give warnings', () => {
  let a: Album = addPhotos(createAlbum('x'), [meta('p1', 6000, 4000)]);
  a = placePhoto(a, { spreadId: a.spreads[1].id, cellIndex: 0 }, 'p1');
  const ws = printWarnings(a, new Set());
  expect(ws).toContainEqual({ kind: 'missing-photo', photoId: 'p1' });
  expect(ws.filter((w) => w.kind === 'empty-cell')).toHaveLength(14);
});

test('cellSides names the pages that a cell touches', () => {
  expect(cellSides({ x: 0, y: 0, w: 606, h: 306 }, 3)).toEqual(['left', 'right']);
  expect(cellSides({ x: 0, y: 0, w: 300, h: 306 }, 3)).toEqual(['left']);
  expect(cellSides({ x: 306, y: 0, w: 300, h: 306 }, 3)).toEqual(['right']);
});
