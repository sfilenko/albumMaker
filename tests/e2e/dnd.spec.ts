import { expect, test, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const PHOTOS = ['land-1', 'land-2', 'land-3', 'land-4', 'land-5', 'land-6', 'port-1', 'port-2', 'port-3'].map((n) =>
  join(FIXTURES, `${n}.jpg`),
);
const ALBUM = '/src/model/album.ts';

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900;

async function openAlbumWithPhotos(page: Page) {
  await page.goto('/');
  await page.getByTestId('create-album').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-photos').click();
  await (await chooser).setFiles(PHOTOS);
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 0 / 9');
}

async function setTemplate(page: Page, templateId: string) {
  await page.evaluate(
    async ([path, t]) => {
      const m = await import(path);
      window.__store!.dispatch((a) => m.applyTemplate(a, a.spreads[1].id, t));
    },
    [ALBUM, templateId] as const,
  );
}

async function showTab(page: Page, name: string) {
  if (!isDesktop(page)) await page.getByRole('tab', { name }).click();
}

async function mouseDrag(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 8, a.y + a.height / 2 + ((b.y + b.height / 2 - a.y - a.height / 2) * i) / 8);
  }
  await page.mouse.up();
}

test('a drag of land-1.jpg onto cell-1-0 places it and updates the counter', async ({ page }) => {
  await openAlbumWithPhotos(page);
  await mouseDrag(page, page.getByTestId('photo-land-1.jpg'), page.getByTestId('cell-1-0'));
  await expect(page.getByTestId('cell-1-0').locator('img')).toHaveAttribute('alt', 'land-1.jpg');
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 1 / 9');
  await expect(page.getByTestId('photo-land-1.jpg')).toHaveAttribute('data-uses', '1');
});

test('on two, a drag of cell 0 onto cell 1 swaps them, and a drag onto the photo column empties a cell', async ({ page }) => {
  await openAlbumWithPhotos(page);
  await setTemplate(page, 'two');
  // Each drop renders before the next gesture starts, as it does for a person.
  await mouseDrag(page, page.getByTestId('photo-land-1.jpg'), page.getByTestId('cell-1-0'));
  await expect(page.getByTestId('cell-1-0').locator('img')).toHaveAttribute('alt', 'land-1.jpg');
  await mouseDrag(page, page.getByTestId('photo-land-2.jpg'), page.getByTestId('cell-1-1'));
  await expect(page.getByTestId('cell-1-1').locator('img')).toHaveAttribute('alt', 'land-2.jpg');
  await mouseDrag(page, page.getByTestId('cell-1-0'), page.getByTestId('cell-1-1'));
  await expect(page.getByTestId('cell-1-0').locator('img')).toHaveAttribute('alt', 'land-2.jpg');
  await expect(page.getByTestId('cell-1-1').locator('img')).toHaveAttribute('alt', 'land-1.jpg');

  await mouseDrag(page, page.getByTestId('cell-1-0'), page.getByTestId('photo-panel'));
  await expect(page.getByTestId('cell-1-0')).toHaveAttribute('data-photo', '');
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 1 / 9');
});

test('a tap on a photo and a tap on a cell place the photo', async ({ page }) => {
  await openAlbumWithPhotos(page);
  await page.getByTestId('photo-land-2.jpg').click();
  await page.getByTestId('cell-1-0').click();
  await expect(page.getByTestId('cell-1-0').locator('img')).toHaveAttribute('alt', 'land-2.jpg');
});

test('a placement survives a reload at once, inside the autosave delay', async ({ page }) => {
  await openAlbumWithPhotos(page);
  await page.getByTestId('photo-land-1.jpg').click();
  await page.getByTestId('cell-1-0').click();
  await expect(page.getByTestId('cell-1-0').locator('img')).toHaveAttribute('alt', 'land-1.jpg');
  await page.reload();
  await expect(page.getByTestId('cell-1-0').locator('img')).toHaveAttribute('alt', 'land-1.jpg');
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 1 / 9');
});

test('a click on template g8 gives 8 cells with the earlier photo in cell 0', async ({ page }) => {
  await openAlbumWithPhotos(page);
  await page.getByTestId('photo-land-3.jpg').click();
  await page.getByTestId('cell-1-0').click();
  await showTab(page, 'Шаблони');
  await page.getByTestId('template-g8').click();
  await expect(page.locator('[data-testid^="cell-1-"]')).toHaveCount(8);
  await expect(page.getByTestId('cell-1-0').locator('img')).toHaveAttribute('alt', 'land-3.jpg');
});

test('"+" makes 17 strip items, a strip drag reorders, and the cover stays first', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('create-album').click();
  await showTab(page, 'Розвороти');
  await expect(page.locator('[data-testid^="strip-"][data-spread-id]')).toHaveCount(16);
  await page.getByTestId('strip-add').click();
  await expect(page.locator('[data-testid^="strip-"][data-spread-id]')).toHaveCount(17);

  const moved = await page.getByTestId('strip-3').getAttribute('data-spread-id');
  await mouseDrag(page, page.getByTestId('strip-3'), page.getByTestId('strip-1'));
  await expect(page.getByTestId('strip-1')).toHaveAttribute('data-spread-id', moved!);
  await mouseDrag(page, page.getByTestId('strip-2'), page.getByTestId('strip-0'));
  await expect(page.getByTestId('strip-0')).toHaveText(/Обкладинка/);

  // A reload at once, inside the autosave delay, keeps the order.
  const order = () => page.locator('[data-testid^="strip-"][data-spread-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-spread-id')));
  const before = await order();
  await page.reload();
  await showTab(page, 'Розвороти');
  await expect.poll(order).toEqual(before);
});
