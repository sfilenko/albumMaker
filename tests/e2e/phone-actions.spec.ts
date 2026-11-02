import { expect, test, type Page } from '@playwright/test';

const PHONE_ONLY = 'The phone layout of the top bar';

async function openAlbum(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await page.getByTestId('create-album').click();
  await expect(page.getByTestId('action-export')).toBeVisible();
}

const buttonsPastEdge = (page: Page, width: number) =>
  page.locator('.top-bar button').evaluateAll((buttons, w) => {
    return buttons.filter((b) => b.getBoundingClientRect().right > w).map((b) => b.textContent);
  }, width);

for (const width of [320, 390]) {
  test(`at ${width} px every top-bar action is on the screen without a scroll`, async ({ page, isMobile }) => {
    test.skip(!isMobile, PHONE_ONLY);
    await openAlbum(page, width);
    expect(await buttonsPastEdge(page, width)).toEqual([]);
  });

  test(`at ${width} px a tap on the archive action opens its dialog`, async ({ page, isMobile }) => {
    test.skip(!isMobile, PHONE_ONLY);
    await openAlbum(page, width);
    await expect(page.getByTestId('action-save-archive')).toHaveText('Архів з фото');
    await page.getByTestId('action-save-archive').tap();
    await expect(page.getByTestId('archive-dialog')).toBeVisible();
  });
}

test('at 390 px the top-bar buttons take at most 3 rows', async ({ page, isMobile }) => {
  test.skip(!isMobile, PHONE_ONLY);
  await openAlbum(page, 390);
  // Buttons of one row can have different heights, and so different tops. A row is a run of buttons that overlap vertically.
  const rows = await page.locator('.top-bar button').evaluateAll((buttons) => {
    const boxes = buttons.map((b) => b.getBoundingClientRect()).sort((a, b) => a.top - b.top);
    let count = 0;
    let bottom = -Infinity;
    for (const box of boxes) {
      if (box.top >= bottom) count++;
      bottom = Math.max(bottom, box.bottom);
    }
    return count;
  });
  expect(rows).toBeGreaterThan(0);
  expect(rows).toBeLessThanOrEqual(3);
});

test('at 900 px every top-bar action is on the screen', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The narrowest desktop width needs a mouse');
  await openAlbum(page, 900);
  expect(await buttonsPastEdge(page, 900)).toEqual([]);
});
