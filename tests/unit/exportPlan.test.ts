import { expect, test } from 'vitest';
import { exportPlan, jobKind } from '../../src/export/export';
import { createAlbum, updateSettings } from '../../src/model/album';

const pages = (jobs: ReturnType<typeof exportPlan>) => jobs.filter((j) => jobKind(j) === 'pages');
const spreads = (jobs: ReturnType<typeof exportPlan>) => jobs.filter((j) => jobKind(j) === 'spreads');

test('the default album gives 15 spread jobs of 7157x3614 px and 30 page jobs, and no job uses the cover', () => {
  const a = createAlbum('x');
  const jobs = exportPlan(a);
  expect(spreads(jobs)).toHaveLength(15);
  expect(pages(jobs)).toHaveLength(30);
  expect(spreads(jobs)[0]).toEqual({
    file: 'spreads/spread-01.jpg',
    spreadId: a.spreads[1].id,
    regionMm: { x: 0, y: 0, w: 606, h: 306 },
    px: { w: 7157, h: 3614 },
  });
  expect(jobs.some((j) => j.spreadId === a.spreads[0].id)).toBe(false);
});

test('with bleed, page-001 is the left 306x306 mm of spread 1 at 3614 px, and page-002 starts at the fold', () => {
  const a = createAlbum('x');
  const [p1, p2] = pages(exportPlan(a));
  expect(p1).toEqual({ file: 'pages/page-001.jpg', spreadId: a.spreads[1].id, regionMm: { x: 0, y: 0, w: 306, h: 306 }, px: { w: 3614, h: 3614 } });
  expect(p2.file).toBe('pages/page-002.jpg');
  expect(p2.regionMm).toEqual({ x: 300, y: 0, w: 306, h: 306 });
  expect(pages(exportPlan(a)).at(-1)!.file).toBe('pages/page-030.jpg');
});

test('without bleed, a page is the 300x300 mm trim at 3543 px', () => {
  const a = updateSettings(createAlbum('x'), { pageExport: 'trim' });
  const [p1, p2] = pages(exportPlan(a));
  expect(p1.regionMm).toEqual({ x: 3, y: 3, w: 300, h: 300 });
  expect(p1.px).toEqual({ w: 3543, h: 3543 });
  expect(p2.regionMm).toEqual({ x: 303, y: 3, w: 300, h: 300 });
});

test("'single-right' gives 28 page jobs, and page-001 is the right side of spread 1", () => {
  const a = updateSettings(createAlbum('x'), { bookStart: 'single-right' });
  const p = pages(exportPlan(a));
  expect(p).toHaveLength(28);
  expect(p[0].spreadId).toBe(a.spreads[1].id);
  expect(p[0].regionMm.x).toBe(300);
  expect(p.at(-1)!.spreadId).toBe(a.spreads[15].id);
  expect(p.at(-1)!.regionMm.x).toBe(0);
  expect(spreads(exportPlan(a))).toHaveLength(15);
});
