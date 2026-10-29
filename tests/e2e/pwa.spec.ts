import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, preview } from 'vite';

// A port of its own: the dev server of the other tests is on 5199, the probe on 5173.
const PREVIEW_PORT = 5310;

test('iPhone Safari outside the Home Screen shows the install banner, and after close and reload it does not show', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-webkit', 'The banner is for iPhone Safari');
  expect(await page.evaluate(() => navigator.userAgent)).toContain('iPhone');

  await page.goto('/');
  await page.getByTestId('create-album').click();
  await expect(page.getByTestId('banner-ios-install')).toBeVisible();
  await page.getByTestId('banner-ios-install-close').click();
  await expect(page.getByTestId('banner-ios-install')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('banner-ios-install')).toHaveCount(0);
});

test('a desktop browser does not show the iPhone install banner', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The desktop half of the banner rule');
  await page.goto('/');
  await page.getByTestId('create-album').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('banner-ios-install')).toHaveCount(0);
});

test('the production build registers a service worker and opens offline after one online visit', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Service workers under Playwright run in Chromium');
  test.setTimeout(180_000);

  const outDir = await mkdtemp(join(tmpdir(), 'album-pwa-'));
  await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });
  const server = await preview({ logLevel: 'error', build: { outDir }, preview: { port: PREVIEW_PORT, strictPort: true } });
  try {
    const url = `http://localhost:${PREVIEW_PORT}/`;
    await page.goto(url);
    await expect(page.getByTestId('album-list')).toBeVisible();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 });

    const manifest = await page.evaluate(async () => {
      const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!;
      return (await fetch(link.href)).json();
    });
    expect(manifest).toMatchObject({ name: 'Конструктор альбому', short_name: 'Альбом', display: 'standalone' });

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('album-list')).toBeVisible();
    await page.getByTestId('create-album').click();
    await expect(page.getByTestId('editor')).toBeVisible();
  } finally {
    await context.setOffline(false);
    await server.close();
    await rm(outDir, { recursive: true, force: true });
  }
});
