import { expect, test } from 'vitest';
import { cellRects, guides, gutters, moveGutter } from '../../src/model/layout';
import { cellCount, templateLayout, TEMPLATES } from '../../src/model/templates';
import { DEFAULT_SETTINGS } from '../../src/model/types';

const s = DEFAULT_SETTINGS;

test('full fills the canvas including the bleed', () => {
  expect(cellRects(templateLayout('full'), s)).toEqual([{ x: 0, y: 0, w: 606, h: 306 }]);
});

test('two splits at the fold with the gap', () => {
  expect(cellRects(templateLayout('two'), s)).toEqual([
    { x: 0, y: 0, w: 300, h: 306 },
    { x: 306, y: 0, w: 300, h: 306 },
  ]);
});

test('mat uses its own 35 mm margin and no bleed extension', () => {
  expect(cellRects(templateLayout('mat'), s)).toEqual([
    { x: 38, y: 38, w: 230, h: 230 },
    { x: 338, y: 38, w: 230, h: 230 },
  ]);
});

test('the margin setting does not change mat', () => {
  expect(cellRects(templateLayout('mat'), { ...s, marginMm: 20 })).toEqual(cellRects(templateLayout('mat'), s));
});

test('a margin of 10 mm keeps full off the bleed', () => {
  expect(cellRects(templateLayout('full'), { ...s, marginMm: 10 })).toEqual([{ x: 13, y: 13, w: 580, h: 280 }]);
});

test('the cell counts in TEMPLATES order match the brief', () => {
  expect(TEMPLATES.map((t) => cellCount(templateLayout(t.id)))).toEqual([1, 2, 6, 6, 3, 3, 5, 3, 4, 8, 2, 1]);
});

test('the twelve templates have the names of the brief', () => {
  expect(TEMPLATES.map((t) => t.name)).toEqual([
    'Одне фото на весь розворот',
    'По фото на сторінку',
    'Велике + 2 / 2 + велике',
    'Мозаїка з 6 фото',
    'Панорама + два',
    'Фото + два',
    'Фото + сітка 4',
    'Три в ряд',
    'Чотири вертикальні',
    'Сітка 2×2 на кожній сторінці',
    'Фото з широкими полями',
    'Одне фото з полями + пуста сторінка',
  ]);
});

test('two has no border at the fold, and g8 has 6 borders', () => {
  expect(gutters(templateLayout('two'), s)).toHaveLength(0);
  expect(gutters(templateLayout('g8'), s)).toHaveLength(6);
});

test('moveGutter moves one border and keeps the other cells', () => {
  const l = templateLayout('row3');
  const g = gutters(l, s)[0];
  const before = cellRects(l, s);
  const after = cellRects(moveGutter(l, g.ref, 30, s), s);
  expect(after[0].w).toBeCloseTo(before[0].w + 30);
  expect(after[1].w).toBeCloseTo(before[1].w - 30);
  expect(after[2].w).toBeCloseTo(before[2].w);
});

test('moveGutter stops at 20 mm', () => {
  const l = templateLayout('row3');
  const g = gutters(l, s)[0];
  const r = cellRects(moveGutter(l, g.ref, -1000, s), s);
  // 20 mm inside the trim plus the 3 mm bleed extension.
  expect(r[0].w).toBeCloseTo(23);
});

test('moveGutter on one page leaves the other page unchanged', () => {
  const l = templateLayout('g8');
  const left = gutters(l, s).find((g) => g.ref.side === 'left')!;
  const before = cellRects(l, s);
  const after = cellRects(moveGutter(l, left.ref, 15, s), s);
  expect(after.slice(4)).toEqual(before.slice(4));
});

test('guides give the trim, two safe zones and the fold', () => {
  expect(guides(s)).toEqual({
    trim: { x: 3, y: 3, w: 600, h: 300 },
    safeLeft: { x: 13, y: 13, w: 280, h: 280 },
    safeRight: { x: 313, y: 13, w: 280, h: 280 },
    foldX: 303,
  });
});
