import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const files = ['land-1.jpg', 'port-1.jpg', 'rot6.jpg', 'notes.txt'].map((f) => join(FIXTURES, f));

test('import gives oriented sizes, the capture date, previews and a skipped list, with no outside request', async ({
  page,
  baseURL,
}) => {
  const outside: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).origin !== new URL(baseURL!).origin) outside.push(r.url());
  });

  await page.goto('/?harness=import');
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('harness-input').setInputFiles(files);
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'done', { timeout: 30_000 });

  const result = await page.evaluate(() => window.__importResult!);
  expect(result.skipped).toEqual(['notes.txt']);
  expect(result.metas.map((m) => m.name)).toEqual(['land-1.jpg', 'port-1.jpg', 'rot6.jpg']);

  const rot6 = result.metas.find((m) => m.name === 'rot6.jpg')!;
  expect(rot6).toMatchObject({ width: 1200, height: 1800, takenAt: '2026-06-14T15:30:00' });
  expect(result.metas.find((m) => m.name === 'land-1.jpg')).toMatchObject({ width: 1800, height: 1200 });

  for (const m of result.metas) {
    const sizes = await page.evaluate(
      async (id) => [await window.__previewSize!(id, 'full'), await window.__previewSize!(id, 'thumb')],
      m.id,
    );
    expect(sizes[0]).toBeGreaterThan(0);
    expect(sizes[1]).toBeGreaterThan(0);
  }

  expect(outside).toEqual([]);
});
