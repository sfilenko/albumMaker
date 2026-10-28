import { expect, test } from 'vitest';
import { canvasSizeMm, mmToPx } from '../../src/model/units';

test('mmToPx rounds at 300 dpi', () => {
  expect(mmToPx(606)).toBe(7157);
  expect(mmToPx(306)).toBe(3614);
  expect(mmToPx(300)).toBe(3543);
});

test('canvasSizeMm adds bleed on every side', () => {
  expect(canvasSizeMm(3)).toEqual({ w: 606, h: 306 });
});
