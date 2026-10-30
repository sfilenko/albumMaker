import { expect, test } from 'vitest';
import { clampCrop, effectiveDpi, panCrop, photoBox, visiblePart, zoomCrop, zoomLimits } from '../../src/model/crop';
import { EMPTY_CROP, type Rect } from '../../src/model/types';

const cell = { x: 0, y: 0, w: 606, h: 306 };
const square150 = { x: 0, y: 0, w: 150, h: 150 };

/** The photo box lies inside the cell, with a tolerance for floating point. */
function expectInside(b: Rect, c: Rect) {
  expect(b.x).toBeGreaterThanOrEqual(-1e-9);
  expect(b.y).toBeGreaterThanOrEqual(-1e-9);
  expect(b.x + b.w).toBeLessThanOrEqual(c.w + 1e-9);
  expect(b.y + b.h).toBeLessThanOrEqual(c.h + 1e-9);
}

test('a 3:2 photo on the full spread uses the full photo width', () => {
  const { src, dst } = visiblePart(6000, 4000, cell, EMPTY_CROP);
  expect(src.sx).toBeCloseTo(0, 9);
  expect(src.sw).toBeCloseTo(6000, 9);
  expect(src.sy).toBeCloseTo(485.15, 1);
  expect(src.sh).toBeCloseTo(3029.7, 1);
  expect(dst).toEqual({ x: 0, y: 0, w: expect.closeTo(606, 9), h: expect.closeTo(306, 9) });
});

test('a portrait photo in a landscape cell at zoom 1 is cropped, not letterboxed', () => {
  const { src } = visiblePart(1200, 1800, { x: 0, y: 0, w: 300, h: 200 }, EMPTY_CROP);
  expect(src.sw).toBeCloseTo(1200, 9);
  expect(src.sw / src.sh).toBeCloseTo(1.5);
  expect(src.sh).toBeLessThanOrEqual(1800);
});

test('at a zoom of 1 or more, src is the visible area of the old cover crop', () => {
  // The old sourceRect: sw = min(photoW, photoH × a) / zoom, the centre clamped into the photo.
  for (const crop of [EMPTY_CROP, { cx: 0.3, cy: 0.7, zoom: 2 }, { cx: 0.9, cy: 0.1, zoom: 8 }]) {
    const { src, dst } = visiblePart(6000, 4000, cell, crop);
    const sw = 6000 / crop.zoom;
    const sh = sw / (606 / 306);
    expect(src.sw).toBeCloseTo(sw, 6);
    expect(src.sh).toBeCloseTo(sh, 6);
    expect(src.sx).toBeCloseTo(Math.min(Math.max(crop.cx * 6000 - sw / 2, 0), 6000 - sw), 6);
    expect(src.sy).toBeCloseTo(Math.min(Math.max(crop.cy * 4000 - sh / 2, 0), 4000 - sh), 6);
    expect(dst.w).toBeCloseTo(606, 9);
    expect(dst.h).toBeCloseTo(306, 9);
  }
});

test('effective dpi on the full spread', () => {
  expect(effectiveDpi(6000, 4000, cell, EMPTY_CROP)).toBeCloseTo(251.5, 1);
});

test('zoom 2 halves the dpi', () => {
  expect(effectiveDpi(6000, 4000, cell, { cx: 0.5, cy: 0.5, zoom: 2 })).toBeCloseTo(125.7, 1);
});

test('zoomLimits for an 1800x1200 photo in a 150x150 mm cell: min is half of the whole-photo zoom 2/3', () => {
  const { min, max } = zoomLimits(1800, 1200, square150);
  expect(min).toBeCloseTo(1 / 3, 6);
  expect(max).toBe(8);
});

test('the dpi uses the printed photo width: about 305 at the whole-photo zoom, about 610 at the lower limit', () => {
  const { min } = zoomLimits(1800, 1200, square150);
  // The whole photo is 150 mm wide, then 75 mm wide.
  expect(effectiveDpi(1800, 1200, square150, { cx: 0.5, cy: 0.5, zoom: min * 2 })).toBeCloseTo(304.8, 1);
  expect(effectiveDpi(1800, 1200, square150, { cx: 0.5, cy: 0.5, zoom: min })).toBeCloseTo(609.6, 1);
});

test('at the lower limit the whole photo shows at half of the whole-photo size', () => {
  const { min } = zoomLimits(1800, 1200, square150);
  const b = photoBox(1800, 1200, square150, { cx: 0.5, cy: 0.5, zoom: min });
  expect(b.w).toBeCloseTo(75, 6);
  expect(b.h).toBeCloseTo(50, 6);
  expectInside(b, square150);
});

test('a portrait photo at zoom 0.5 in a landscape cell is narrower than the cell, inside it, and covers its height', () => {
  const landscape = { x: 0, y: 0, w: 300, h: 200 };
  const { src, dst } = visiblePart(1200, 1800, landscape, { cx: 0.5, cy: 0.5, zoom: 0.5 });
  expect(dst.w).toBeLessThan(300);
  expect(dst.x).toBeGreaterThan(0);
  expect(dst.x + dst.w).toBeLessThan(300);
  expect(dst.y).toBeCloseTo(0, 9);
  expect(dst.h).toBeCloseTo(200, 9);
  expect(src.sx).toBe(0);
  expect(src.sw).toBe(1200);
});

test('zoomCrop keeps the zoom between the lower limit and 8', () => {
  const { min } = zoomLimits(6000, 4000, cell);
  expect(min).toBeCloseTo(0.3787, 4);
  expect(zoomCrop(6000, 4000, cell, EMPTY_CROP, 0.2).zoom).toBe(min);
  expect(zoomCrop(6000, 4000, cell, EMPTY_CROP, 20).zoom).toBe(8);
});

test('a stored crop with zoom: 0.01 reads as the lower limit', () => {
  const crop = { cx: 0.5, cy: 0.5, zoom: 0.01 };
  const { min } = zoomLimits(1800, 1200, square150);
  expect(clampCrop(1800, 1200, square150, crop).zoom).toBe(min);
  expect(photoBox(1800, 1200, square150, crop).w).toBeCloseTo(75, 6);
});

test('a stored crop with a centre far outside the cell reads as a photo inside the cell', () => {
  const b = photoBox(1800, 1200, square150, { cx: -40, cy: 25, zoom: 0.4 });
  expectInside(b, square150);
  // A centre far left of the photo shows the photo at the right edge; far below, at the top edge.
  expect(b.x + b.w).toBeCloseTo(150, 9);
  expect(b.y).toBeCloseTo(0, 9);
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

test('a zoomed-out photo moves on its free axis and stops at the cell edge', () => {
  const { min } = zoomLimits(1800, 1200, square150);
  const start = { cx: 0.5, cy: 0.5, zoom: min };
  const right = photoBox(1800, 1200, square150, panCrop(1800, 1200, square150, start, 10, 0));
  expect(right.x).toBeCloseTo(37.5 + 10, 6);
  const left = photoBox(1800, 1200, square150, panCrop(1800, 1200, square150, start, -500, 0));
  expect(left.x).toBeCloseTo(0, 9);
  const down = photoBox(1800, 1200, square150, panCrop(1800, 1200, square150, start, 0, 500));
  expect(down.y + down.h).toBeCloseTo(150, 9);
});

test('on the axis where the photo is larger than the cell, a drag never shows the background', () => {
  const landscape = { x: 0, y: 0, w: 300, h: 200 };
  const start = { cx: 0.5, cy: 0.5, zoom: 0.6 };
  for (const dy of [-1000, -30, 30, 1000]) {
    const b = photoBox(1200, 1800, landscape, panCrop(1200, 1800, landscape, start, 0, dy));
    expect(b.y).toBeLessThanOrEqual(1e-9);
    expect(b.y + b.h).toBeGreaterThanOrEqual(200 - 1e-9);
  }
});

test('a cell that changes keeps the zoom it allows, and shows the new limit when it allows less', () => {
  const crop = { cx: 0.5, cy: 0.5, zoom: 0.25 };
  // 100x150 mm: the limit is 0.222, so the zoom stays 0.25.
  const tall = { x: 0, y: 0, w: 100, h: 150 };
  expect(clampCrop(1800, 1200, tall, crop).zoom).toBe(0.25);
  expectInside(photoBox(1800, 1200, tall, crop), tall);
  // 140x150 mm: the limit is 0.311, so the photo shows at half of the cell width.
  const wide = { x: 0, y: 0, w: 140, h: 150 };
  expect(clampCrop(1800, 1200, wide, crop).zoom).toBeCloseTo(0.3111, 4);
  const b = photoBox(1800, 1200, wide, crop);
  expect(b.w).toBeCloseTo(70, 6);
  expectInside(b, wide);
});

test('a photo with the proportions of its cell goes down to zoom 0.5 and moves on both axes', () => {
  const sq = { x: 0, y: 0, w: 100, h: 100 };
  expect(zoomLimits(1500, 1500, sq).min).toBe(0.5);
  const start = { cx: 0.5, cy: 0.5, zoom: 0.5 };
  const b = photoBox(1500, 1500, sq, panCrop(1500, 1500, sq, start, -500, 500));
  expect(b.w).toBeCloseTo(50, 9);
  expect(b.x).toBeCloseTo(0, 9);
  expect(b.y + b.h).toBeCloseTo(100, 9);
});

test('a zoom from 1.2 down to 0.8 shrinks the photo at every step, with no jump at 1', () => {
  let crop = { cx: 0.5, cy: 0.5, zoom: 1.2 };
  let prev = photoBox(1800, 1200, cell, crop).w;
  for (let z = 1.19; z >= 0.8; z -= 0.01) {
    crop = zoomCrop(1800, 1200, cell, crop, z);
    const w = photoBox(1800, 1200, cell, crop).w;
    expect(w).toBeLessThan(prev);
    expect(prev / w).toBeLessThan(1.02);
    prev = w;
  }
});
