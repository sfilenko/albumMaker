import { expect, test } from '@playwright/test';

test.skip(({ isMobile }) => !isMobile, 'The phone layout of the top bar');

for (const width of [320, 390]) {
  test(`at ${width} px every top-bar action is on the screen without a scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await page.getByTestId('create-album').click();
    await expect(page.getByTestId('action-export')).toBeVisible();

    const outside = await page.locator('.top-bar .actions button').evaluateAll((buttons, w) => {
      return buttons.filter((b) => b.getBoundingClientRect().right > w).map((b) => b.textContent);
    }, width);
    expect(outside).toEqual([]);
  });
}
