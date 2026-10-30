import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const ALBUM = '/src/model/album.ts';
const LAYOUT = '/src/model/layout.ts';

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900;

/** A new album with `photo`, spread 1 on `templateId`, and the photo in cell 0 unless `place` is false. */
async function albumWith(page: Page, photo: string, templateId: string, place = true) {
  await page.goto('/');
  await page.getByTestId('create-album').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-photos').click();
  await (await chooser).setFiles(join(FIXTURES, photo));
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 0 / 1');
  await page.evaluate(
    async ([path, t, p]) => {
      const m = await import(path);
      window.__store!.dispatch((a) => {
        let next = a;
        // One spread is enough, and it keeps the export short.
        for (const s of a.spreads.slice(2)) next = m.removeSpread(next, s.id);
        next = m.applyTemplate(next, a.spreads[1].id, t);
        return p ? m.placePhoto(next, { spreadId: a.spreads[1].id, cellIndex: 0 }, a.photos[0].id) : next;
      });
    },
    [ALBUM, templateId, place] as const,
  );
  if (place) await expect(page.getByTestId('cell-1-0').locator('img')).toBeVisible();
}

const zoom = (page: Page) => page.evaluate(() => window.__store!.album.value.spreads[1].cells[0].crop.zoom);

/** The lower limit for cell 0 of spread 1, worked out here from the rule of the brief, not from zoomLimits. */
const expectedLimit = (page: Page) =>
  page.evaluate(async (layoutPath) => {
    const l = await import(layoutPath);
    const a = window.__store!.album.value;
    const r = l.cellRects(a.spreads[1].layout, a.settings)[0];
    const photo = a.photos[0];
    const ratio = r.w / r.h;
    return Math.min(photo.width, photo.height * ratio) / Math.max(photo.width, photo.height * ratio) / 2;
  }, LAYOUT);

/** Sets the zoom slider in one movement. A range input clamps the value to its min and max, as a drag would. */
const setSlider = (page: Page, value: string) =>
  page.getByTestId('zoom-slider').evaluate((el: HTMLInputElement, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);

/** The img box of a cell, as fractions of the cell box. */
async function relBox(page: Page, cellTestId: string) {
  const cell = (await page.getByTestId(cellTestId).boundingBox())!;
  const img = (await page.getByTestId(cellTestId).locator('img').boundingBox())!;
  return {
    left: (img.x - cell.x) / cell.width,
    top: (img.y - cell.y) / cell.height,
    right: (img.x + img.width - cell.x) / cell.width,
    bottom: (img.y + img.height - cell.y) / cell.height,
  };
}

async function zoomOutFully(page: Page) {
  await page.getByTestId('cell-1-0').click();
  await setSlider(page, '0');
  await expect.poll(() => zoom(page)).toBeLessThan(1);
}

/** Drags the photo in crop mode by `dx` screen pixels. */
async function dragPhoto(page: Page, dx: number) {
  const b = (await page.getByTestId('cell-1-0').boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y);
  await page.mouse.up();
}

test('the zoom slider at its left end shows the whole port-1.jpg at half of the whole-photo size, with background bands at the left and the right', async ({
  page,
}) => {
  await albumWith(page, 'port-1.jpg', 'full');
  await page.getByTestId('cell-1-0').click();
  const slider = page.getByTestId('zoom-slider');
  const limit = await expectedLimit(page);
  expect(Number(await slider.getAttribute('min'))).toBeCloseTo(limit, 6);
  await expect(slider).toHaveAttribute('max', '8');

  await setSlider(page, '0');
  await expect.poll(() => zoom(page)).toBeCloseTo(limit, 6);
  const r = await relBox(page, 'cell-1-0');
  // The whole-photo size touches the top and the bottom; half of it is half of the cell height.
  expect(r.bottom - r.top).toBeCloseTo(0.5, 1);
  expect(Math.abs(r.bottom - r.top - 0.5)).toBeLessThan(0.01);
  expect(r.left).toBeGreaterThan(0);
  expect(r.right).toBeLessThan(1);

  // In the band, the cell itself is on top and has no colour of its own: the spread background shows.
  const band = await page.getByTestId('cell-1-0').evaluate((cell, left) => {
    const b = cell.getBoundingClientRect();
    const hit = document.elementFromPoint(b.x + (b.width * left) / 2, b.y + b.height / 2);
    return { hitIsCell: hit === cell, cellBackground: getComputedStyle(cell).backgroundColor };
  }, r.left);
  expect(band).toEqual({ hitIsCell: true, cellBackground: 'rgba(0, 0, 0, 0)' });
});

test('the zoom slider can be set to exactly 1, and then the photo covers the cell', async ({ page }) => {
  await albumWith(page, 'port-1.jpg', 'full');
  await zoomOutFully(page);
  await setSlider(page, '1');
  await expect.poll(() => zoom(page)).toBe(1);
  const r = await relBox(page, 'cell-1-0');
  expect(r.left).toBeLessThanOrEqual(0.001);
  expect(r.right).toBeGreaterThanOrEqual(0.999);
  expect(r.top).toBeLessThanOrEqual(0.001);
  expect(r.bottom).toBeGreaterThanOrEqual(0.999);
});

test('one slider movement down and one undo give back zoom 1', async ({ page }) => {
  await albumWith(page, 'port-1.jpg', 'full');
  expect(await zoom(page)).toBe(1);
  await zoomOutFully(page);
  await page.getByTestId('undo').click();
  await expect.poll(() => zoom(page)).toBe(1);
});

test('a photo dropped into an empty cell has zoom 1 and no background band', async ({ page }) => {
  test.skip(!isDesktop(page), 'On a phone the photo column and the spread are on different tabs; dnd.spec.ts covers the tap to place');
  await albumWith(page, 'port-1.jpg', 'full', false);
  const from = (await page.getByTestId('photo-port-1.jpg').boundingBox())!;
  const to = (await page.getByTestId('cell-1-0').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(
      from.x + from.width / 2 + ((to.x + to.width / 2 - from.x - from.width / 2) * i) / 8,
      from.y + from.height / 2 + ((to.y + to.height / 2 - from.y - from.height / 2) * i) / 8,
    );
  }
  await page.mouse.up();
  await expect(page.getByTestId('cell-1-0').locator('img')).toHaveAttribute('alt', 'port-1.jpg');
  expect(await zoom(page)).toBe(1);
  const r = await relBox(page, 'cell-1-0');
  expect(r.left).toBeLessThanOrEqual(0.001);
  expect(r.right).toBeGreaterThanOrEqual(0.999);
});

test('in crop mode a zoomed-out photo moves left and right and stops at the cell edge', async ({ page }) => {
  await albumWith(page, 'port-1.jpg', 'full');
  await zoomOutFully(page);
  await page.getByTestId('crop-toggle').click();
  await expect(page.getByTestId('cell-1-0')).toHaveClass(/cropping/);
  const before = await relBox(page, 'cell-1-0');

  await dragPhoto(page, -40);
  const moved = await relBox(page, 'cell-1-0');
  expect(moved.left).toBeLessThan(before.left);

  const cellWidth = (await page.getByTestId('cell-1-0').boundingBox())!.width;
  await dragPhoto(page, -cellWidth);
  const left = await relBox(page, 'cell-1-0');
  expect(left.left).toBeCloseTo(0, 2);
  await dragPhoto(page, cellWidth);
  const right = await relBox(page, 'cell-1-0');
  expect(right.right).toBeCloseTo(1, 2);
  expect(right.left).toBeGreaterThan(0);
});

test('the preview shows a zoomed-out photo at the same place in its cell as the editor', async ({ page }) => {
  await albumWith(page, 'port-1.jpg', 'full');
  await zoomOutFully(page);
  await page.getByTestId('crop-toggle').click();
  await dragPhoto(page, 60);
  await page.getByTestId('crop-toggle').click();
  const editor = await relBox(page, 'cell-1-0');
  expect(editor.left).toBeGreaterThan(0.5 - (editor.right - editor.left) / 2 + 0.01);

  await page.getByTestId('action-preview').click();
  await expect(page.getByTestId('preview-spread')).toHaveAttribute('data-spread-index', '1');
  await expect(page.getByTestId('preview-cell-0').locator('img')).toBeVisible();
  const preview = await relBox(page, 'preview-cell-0');
  for (const k of ['left', 'top', 'right', 'bottom'] as const) expect(Math.abs(preview[k] - editor[k])).toBeLessThan(0.01);
});

test('the export of a zoomed-out photo has the album background in the bands and the photo where the editor shows it', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'The print export at full size is a desktop flow');
  test.setTimeout(120_000);
  // Without the folder picker the export takes the ZIP path.
  await page.addInitScript(() => {
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });
  await albumWith(page, 'port-1.jpg', 'full');
  await page.getByTestId('action-settings').click();
  await page.getByTestId('setting-bg-black').check();
  await page.getByTestId('settings-close').click();
  await zoomOutFully(page);
  await page.getByTestId('crop-toggle').click();
  await dragPhoto(page, 60);
  await page.getByTestId('crop-toggle').click();
  // On template full the cell is the whole canvas, bleed included, so cell fractions are image fractions.
  const editor = await relBox(page, 'cell-1-0');

  const download = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByTestId('action-export').click();
  await page.getByTestId('export-start').click();
  const files = unzipSync(new Uint8Array(await readFile((await (await download).path())!)));

  const found = await page.evaluate(
    async ([base64, l, r]) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      const w = Math.round(bitmap.width / 8);
      const h = Math.round(bitmap.height / 8);
      const ctx = new OffscreenCanvas(w, h).getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const row = ctx.getImageData(0, Math.round(h / 2), w, 1).data;
      const at = (f: number) => Array.from(row.subarray(Math.round(f * w) * 4, Math.round(f * w) * 4 + 3));
      const isBackground = (x: number) => Math.abs(row[x * 4] - 0x1d) + Math.abs(row[x * 4 + 1] - 0x1d) + Math.abs(row[x * 4 + 2] - 0x1d) < 30;
      let first = 0;
      while (first < w && isBackground(first)) first++;
      let last = w - 1;
      while (last >= 0 && isBackground(last)) last--;
      // The wider band, then the centre of the photo.
      const band = l > 1 - r ? l / 2 : (1 + r) / 2;
      return { band: at(band), centre: at((l + r) / 2), left: first / w, right: (last + 1) / w };
    },
    [Buffer.from(files['spreads/spread-01.jpg']).toString('base64'), editor.left, editor.right] as const,
  );

  for (const c of found.band) expect(Math.abs(c - 0x1d)).toBeLessThan(10);
  expect(found.centre.reduce((s, c) => s + Math.abs(c - 0x1d), 0)).toBeGreaterThan(60);
  expect(Math.abs(found.left - editor.left)).toBeLessThan(0.01);
  expect(Math.abs(found.right - editor.right)).toBeLessThan(0.01);
});

test('on row3, a border drag keeps a zoomed-out photo inside its cell, and a wider cell shows it at the new limit', async ({ page }) => {
  await albumWith(page, 'land-1.jpg', 'row3');
  await zoomOutFully(page);
  await page.getByTestId('crop-toggle').click();
  const width = (await page.getByTestId('cell-1-0').boundingBox())!.width;
  await dragPhoto(page, -width);
  // Gutters do not show in crop mode.
  await page.getByTestId('crop-toggle').click();

  const dragGutter = async (dx: number) => {
    const g = (await page.getByTestId('gutter-0').boundingBox())!;
    const x = g.x + g.width / 2;
    const y = g.y + g.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y);
    await page.mouse.up();
  };
  const inside = (r: Awaited<ReturnType<typeof relBox>>) => {
    expect(r.left).toBeGreaterThanOrEqual(-0.005);
    expect(r.top).toBeGreaterThanOrEqual(-0.005);
    expect(r.right).toBeLessThanOrEqual(1.005);
    expect(r.bottom).toBeLessThanOrEqual(1.005);
  };

  await dragGutter(-width * 0.3);
  expect((await page.getByTestId('cell-1-0').boundingBox())!.width).toBeLessThan(width * 0.9);
  inside(await relBox(page, 'cell-1-0'));

  await dragGutter(width * 0.8);
  expect((await page.getByTestId('cell-1-0').boundingBox())!.width).toBeGreaterThan(width * 1.2);
  const r = await relBox(page, 'cell-1-0');
  inside(r);
  // land-1.jpg is wider than the cell is, so the whole photo touches the left and the right: half of it is half the width.
  expect(Math.abs(r.right - r.left - 0.5)).toBeLessThan(0.02);
});
