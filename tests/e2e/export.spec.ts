import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const ALBUM = '/src/model/album.ts';

// The phone gets only the pages option, and WebKit has no folder picker: this is the desktop flow.
test.skip(({ browserName }) => browserName !== 'chromium', 'The print export at full size is a desktop flow');
test.setTimeout(120_000);

// Without the folder picker the export takes the ZIP path, as in Firefox and Safari.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });
});

/** A new album with one non-cover spread on `templateId`, and `photo` in cell 0. */
async function albumWithPhoto(page: Page, photo: string, templateId: string) {
  await page.goto('/');
  await page.getByTestId('create-album').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-photos').click();
  await (await chooser).setFiles(join(FIXTURES, photo));
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 0 / 1');
  await page.evaluate(
    async ([path, t]) => {
      const m = await import(path);
      window.__store!.dispatch((a) => {
        let next = a;
        for (const s of a.spreads.slice(2)) next = m.removeSpread(next, s.id);
        next = m.applyTemplate(next, a.spreads[1].id, t);
        return m.placePhoto(next, { spreadId: a.spreads[1].id, cellIndex: 0 }, a.photos[0].id);
      });
    },
    [ALBUM, templateId] as const,
  );
  await expect(page.getByTestId('cell-1-0').locator('img')).toBeVisible();
}

async function startExport(page: Page) {
  await page.getByTestId('action-export').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId('export-start').click();
}

async function zipOf(page: Page, start: () => Promise<void>): Promise<Record<string, Uint8Array>> {
  const download = page.waitForEvent('download', { timeout: 90_000 });
  await start();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/\.zip$/);
  return unzipSync(new Uint8Array(await readFile((await d.path())!)));
}

/** Width and height from the first SOF marker of a JPEG file. */
function jpegSize(bytes: Uint8Array): { w: number; h: number } {
  let i = 2;
  while (i < bytes.length) {
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xc3) return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
    i += 2 + length;
  }
  throw new Error('no SOF marker');
}

/** The JFIF units and densities: [1, 300, 300] means 300 dpi. */
const jfifDensity = (b: Uint8Array) => [b[13], (b[14] << 8) | b[15], (b[16] << 8) | b[17]];

test('the ZIP has spreads/spread-01.jpg at 7157x3614 px and pages/page-001.jpg at 3614x3614 px, both at 300 dpi', async ({ page }) => {
  await albumWithPhoto(page, 'land-1.jpg', 'full');
  const files = await zipOf(page, () => startExport(page));

  expect(Object.keys(files).sort()).toEqual(['pages/page-001.jpg', 'pages/page-002.jpg', 'spreads/spread-01.jpg']);
  expect(jpegSize(files['spreads/spread-01.jpg'])).toEqual({ w: 7157, h: 3614 });
  expect(jpegSize(files['pages/page-001.jpg'])).toEqual({ w: 3614, h: 3614 });
  expect(jfifDensity(files['spreads/spread-01.jpg'])).toEqual([1, 300, 300]);
  expect(jfifDensity(files['pages/page-001.jpg'])).toEqual([1, 300, 300]);
  await expect(page.getByTestId('export-done')).toBeVisible();
});

test('rot6.jpg exports upright: the arrow colour is above the label, not beside it', async ({ page }) => {
  await albumWithPhoto(page, 'rot6.jpg', 'two');
  const files = await zipOf(page, () => startExport(page));

  // Centroids of the magenta arrow and of the white label in page-001, as fractions of the page.
  const found = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const w = Math.round(bitmap.width / 8);
    const h = Math.round(bitmap.height / 8);
    const ctx = new OffscreenCanvas(w, h).getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const sum = { magenta: { x: 0, y: 0, n: 0 }, white: { x: 0, y: 0, n: 0 } };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b] = px.subarray((y * w + x) * 4, (y * w + x) * 4 + 3);
        const kind = r > 200 && g < 90 && b > 200 ? 'magenta' : r > 245 && g > 245 && b > 245 ? 'white' : null;
        if (kind) {
          sum[kind].x += x / w;
          sum[kind].y += y / h;
          sum[kind].n++;
        }
      }
    }
    const c = (s: { x: number; y: number; n: number }) => ({ x: s.x / s.n, y: s.y / s.n, n: s.n });
    return { magenta: c(sum.magenta), white: c(sum.white) };
  }, Buffer.from(files['pages/page-001.jpg']).toString('base64'));

  expect(found.magenta.n).toBeGreaterThan(50);
  expect(found.white.n).toBeGreaterThan(50);
  expect(found.white.y - found.magenta.y).toBeGreaterThan(0.15);
  expect(Math.abs(found.white.x - found.magenta.x)).toBeLessThan(0.08);
});

test('after a reload the export asks for the originals, and after the fixture is chosen it completes', async ({ page }) => {
  await albumWithPhoto(page, 'land-1.jpg', 'full');
  await page.reload();
  await expect(page.getByTestId('cell-1-0').locator('img')).toBeVisible();

  await startExport(page);
  await expect(page.getByTestId('export-need-originals')).toBeVisible();

  const files = await zipOf(page, async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('export-choose-originals').click();
    await (await chooser).setFiles(join(FIXTURES, 'land-1.jpg'));
    // The export goes on only on a new click, so a folder picker would get its user activation.
    await page.getByTestId('export-continue').click();
  });
  expect(jpegSize(files['spreads/spread-01.jpg'])).toEqual({ w: 7157, h: 3614 });
  await expect(page.getByTestId('export-done')).toBeVisible();
});
