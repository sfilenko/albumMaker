import { expect, test, type Page } from '@playwright/test';

// The model modules, loaded in the page from the Vite dev server: the same instances the app uses.
const ALBUM = '/src/model/album.ts';

async function openNewAlbum(page: Page) {
  await page.goto('/');
  await page.getByTestId('create-album').click();
  await expect(page.getByTestId('spread-view')).toBeVisible();
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

const widths = async (page: Page, n: number) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await page.getByTestId(`cell-1-${i}`).boundingBox())!.width);
  return out;
};

async function dragGutter(page: Page, index: number, dx: number) {
  const box = (await page.getByTestId(`gutter-${index}`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y);
  await page.mouse.up();
}

test('on row3, a border drag changes cell 0 and cell 1 only, one Ctrl+Z restores, and the drag survives a reload', async ({
  page,
}) => {
  await openNewAlbum(page);
  await setTemplate(page, 'row3');
  const before = await widths(page, 3);

  await dragGutter(page, 0, 60);
  const after = await widths(page, 3);
  expect(after[0]).toBeGreaterThan(before[0] + 40);
  expect(after[1]).toBeLessThan(before[1] - 40);
  expect(Math.abs(after[2] - before[2])).toBeLessThan(0.5);

  await page.keyboard.press('Control+z');
  const undone = await widths(page, 3);
  undone.forEach((w, i) => expect(Math.abs(w - before[i])).toBeLessThan(0.5));

  await dragGutter(page, 0, 60);
  const dragged = await widths(page, 3);
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.getByTestId('cell-1-0')).toBeVisible();
  const reloaded = await widths(page, 3);
  reloaded.forEach((w, i) => expect(Math.abs(w - dragged[i])).toBeLessThan(0.5));
});

test('on two, no border handle exists at the fold', async ({ page }) => {
  await openNewAlbum(page);
  await setTemplate(page, 'two');
  await expect(page.getByTestId('cell-1-1')).toBeVisible();
  await expect(page.locator('[data-testid^="gutter-"]')).toHaveCount(0);
});

test('2 safe-zone guides and 1 fold line show by default, and none with showGuides false', async ({ page }) => {
  await openNewAlbum(page);
  await expect(page.getByTestId('guide-safe')).toHaveCount(2);
  await expect(page.getByTestId('guide-fold')).toHaveCount(1);
  await expect(page.getByTestId('guide-fold')).toBeVisible();

  await page.evaluate(async (path) => {
    const m = await import(path);
    window.__store!.dispatch((a) => m.updateSettings(a, { showGuides: false }));
  }, ALBUM);
  await expect(page.getByTestId('guide-safe')).toHaveCount(0);
  await expect(page.getByTestId('guide-fold')).toHaveCount(0);
});
