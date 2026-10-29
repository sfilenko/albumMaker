import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import type { AlbumStore } from '../../src/state/store';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const ALBUM = '/src/model/album.ts';
const LAYOUT = '/src/model/layout.ts';

// The open album's store, which the app sets in development builds.
type DevWindow = Window & { __store: AlbumStore };
type Box = { x: number; y: number; width: number; height: number };

async function openAlbumWithPhotos(page: Page, names: string[]) {
  await page.goto('/');
  await page.getByTestId('create-album').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-photos').click();
  await (await chooser).setFiles(names.map((n) => join(FIXTURES, n)));
  await expect(page.getByTestId('photo-counter')).toHaveText(`використано 0 / ${names.length}`);
}

/** Applies a template to a spread, and places the photos in its first cells in order. */
async function fillSpread(page: Page, spreadIndex: number, templateId: string, photoIndexes: number[]) {
  await page.evaluate(
    async ([path, i, t, photos]) => {
      const m = await import(path);
      (window as DevWindow).__store.dispatch((a) => {
        let next = m.applyTemplate(a, a.spreads[i].id, t);
        photos.forEach((p, cellIndex) => {
          next = m.placePhoto(next, { spreadId: a.spreads[i].id, cellIndex }, a.photos[p].id);
        });
        return next;
      });
    },
    [ALBUM, spreadIndex, templateId, photoIndexes] as const,
  );
}

/** The model's cell rectangles of one spread, in canvas millimetres. */
const modelRects = (page: Page, spreadIndex: number) =>
  page.evaluate(
    async ([path, i]) => {
      const m = await import(path);
      const a = (window as DevWindow).__store.album.value;
      return m.cellRects(a.spreads[i].layout, a.settings) as { x: number; y: number; w: number; h: number }[];
    },
    [LAYOUT, spreadIndex] as const,
  );

const screenBoxes = async (page: Page, n: number): Promise<Box[]> => {
  const out: Box[] = [];
  for (let i = 0; i < n; i++) out.push((await page.getByTestId(`cell-1-${i}`).boundingBox())!);
  return out;
};

async function openSettings(page: Page) {
  await page.getByTestId('action-settings').click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
}

test('on two, a gap of 12 mm gives cells 12 mm apart in the model and on the screen', async ({ page }) => {
  await openAlbumWithPhotos(page, ['land-1.jpg']);
  await fillSpread(page, 1, 'two', []);
  await openSettings(page);
  await page.getByTestId('setting-gap').fill('12');

  const [r0, r1] = await modelRects(page, 1);
  expect(r1.x - (r0.x + r0.w)).toBeCloseTo(12, 5);

  const stage = (await page.getByTestId('spread-view').boundingBox())!;
  const bleed = await page.evaluate(() => (window as DevWindow).__store.album.value.settings.bleedMm);
  const pxPerMm = stage.width / (600 + 2 * bleed);
  const [b0, b1] = await screenBoxes(page, 2);
  expect(Math.abs((b1.x - (b0.x + b0.width)) / pxPerMm - 12)).toBeLessThan(0.5);
});

test('the margin setting does not change the cells of mat', async ({ page }) => {
  await openAlbumWithPhotos(page, ['land-1.jpg']);
  await fillSpread(page, 1, 'mat', [0]);
  const n = (await modelRects(page, 1)).length;
  const modelBefore = await modelRects(page, 1);
  const screenBefore = await screenBoxes(page, n);

  await openSettings(page);
  await page.getByTestId('setting-margin').fill('20');
  await expect.poll(() => page.evaluate(() => (window as DevWindow).__store.album.value.settings.marginMm)).toBe(20);

  expect(await modelRects(page, 1)).toEqual(modelBefore);
  const screenAfter = await screenBoxes(page, n);
  screenAfter.forEach((b, i) => {
    expect(Math.abs(b.x - screenBefore[i].x)).toBeLessThan(0.5);
    expect(Math.abs(b.width - screenBefore[i].width)).toBeLessThan(0.5);
  });
});

test('book start single-right marks the left half of spread 1 as not printed, and a switch back keeps every photo', async ({ page }) => {
  await openAlbumWithPhotos(page, ['land-1.jpg', 'land-2.jpg']);
  await fillSpread(page, 1, 'two', [0, 1]);
  await expect(page.getByTestId('not-printed-left')).toHaveCount(0);

  await openSettings(page);
  await page.getByTestId('setting-book-single-right').check();
  await expect(page.getByTestId('not-printed-left')).toBeVisible();
  await expect(page.getByTestId('not-printed-right')).toHaveCount(0);

  await page.getByTestId('setting-book-full-spread').check();
  await expect(page.getByTestId('not-printed-left')).toHaveCount(0);
  const photos = await page.evaluate(() => (window as DevWindow).__store.album.value.photos.map((p) => p.id));
  await expect(page.getByTestId('cell-1-0')).toHaveAttribute('data-photo', photos[0]);
  await expect(page.getByTestId('cell-1-1')).toHaveAttribute('data-photo', photos[1]);
});

test('in preview, ArrowRight shows the next spread, no guide element exists, and Escape returns to the editor', async ({ page }) => {
  await openAlbumWithPhotos(page, ['land-1.jpg', 'land-2.jpg']);
  await fillSpread(page, 1, 'full', [0]);
  await fillSpread(page, 2, 'full', [1]);
  await expect(page.locator('[data-testid^="guide-"]').first()).toBeAttached();

  await page.getByTestId('action-preview').click();
  await expect(page.getByTestId('preview')).toBeVisible();
  await expect(page.getByTestId('preview-spread')).toHaveAttribute('data-spread-index', '1');
  await expect(page.getByTestId('preview-cell-0').locator('img')).toHaveAttribute('alt', 'land-1.jpg');
  await expect(page.locator('[data-testid^="guide-"]')).toHaveCount(0);
  await expect(page.getByTestId('preview')).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('preview-spread')).toHaveAttribute('data-spread-index', '2');
  await expect(page.getByTestId('preview-cell-0').locator('img')).toHaveAttribute('alt', 'land-2.jpg');
  await expect(page.locator('[data-testid^="guide-"]')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('preview')).toHaveCount(0);
  await expect(page.getByTestId('spread-view')).toBeVisible();
});

test('in preview, a swipe to the left shows the next spread and the arrow buttons go back and forth', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-album').click();
  await page.getByTestId('action-preview').click();
  const spread = page.getByTestId('preview-spread');
  await expect(spread).toHaveAttribute('data-spread-index', '1');

  const b = (await spread.boundingBox())!;
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + b.width * 0.8, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(b.x + b.width * (0.8 - 0.1 * i), y);
  await page.mouse.up();
  await expect(spread).toHaveAttribute('data-spread-index', '2');

  await page.getByTestId('preview-prev').click();
  await expect(spread).toHaveAttribute('data-spread-index', '1');
  await page.getByTestId('preview-next').click();
  await expect(spread).toHaveAttribute('data-spread-index', '2');
});
