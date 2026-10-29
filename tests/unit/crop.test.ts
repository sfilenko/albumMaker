import { expect, test } from 'vitest';
import { clampCrop, effectiveDpi, panCrop, sourceRect, zoomCrop } from '../../src/model/crop';
import { EMPTY_CROP } from '../../src/model/types';

const cell = { x: 0, y: 0, w: 606, h: 306 };

test('a 3:2 photo on the full spread uses the full photo width', () => {
  const r = sourceRect(6000, 4000, cell, EMPTY_CROP);
  expect(r.sx).toBe(0);
  expect(r.sw).toBe(6000);
  expect(r.sy).toBeCloseTo(485.15, 1);
  expect(r.sh).toBeCloseTo(3029.7, 1);
});

test('a portrait photo in a landscape cell is cropped, not letterboxed', () => {
  const r = sourceRect(1200, 1800, { x: 0, y: 0, w: 300, h: 200 }, EMPTY_CROP);
  expect(r.sw).toBe(1200);
  expect(r.sw / r.sh).toBeCloseTo(1.5);
  expect(r.sh).toBeLessThanOrEqual(1800);
});

test('effective dpi on the full spread', () => {
  expect(effectiveDpi(6000, 4000, cell, EMPTY_CROP)).toBeCloseTo(251.5, 1);
});

test('zoom 2 halves the dpi', () => {
  expect(effectiveDpi(6000, 4000, cell, { cx: 0.5, cy: 0.5, zoom: 2 })).toBeCloseTo(125.7, 1);
});

test('clampCrop keeps the visible area inside the photo', () => {
  const c = clampCrop(6000, 4000, cell, { cx: 0, cy: 0, zoom: 1 });
  expect(c.cx).toBe(0.5);
  expect(c.cy).toBeCloseTo(0.3787, 3);
  expect(c.zoom).toBe(1);
});

test('panCrop: a drag of the picture to the right moves the visible area left', () => {
  const c = panCrop(6000, 4000, { x: 0, y: 0, w: 100, h: 100 }, EMPTY_CROP, 10, 0);
  expect(c.cx).toBeLessThan(0.5);
});

test('zoomCrop keeps zoom between 1 and 8', () => {
  expect(zoomCrop(6000, 4000, cell, EMPTY_CROP, 0.2).zoom).toBe(1);
  expect(zoomCrop(6000, 4000, cell, EMPTY_CROP, 20).zoom).toBe(8);
});
