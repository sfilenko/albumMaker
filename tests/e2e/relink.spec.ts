import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const LAND = [1, 2, 3, 4, 5, 6].map((n) => join(FIXTURES, `land-${n}.jpg`));
const DUP_A = join(FIXTURES, 'dup-a', 'IMG_0001.jpg');
const DUP_B = join(FIXTURES, 'dup-b', 'IMG_0001.jpg');
const ALBUM = '/src/model/album.ts';
const HOUR_MS = 60 * 60 * 1000;

// Without the File System Access pickers, a layout file saves as a download and opens from a
// file input, as in Safari and Firefox. Playwright can drive both.
async function withoutPickers(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
    delete w.showDirectoryPicker;
  });
}

test.beforeEach(async ({ page }) => withoutPickers(page));

async function newAlbumWithPhotos(page: Page, files: string[]) {
  await page.goto('/');
  await page.getByTestId('create-album').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-photos').click();
  await (await chooser).setFiles(files);
  await expect(page.getByTestId('photo-counter')).toHaveText(`використано 0 / ${files.length}`);
}

/** Spread 1 on `templateId`, with the album's photos in its cells in the order of `widths`. */
async function placeByWidth(page: Page, templateId: string, widths: number[]) {
  await page.evaluate(
    async ([path, t, ws]) => {
      const m = await import(path);
      window.__store!.dispatch((a) => {
        let next = m.applyTemplate(a, a.spreads[1].id, t);
        const free = [...a.photos];
        ws.forEach((w, i) => {
          const photo = free.splice(free.findIndex((p) => p.width === w), 1)[0];
          next = m.placePhoto(next, { spreadId: a.spreads[1].id, cellIndex: i }, photo.id);
        });
        return next;
      });
    },
    [ALBUM, templateId, widths] as const,
  );
}

async function saveLayout(page: Page, testInfo: TestInfo, name = 'album.album.json'): Promise<string> {
  const download = page.waitForEvent('download');
  await page.getByTestId('action-save-file').click();
  const path = testInfo.outputPath(name);
  await (await download).saveAs(path);
  return path;
}

/** A second browser with empty storage: the other device. */
async function otherDevice(browser: Browser, page: Page, testInfo: TestInfo): Promise<Page> {
  const context = await browser.newContext({ ...testInfo.project.use, baseURL: new URL(page.url()).origin });
  const other = await context.newPage();
  await withoutPickers(other);
  return other;
}

async function openLayout(page: Page, path: string, button = 'action-open-file') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(button).click();
  await (await chooser).setFiles(path);
}

async function relinkWith(page: Page, files: string[]) {
  await page.getByTestId('find-missing').click();
  await expect(page.getByTestId('relink-dialog')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('relink-choose-files').click();
  await (await chooser).setFiles(files);
}

/** The colour of the photo at 8 % from its left edge, half-way down: the fixture's background. */
function photoColour(page: Page, testId: string): Promise<{ r: number; g: number; b: number }> {
  return page
    .getByTestId(testId)
    .locator('img')
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const [r, g, b] = ctx.getImageData(Math.round(c.width * 0.08), Math.round(c.height / 2), 1, 1).data;
      return { r, g, b };
    });
}

test('a layout file opened in an empty browser shows grey boxes with file names, and a relink with the land fixtures shows the photos', async ({
  page,
  browser,
}, testInfo) => {
  await newAlbumWithPhotos(page, LAND.slice(0, 3));
  await placeByWidth(page, 'row3', [1800, 1800, 1800]);
  await expect(page.getByTestId('cell-1-2').locator('img')).toBeVisible();
  const file = await saveLayout(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  const origin = new URL(page.url()).origin;
  const requests: string[] = [];
  other.on('request', (r) => requests.push(r.url()));
  await other.goto('/');
  await expect(other.getByTestId('album-item')).toHaveCount(0);
  await openLayout(other, file, 'open-file');

  await expect(other.getByTestId('editor')).toBeVisible();
  await expect(other.getByTestId('album-title')).toHaveText('Новий альбом');
  for (const [i, name] of ['land-1.jpg', 'land-2.jpg', 'land-3.jpg'].entries()) {
    const box = other.getByTestId(`missing-1-${i}`);
    await expect(box).toContainText(name);
    await expect(other.getByTestId(`find-photo-1-${i}`)).toHaveText('Знайти фото');
  }
  await expect(other.getByTestId('cell-1-0').locator('img')).toHaveCount(0);
  await expect(other.getByTestId('missing-bar')).toContainText('3');
  await expect(other.getByTestId('banner-print-warnings')).toContainText('не знайдено фото: 3');

  await relinkWith(other, LAND);
  await expect(other.getByTestId('relink-all-found')).toBeVisible();
  await other.getByTestId('relink-close').click();
  for (const [i, name] of ['land-1.jpg', 'land-2.jpg', 'land-3.jpg'].entries()) {
    await expect(other.getByTestId(`cell-1-${i}`).locator('img')).toHaveAttribute('alt', name);
  }
  await expect(other.getByTestId('missing-bar')).toHaveCount(0);
  await expect(other.getByTestId('banner-print-warnings')).not.toContainText('не знайдено фото');
  // The photo column shows the new screen copies, not the "no screen copy" that it saw first.
  await expect(other.getByTestId('photo-land-1.jpg').locator('img')).toBeVisible();

  // Photos never leave the device: every request goes to the app's own origin.
  const foreign = requests.filter((u) => /^https?:/.test(u) && new URL(u).origin !== origin);
  expect(foreign).toEqual([]);
  await other.context().close();
});

test('dup-a/IMG_0001.jpg and dup-b/IMG_0001.jpg relink to the right cells', async ({ page, browser }, testInfo) => {
  await newAlbumWithPhotos(page, [DUP_A, DUP_B]);
  // dup-a is 1800 px wide and green, dup-b is 1600 px wide and magenta.
  await placeByWidth(page, 'two', [1800, 1600]);
  const file = await saveLayout(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  await other.goto('/');
  await openLayout(other, file, 'open-file');
  await expect(other.getByTestId('missing-1-0')).toContainText('IMG_0001.jpg');
  await expect(other.getByTestId('missing-1-1')).toContainText('IMG_0001.jpg');

  await relinkWith(other, [DUP_B, DUP_A]);
  await expect(other.getByTestId('relink-all-found')).toBeVisible();
  await other.getByTestId('relink-close').click();
  await expect(other.getByTestId('cell-1-0').locator('img')).toBeVisible();
  await expect(other.getByTestId('cell-1-1').locator('img')).toBeVisible();

  const a = await photoColour(other, 'cell-1-0');
  const b = await photoColour(other, 'cell-1-1');
  expect(a.g).toBeGreaterThan(a.r + 60);
  expect(b.r).toBeGreaterThan(b.g + 60);
  await other.context().close();
});

test('a layout file whose album exists asks "Замінити наявний альбом?" before it replaces anything', async ({ page }, testInfo) => {
  await newAlbumWithPhotos(page, LAND.slice(0, 1));
  const file = await saveLayout(page, testInfo);
  await page.evaluate(async (path) => {
    const m = await import(path);
    window.__store!.dispatch((a) => m.renameAlbum(a, 'Змінений'));
  }, ALBUM);
  await expect(page.getByTestId('album-title')).toHaveText('Змінений');

  const messages: string[] = [];
  page.once('dialog', (d) => {
    messages.push(d.message());
    void d.dismiss();
  });
  await openLayout(page, file);
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toContain('Замінити наявний альбом?');
  await expect(page.getByTestId('album-title')).toHaveText('Змінений');
  await page.reload();
  await expect(page.getByTestId('album-title')).toHaveText('Змінений');

  page.once('dialog', (d) => void d.accept());
  await openLayout(page, file);
  await expect(page.getByTestId('album-title')).toHaveText('Новий альбом');
  await page.reload();
  await expect(page.getByTestId('album-title')).toHaveText('Новий альбом');
});

test('when IndexedDB put throws QuotaExceededError, an edit shows the storage error banner with "Зберегти у файл"', async ({ page }) => {
  await newAlbumWithPhotos(page, LAND.slice(0, 1));
  await expect(page.getByTestId('banner-storage-error')).toHaveCount(0);

  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  });
  await placeByWidth(page, 'two', [1800]);

  const banner = page.getByTestId('banner-storage-error');
  await expect(banner).toBeVisible();
  await expect(page.getByTestId('banner-storage-error-save')).toHaveText('Зберегти у файл');
  const download = page.waitForEvent('download');
  await page.getByTestId('banner-storage-error-save').click();
  expect((await download).suggestedFilename()).toBe('Новий альбом.album.json');
});

test('with the clock 4 days after an edit, the backup banner shows, and a file save closes it', async ({ page }) => {
  await page.clock.install();
  await newAlbumWithPhotos(page, LAND.slice(0, 1));
  await placeByWidth(page, 'two', [1800]);
  await page.clock.fastForward(HOUR_MS);
  await expect(page.getByTestId('banner-backup')).toHaveCount(0);

  await page.clock.fastForward(96 * HOUR_MS);
  await expect(page.getByTestId('banner-backup')).toBeVisible();
  await expect(page.getByTestId('banner-backup-save')).toHaveText('Зберегти у файл');

  const download = page.waitForEvent('download');
  await page.getByTestId('banner-backup-save').click();
  await download;
  await expect(page.getByTestId('banner-backup')).toHaveCount(0);
});

test('a layout file saved after 4 days of edits opens without the backup banner, on another device and on this one', async ({
  page,
  browser,
}, testInfo) => {
  await page.clock.install();
  await newAlbumWithPhotos(page, LAND.slice(0, 1));
  await page.clock.fastForward(96 * HOUR_MS);
  await placeByWidth(page, 'two', [1800]);
  await expect(page.getByTestId('banner-backup')).toBeVisible();
  const file = await saveLayout(page, testInfo);
  await expect(page.getByTestId('banner-backup')).toHaveCount(0);

  // The other device's clock reads the same time, 2 minutes after the save.
  const other = await otherDevice(browser, page, testInfo);
  await other.clock.install({ time: (await page.evaluate(() => Date.now())) + 2 * 60 * 1000 });
  await other.goto('/');
  await openLayout(other, file, 'open-file');
  await expect(other.getByTestId('editor')).toBeVisible();
  await expect(other.getByTestId('missing-1-0')).toBeVisible();
  await expect(other.getByTestId('banner-backup')).toHaveCount(0);
  await other.context().close();

  // A rename after the save, so the title shows that the replace happened.
  await page.evaluate(async (path) => {
    const m = await import(path);
    window.__store!.dispatch((a) => m.renameAlbum(a, 'Змінений'));
  }, ALBUM);
  await expect(page.getByTestId('album-title')).toHaveText('Змінений');
  const dialog = page.waitForEvent('dialog');
  await openLayout(page, file);
  await (await dialog).accept();
  await expect(page.getByTestId('album-title')).toHaveText('Новий альбом');
  await expect(page.getByTestId('cell-1-0').locator('img')).toBeVisible();
  await expect(page.getByTestId('banner-backup')).toHaveCount(0);
});
