import { expect, test, type Page } from '@playwright/test';

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900;

async function createAlbum(page: Page) {
  await page.getByTestId('create-album').click();
  await expect(page.getByTestId('editor')).toBeVisible();
}

async function backToList(page: Page) {
  await page.getByRole('button', { name: '‹ Альбоми' }).click();
  await expect(page.getByTestId('album-list')).toBeVisible();
}

test('a created album is in the list after reload, and a rename stays after reload', async ({ page }) => {
  await page.goto('/');
  await createAlbum(page);
  await backToList(page);
  await page.reload();
  await expect(page.getByTestId('album-name')).toHaveText(['Новий альбом']);

  await page.getByTestId('rename-album').click();
  await page.getByTestId('rename-input').fill('Весілля Б');
  await page.getByTestId('rename-input').press('Enter');
  await expect(page.getByTestId('album-name')).toHaveText(['Весілля Б']);
  await page.reload();
  await expect(page.getByTestId('album-name')).toHaveText(['Весілля Б']);
});

test('a deleted album does not come back after reload', async ({ page }) => {
  await page.goto('/');
  await createAlbum(page);
  await backToList(page);
  page.once('dialog', (d) => d.accept());
  await page.getByTestId('delete-album').click();
  await expect(page.getByTestId('album-item')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('album-list')).toBeVisible();
  await expect(page.getByTestId('album-item')).toHaveCount(0);
});

test('after reload, the last opened album opens', async ({ page }) => {
  await page.goto('/');
  await createAlbum(page);
  await backToList(page);
  await createAlbum(page);
  await page.evaluate(() => {
    const s = window.__store!;
    s.replace({ ...s.album.value, name: 'Альбом Б' });
  });
  await backToList(page);
  await page.getByTestId('album-name').filter({ hasText: 'Альбом Б' }).click();
  await expect(page.getByTestId('album-title')).toHaveText('Альбом Б');
  await page.reload();
  await expect(page.getByTestId('album-title')).toHaveText('Альбом Б');
});

test('the editor shows four areas on a computer and tabs on a phone', async ({ page }) => {
  await page.goto('/');
  await createAlbum(page);
  for (const id of ['settings', 'preview', 'save-file', 'open-file', 'export']) {
    await expect(page.getByTestId(`action-${id}`)).toBeVisible();
  }
  // The top bar fits: the page never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (isDesktop(page)) {
    for (const id of ['photo-panel', 'spread-view', 'template-panel', 'spread-strip']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    return;
  }
  await expect(page.getByTestId('spread-view')).toBeVisible();
  for (const name of ['Фото', 'Шаблони', 'Розвороти']) {
    await expect(page.getByRole('tab', { name })).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Шаблони' }).click();
  await expect(page.getByTestId('template-panel')).toBeVisible();
  await expect(page.getByTestId('photo-panel')).toHaveCount(0);
});
