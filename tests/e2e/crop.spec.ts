import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import type { AlbumStore } from '../../src/state/store';

const LAND_1 = join(import.meta.dirname, '..', 'fixtures', 'land-1.jpg');
const ALBUM = '/src/model/album.ts';

// The open album's store, which the app sets in development builds.
type DevWindow = Window & { __store: AlbumStore };

async function openAlbumWithLand1(page: Page, templateId: string) {
  await page.goto('/');
  await page.getByTestId('create-album').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-photos').click();
  await (await chooser).setFiles([LAND_1]);
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 0 / 1');
  await page.evaluate(
    async ([path, t]) => {
      const m = await import(path);
      const w = window as DevWindow;
      w.__store.dispatch((a) => m.placePhoto(m.applyTemplate(a, a.spreads[1].id, t), { spreadId: a.spreads[1].id, cellIndex: 0 }, a.photos[0].id));
    },
    [ALBUM, templateId] as const,
  );
  await expect(page.getByTestId('cell-1-0').locator('img')).toBeVisible();
}

const crop = (page: Page) =>
  page.evaluate(() => {
    const a = (window as DevWindow).__store.album.value;
    return a.spreads[1].cells[0].crop;
  });

test('land-1.jpg on full shows the low-dpi icon, about 75 dpi', async ({ page }) => {
  await openAlbumWithLand1(page, 'full');
  await expect(page.getByTestId('low-dpi-1-0')).toBeVisible();
  await expect(page.getByTestId('low-dpi-1-0')).toHaveText(/7[45] dpi/);
});

test('in crop mode, a drag of 100 px to the left gives cx above 0.5, and one Ctrl+Z restores it', async ({ page }) => {
  await openAlbumWithLand1(page, 'two');
  const cell = page.getByTestId('cell-1-0');
  await cell.click();
  await page.getByTestId('crop-toggle').click();
  await expect(cell).toHaveClass(/cropping/);

  const b = (await cell.boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(x - 20 * i, y);
  await page.mouse.up();
  expect((await crop(page)).cx).toBeGreaterThan(0.5);

  await page.keyboard.press('Control+z');
  expect((await crop(page)).cx).toBeCloseTo(0.5, 5);
});

test('a double-click starts crop mode, wheel zoom never goes below 1, and Escape ends crop mode', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile-webkit', 'Playwright mobile WebKit has no mouse wheel; phones zoom with the slider or a pinch');
  await openAlbumWithLand1(page, 'two');
  const cell = page.getByTestId('cell-1-0');
  await cell.dblclick();
  await expect(cell).toHaveClass(/cropping/);
  const b = (await cell.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);

  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await crop(page)).zoom).toBeGreaterThan(1);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 600);
  await expect.poll(async () => (await crop(page)).zoom).toBe(1);

  await page.keyboard.press('Escape');
  await expect(cell).not.toHaveClass(/cropping/);
});

test('the zoom slider goes from 1 to 8 and never below 1', async ({ page }) => {
  await openAlbumWithLand1(page, 'two');
  await page.getByTestId('cell-1-0').click();
  const slider = page.getByTestId('zoom-slider');
  await expect(slider).toHaveAttribute('min', '1');
  await expect(slider).toHaveAttribute('max', '8');
  // A range input clamps the value to min and max, as a user drag would.
  const set = (v: string) =>
    slider.evaluate((el: HTMLInputElement, value) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, v);
  await set('3');
  await expect.poll(async () => (await crop(page)).zoom).toBe(3);
  await set('0');
  await expect.poll(async () => (await crop(page)).zoom).toBe(1);
});

test('"Прибрати фото" empties the cell', async ({ page }) => {
  await openAlbumWithLand1(page, 'full');
  await page.getByTestId('cell-1-0').click();
  await page.getByTestId('remove-photo').click();
  await expect(page.getByTestId('cell-1-0')).toHaveAttribute('data-photo', '');
});
