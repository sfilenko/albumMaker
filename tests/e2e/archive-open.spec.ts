import { chromium, devices, expect, test, webkit, type Browser, type BrowserContext, type FileChooser, type Page, type TestInfo } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ALBUM, albumJson, DB, DUP_A, DUP_B, fixtureSha, LAND_1, LAND_2, newAlbum, ORIGINALS, PORT_1, recorded, recordTexts, sha } from './archive-helpers';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
const NOTES = join(FIXTURES, 'notes.txt');
const NINE = [1, 2, 3, 4, 5, 6].map((n) => join(FIXTURES, `land-${n}.jpg`)).concat([1, 2, 3].map((n) => join(FIXTURES, `port-${n}.jpg`)));
const LAYOUT = '/src/model/layout.ts';
const SUBFOLDER = 'album-Новий альбом';

type FolderStub = 'opfs' | 'abort-once' | 'security-once' | 'createWritable-fails' | 'refuse-name';
interface HeldPicker { calls: number; reads: number; end: ((file: File | null, error: string) => void) | null }
interface AlbumFile { format: string; version: number; album: { id: string; name: string; photos: { id: string; name: string; size: number }[] } }

test.setTimeout(120_000);

// Without the pickers, a save is a download and an open is a file input, as in Safari and Firefox.
async function withoutPickers(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
    delete w.showDirectoryPicker;
  });
}

/** A folder picker on the storage of the browser, which survives a reload. No test shows a real one. */
async function stubFolderPicker(page: Page, mode: FolderStub) {
  await page.addInitScript((m) => {
    const w = window as unknown as Record<string, unknown>;
    w.__folderPickerCalls = 0;
    w.showDirectoryPicker = async () => {
      const calls = (w.__folderPickerCalls = (w.__folderPickerCalls as number) + 1);
      if (m === 'abort-once' && calls === 1) throw new DOMException('The user aborted a request.', 'AbortError');
      if (m === 'security-once' && calls === 1) throw new DOMException('Must be handling a user gesture.', 'SecurityError');
      return navigator.storage.getDirectory();
    };
    if (m === 'createWritable-fails') {
      FileSystemFileHandle.prototype.createWritable = () => Promise.reject(new DOMException('No free space', 'QuotaExceededError'));
    }
    if (m === 'refuse-name') {
      const getFileHandle = FileSystemDirectoryHandle.prototype.getFileHandle;
      FileSystemDirectoryHandle.prototype.getFileHandle = function (this: FileSystemDirectoryHandle, name: string, options?: FileSystemGetFileOptions) {
        if (name === 'land-1.jpg') return Promise.reject(new TypeError('Name is not allowed.'));
        return getFileHandle.call(this, name, options);
      };
    }
  }, mode);
}

const folderPickerCalls = (page: Page) => page.evaluate(() => (window as unknown as { __folderPickerCalls: number }).__folderPickerCalls);

const desktopOnly = (browserName: string, why = 'WebKit has no folder picker, and a phone exports only pages') =>
  test.skip(browserName !== 'chromium', why);

let extraContexts: BrowserContext[] = [];

test.beforeEach(async ({ page }) => withoutPickers(page));

test.afterEach(async () => {
  await Promise.all(extraContexts.map((c) => c.close()));
  extraContexts = [];
});

/** A second browser with empty storage: the other device. */
async function otherDevice(browser: Browser, page: Page, testInfo: TestInfo, stub?: FolderStub): Promise<Page> {
  const context = await browser.newContext({ ...testInfo.project.use, baseURL: new URL(page.url()).origin });
  extraContexts.push(context);
  const other = await context.newPage();
  await withoutPickers(other);
  if (stub) await stubFolderPicker(other, stub);
  await other.goto('/');
  return other;
}

/**
 * Keeps the cover and one spread with `templateId`, so that an export stays short. The photos at
 * `indexes` go into the cells of the spread, and the photo at `cover` goes on the cover.
 */
async function placePhotos(page: Page, templateId: string, indexes: number[], cover?: number) {
  await page.evaluate(
    async ([path, t, which, onCover]) => {
      const m = await import(path);
      window.__store!.dispatch((a) => {
        let next = a;
        for (const s of a.spreads.slice(2)) next = m.removeSpread(next, s.id);
        next = m.applyTemplate(next, a.spreads[1].id, t);
        which.forEach((p, cellIndex) => {
          next = m.placePhoto(next, { spreadId: a.spreads[1].id, cellIndex }, a.photos[p].id);
        });
        if (onCover !== null) next = m.placePhoto(next, { spreadId: a.spreads[0].id, cellIndex: 0 }, a.photos[onCover].id);
        return next;
      });
    },
    [ALBUM, templateId, indexes, cover ?? null] as const,
  );
  const total = await page.evaluate(() => window.__store!.album.value.photos.length);
  await expect(page.getByTestId('photo-counter')).toHaveText(`використано ${indexes.length + (cover === undefined ? 0 : 1)} / ${total}`);
}

/** 3 photos in the column: land-1.jpg and port-1.jpg in cells, land-2.jpg unused. */
async function albumOfThree(page: Page) {
  await newAlbum(page, [LAND_1, LAND_2, PORT_1]);
  await placePhotos(page, 'two', [0, 2]);
}

async function saveArchive(page: Page, testInfo: TestInfo, name = 'saved.album.zip'): Promise<string> {
  await page.getByTestId('action-save-archive').click();
  await page.getByTestId('archive-start').click();
  await expect(page.getByTestId('archive-link')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('archive-save').click();
  const path = testInfo.outputPath(name);
  await (await download).saveAs(path);
  await page.getByTestId('archive-close').click();
  return path;
}

async function saveLayout(page: Page, testInfo: TestInfo): Promise<string> {
  const download = page.waitForEvent('download');
  await page.getByTestId('action-save-file').click();
  const path = testInfo.outputPath('saved.album.json');
  await (await download).saveAs(path);
  return path;
}

async function chooseFile(page: Page, path: string, button = 'action-open-file') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(button).click();
  await (await chooser).setFiles(path);
}

async function closeDone(page: Page) {
  await expect(page.getByTestId('archive-open-done')).toHaveText('Альбом відкрито.');
  await page.getByTestId('archive-open-close').click();
  await expect(page.getByTestId('archive-open-dialog')).toHaveCount(0);
}

async function openArchive(page: Page, path: string, button = 'action-open-file') {
  await chooseFile(page, path, button);
  await closeDone(page);
}

async function openWithFolder(page: Page, path: string, button = 'action-open-file') {
  await chooseFile(page, path, button);
  await page.getByTestId('archive-open-choose-folder').click();
  await closeDone(page);
}

async function exportToEnd(page: Page) {
  await page.getByTestId('action-export').click();
  await expect(page.getByTestId('export-start')).toBeEnabled();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('export-need-originals')).toHaveCount(0);
  await page.getByTestId('export-close').click();
}

/** The name and the sha256 of each file of a subfolder of the browser storage. */
function folderFiles(page: Page, folder = SUBFOLDER): Promise<Record<string, string>> {
  return page.evaluate(async (name) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
    const out: Record<string, string> = {};
    for await (const entry of dir.values()) {
      if (entry.kind !== 'file') continue;
      const bytes = await (await (entry as FileSystemFileHandle).getFile()).arrayBuffer();
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      out[entry.name] = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    return out;
  }, folder);
}

function rootEntries(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names: string[] = [];
    for await (const entry of (await navigator.storage.getDirectory()).values()) names.push(entry.name);
    return names;
  });
}

const readAlbumFile = async (path: string): Promise<AlbumFile> =>
  JSON.parse(strFromU8(unzipSync(new Uint8Array(await readFile(path)))['album.json'])) as AlbumFile;

/** A new archive from a saved one, with the entries and the layout that `edit` changes. */
async function craftedArchive(
  source: string,
  testInfo: TestInfo,
  edit: (entries: Record<string, Uint8Array>, file: AlbumFile) => void,
): Promise<string> {
  const entries = unzipSync(new Uint8Array(await readFile(source)));
  const file = JSON.parse(strFromU8(entries['album.json'])) as AlbumFile;
  edit(entries, file);
  entries['album.json'] = strToU8(JSON.stringify(file));
  const path = testInfo.outputPath('crafted.album.zip');
  await writeFile(path, zipSync(entries, { level: 0 }));
  return path;
}

/** A copy of the archive with one changed byte inside the photo land-1.jpg. */
async function damagedArchive(source: string, testInfo: TestInfo): Promise<string> {
  const bytes = await readFile(source);
  bytes[bytes.indexOf(await readFile(LAND_1)) + 200] ^= 0xff;
  const path = testInfo.outputPath('damaged.album.zip');
  await writeFile(path, bytes);
  return path;
}

/** The sha256 of the file that the app reads as the original of the named photo. */
async function originalSha(page: Page, name: string): Promise<string> {
  const base64 = await page.evaluate(
    async ([m, photoName]) => {
      const { readOriginals } = await import(m);
      const album = window.__store!.album.value;
      const photo = album.photos.find((p) => p.name === photoName)!;
      const originals: Map<string, File> = await readOriginals(album.id, [photo]);
      const file = originals.get(photo.id)!;
      return btoa(Array.from(new Uint8Array(await file.arrayBuffer()), (b) => String.fromCharCode(b)).join(''));
    },
    [ORIGINALS, name] as const,
  );
  return sha(Buffer.from(base64, 'base64'));
}

/** The count of screen copies that the store holds for these photos. */
function storedCopies(page: Page, ids: string[]): Promise<number> {
  return page.evaluate(
    async ([path, list]) => {
      const { getPreview } = await import(path);
      const found = await Promise.all(list.flatMap((id) => [getPreview(id, 'full'), getPreview(id, 'thumb')]));
      return found.filter(Boolean).length;
    },
    [DB, ids] as const,
  );
}

/** The album in the editor, its counter and its stored form stay as they were. */
async function expectAlbumKept(page: Page, before: string) {
  await expect(page.getByTestId('archive-open-dialog')).toHaveCount(0);
  expect(await albumJson(page)).toBe(before);
  const stored = await page.evaluate(async (path) => {
    const { loadAlbum } = await import(path);
    return JSON.stringify(await loadAlbum(window.__store!.album.value.id));
  }, DB);
  expect(stored).toBe(before);
}

async function expectStoredCurrent(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { loadAlbum } = await import(path);
        return JSON.stringify(await loadAlbum(window.__store!.album.value.id));
      }, DB),
    )
    .toBe(await albumJson(page));
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

async function expectNoMissingPhoto(page: Page, names: string[], cells: number) {
  await expect(page.getByTestId('photo-counter')).toHaveText(`використано ${names.length} / ${names.length}`);
  for (const name of names) {
    const thumb = page.getByTestId(`photo-${name}`);
    await expect(thumb).toHaveAttribute('data-missing', 'false');
    await expect(thumb.locator('img')).toBeVisible();
  }
  for (let i = 0; i < cells; i++) await expect(page.getByTestId(`cell-1-${i}`).locator('img')).toBeVisible();
  await expect(page.getByTestId('missing-bar')).toHaveCount(0);
  await expect(page.getByTestId('relink-dialog')).toHaveCount(0);
  await expect(page.getByTestId('banner-print-warnings')).not.toContainText('не знайдено фото');
}

test('the album list opens an archive in a clean browser: every photo shows, and the unused photo is absent', async ({ page, browser }, testInfo) => {
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  await expect(other.getByTestId('album-item')).toHaveCount(0);
  await openArchive(other, path, 'open-file');

  await expect(other.getByTestId('album-title')).toHaveText('Новий альбом');
  await expectNoMissingPhoto(other, ['land-1.jpg', 'port-1.jpg'], 2);
  await expect(other.getByTestId('photo-land-2.jpg')).toHaveCount(0);
});

test('the editor opens an archive, and the earlier album stays in the album list', async ({ page, browser }, testInfo) => {
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  await newAlbum(other, [LAND_2]);
  await other.evaluate(async (m) => {
    const { renameAlbum } = await import(m);
    window.__store!.dispatch((a) => renameAlbum(a, 'Раніший'));
  }, ALBUM);
  await expect(other.getByTestId('album-title')).toHaveText('Раніший');

  await openArchive(other, path);
  await expect(other.getByTestId('album-title')).toHaveText('Новий альбом');
  await expectNoMissingPhoto(other, ['land-1.jpg', 'port-1.jpg'], 2);

  await other.getByRole('button', { name: '‹ Альбоми' }).click();
  await expect(other.getByTestId('album-name')).toHaveCount(2);
  await expect(other.getByTestId('album-name').filter({ hasText: 'Раніший' })).toHaveCount(1);
});

test('a layout file still opens with no open dialog, and its photos show as missing', async ({ page, browser }, testInfo) => {
  await albumOfThree(page);
  const path = await saveLayout(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  await chooseFile(other, path, 'open-file');
  await expect(other.getByTestId('editor')).toBeVisible();
  await expect(other.getByTestId('archive-open-dialog')).toHaveCount(0);
  await expect(other.getByTestId('missing-1-0')).toContainText('land-1.jpg');
  await expect(other.getByTestId('find-missing')).toBeVisible();
});

test('the spreads, the cells, the crops and the settings equal those of the saved album', async ({ page, browser }, testInfo) => {
  await newAlbum(page, [LAND_1, LAND_2, PORT_1]);
  await placePhotos(page, 'row4', [0, 2]);
  await page.evaluate(
    async ([albumPath, layoutPath]) => {
      const m = await import(albumPath);
      const { gutters } = await import(layoutPath);
      window.__store!.dispatch((a) => {
        const spread = a.spreads[1];
        const crop = { cx: 0.4, cy: 0.6, zoom: 1.5 };
        let next = m.setCrop(a, { spreadId: spread.id, cellIndex: 0 }, crop);
        next = m.updateSettings(next, { background: '#000000', gapMm: 9 });
        return m.moveGutterOp(next, spread.id, gutters(spread.layout, next.settings)[0].ref, 12);
      });
    },
    [ALBUM, LAYOUT] as const,
  );
  const saved = JSON.parse(await albumJson(page));
  expect(saved.spreads[1].cells[0].crop.zoom).toBe(1.5);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  await openArchive(other, path, 'open-file');
  const opened = JSON.parse(await albumJson(other));
  expect(opened.spreads).toEqual(saved.spreads);
  expect(opened.settings).toEqual(saved.settings);
  expect(opened.settings.background).toBe('#000000');
  expect(opened.photos.map((p: { name: string }) => p.name)).toEqual(['land-1.jpg', 'port-1.jpg']);
});

test('a counter advances during the open, and the album opens after its last value', async ({ page, browser }, testInfo) => {
  await newAlbum(page, NINE);
  await placePhotos(page, 'g8', [0, 1, 2, 3, 4, 5, 6, 7], 8);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  await recordTexts(other, 'archive-open-progress');
  await chooseFile(other, path, 'open-file');
  await closeDone(other);

  const seen = await recorded(other);
  expect(new Set(seen).size).toBeGreaterThanOrEqual(2);
  expect(seen.some((t) => t.startsWith('Перевірка архіву:'))).toBe(true);
  expect(seen.at(-1)).toBe('Підготовка фото: 9 / 9');
  await expect(other.getByTestId('photo-counter')).toHaveText('використано 9 / 9');
});

test('without a folder the print export uses the originals until a reload, and then asks for them', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  await openArchive(other, path, 'open-file');
  await expect(other.getByTestId('archive-open-folder')).toHaveCount(0);
  await exportToEnd(other);

  await other.reload();
  await expect(other.getByTestId('photo-counter')).toHaveText('використано 2 / 2');
  await other.getByTestId('action-export').click();
  await expect(other.getByTestId('export-start')).toBeEnabled();
  await other.getByTestId('export-start').click();
  await expect(other.getByTestId('export-need-originals')).toBeVisible();
});

test('with a folder the subfolder holds each photo, and the print export asks for nothing after a reload', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo, 'opfs');
  await openWithFolder(other, path, 'open-file');
  expect(await folderFiles(other)).toEqual({
    'land-1.jpg': await fixtureSha(LAND_1),
    'port-1.jpg': await fixtureSha(PORT_1),
  });
  expect(await rootEntries(other)).toEqual([SUBFOLDER]);

  await expectStoredCurrent(other);
  await other.reload();
  await expectNoMissingPhoto(other, ['land-1.jpg', 'port-1.jpg'], 2);
  await exportToEnd(other);
});

test('a file with the same name and the same bytes in the subfolder is used again', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo, 'opfs');
  await openWithFolder(other, path, 'open-file');
  other.once('dialog', (d) => void d.accept());
  await openWithFolder(other, path);

  expect(Object.keys(await folderFiles(other)).sort()).toEqual(['land-1.jpg', 'port-1.jpg']);
  const names = await other.evaluate(() => window.__store!.album.value.photos.map((p) => p.name));
  expect(names).toEqual(['land-1.jpg', 'port-1.jpg']);
});

test('two photos with one name each keep their own original after a reload', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await newAlbum(page, [DUP_A, DUP_B]);
  await placePhotos(page, 'two', [0, 1]);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo, 'opfs');
  await openWithFolder(other, path, 'open-file');
  expect(await folderFiles(other)).toEqual({
    'IMG_0001.jpg': await fixtureSha(DUP_A),
    'IMG_0001-2.jpg': await fixtureSha(DUP_B),
  });

  await expectStoredCurrent(other);
  await other.reload();
  await expect(other.getByTestId('cell-1-1').locator('img')).toBeVisible();
  // dup-a is green, dup-b is magenta.
  const a = await photoColour(other, 'cell-1-0');
  const b = await photoColour(other, 'cell-1-1');
  expect(a.g).toBeGreaterThan(a.r + 60);
  expect(b.r).toBeGreaterThan(b.g + 60);

  await exportToEnd(other);
  const pages = await other.evaluate(async (album) => {
    const root = await navigator.storage.getDirectory();
    const folder = await (await root.getDirectoryHandle(album)).getDirectoryHandle('pages');
    const colour = async (name: string) => {
      const bitmap = await createImageBitmap(await (await folder.getFileHandle(name)).getFile());
      const ctx = new OffscreenCanvas(8, 8).getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, 8, 8);
      // The fixtures have a white label at the centre, so this reads the background.
      const [r, g] = ctx.getImageData(1, 4, 1, 1).data;
      return { r, g };
    };
    return [await colour('page-001.jpg'), await colour('page-002.jpg')];
  }, 'export-Новий альбом');
  expect(pages[0].g).toBeGreaterThan(pages[0].r + 60);
  expect(pages[1].r).toBeGreaterThan(pages[1].g + 60);
});

test('a file cut short, a foreign ZIP, a .txt file and a newer version each give a message and change nothing', async ({ page, browser }, testInfo) => {
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);
  const bytes = await readFile(path);
  const cutShort = testInfo.outputPath('cut.album.zip');
  await writeFile(cutShort, bytes.subarray(0, Math.floor(bytes.length / 2)));
  const foreign = testInfo.outputPath('foreign.zip');
  await writeFile(foreign, zipSync({ 'readme.txt': strToU8('not an album') }, { level: 0 }));
  const deflated = testInfo.outputPath('deflated.zip');
  await writeFile(deflated, zipSync({ 'album.json': strToU8('x'.repeat(4000)) }, { level: 9 }));
  const newer = await craftedArchive(path, testInfo, (_, file) => {
    file.version = 2;
  });

  const other = await otherDevice(browser, page, testInfo);
  await newAlbum(other, [LAND_2]);
  await expectStoredCurrent(other);
  const before = await albumJson(other);
  const messages: string[] = [];
  other.on('dialog', (d) => {
    messages.push(d.message());
    void d.accept();
  });

  const invalid = 'Цей файл пошкоджено, або він не є архівом альбому. Альбом не змінено.';
  const cases: [string, string][] = [
    [cutShort, invalid],
    [foreign, invalid],
    [deflated, invalid],
    [NOTES, 'Цей файл не є файлом макета альбому.'],
    [newer, 'Цей файл створено в новішій версії програми. Оновіть сторінку й спробуйте ще раз.'],
  ];
  for (const [file, message] of cases) {
    const count = messages.length;
    await chooseFile(other, file);
    await expect.poll(() => messages.length).toBe(count + 1);
    expect(messages.at(-1)).toBe(message);
    await expectAlbumKept(other, before);
  }
  await other.getByRole('button', { name: '‹ Альбоми' }).click();
  await expect(other.getByTestId('album-item')).toHaveCount(1);
});

test('a read of the archive that fails gives a message and changes nothing', async ({ page, browser }, testInfo) => {
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  await newAlbum(other, [LAND_2]);
  await expectStoredCurrent(other);
  const before = await albumJson(other);
  await other.evaluate(() => {
    const slice = Blob.prototype.slice;
    Blob.prototype.slice = function (this: Blob, ...args: Parameters<Blob['slice']>) {
      const part = slice.apply(this, args);
      if (this instanceof File && this.name.endsWith('.zip')) {
        part.arrayBuffer = () => Promise.reject(new DOMException('The file changed', 'NotReadableError'));
      }
      return part;
    };
  });
  const message = new Promise<string>((resolve) => {
    other.once('dialog', (d) => {
      resolve(d.message());
      void d.accept();
    });
  });
  await chooseFile(other, path);
  expect(await message).toBe('Не вдалося відкрити файл: The file changed');
  await expectAlbumKept(other, before);
});

test('a changed photo byte gives an error in the dialog, keeps the album and leaves no screen copy', async ({ page, browser }, testInfo) => {
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);
  const ids = (await readAlbumFile(path)).album.photos.map((p) => p.id);
  const damaged = await damagedArchive(path, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  await newAlbum(other, [LAND_2]);
  await expectStoredCurrent(other);
  const before = await albumJson(other);

  await chooseFile(other, damaged);
  await expect(other.getByTestId('archive-open-error')).toContainText('Архів пошкоджено');
  await expect(other.getByTestId('archive-open-done')).toHaveCount(0);
  expect(await storedCopies(other, ids)).toBe(0);
  await other.getByTestId('archive-open-close').click();
  await expectAlbumKept(other, before);
});

test('a read of a photo that fails during the check gives an error in the dialog and keeps the album', async ({ page, browser }, testInfo) => {
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  await newAlbum(other, [LAND_2]);
  await expectStoredCurrent(other);
  const before = await albumJson(other);
  await other.evaluate(() => {
    const slice = Blob.prototype.slice;
    Blob.prototype.slice = function (this: Blob, ...args: Parameters<Blob['slice']>) {
      const part = slice.apply(this, args);
      if (this instanceof File && this.name === 'port-1.jpg') {
        part.arrayBuffer = () => Promise.reject(new DOMException('The file changed', 'NotReadableError'));
      }
      return part;
    };
  });

  await chooseFile(other, path);
  await expect(other.getByTestId('archive-open-error')).toContainText('The file changed');
  await other.getByTestId('archive-open-close').click();
  await expectAlbumKept(other, before);
});

test('the confirmation runs for an album with the same id: a cancel changes nothing, and an accept replaces the album and drops old copies', async ({ page }, testInfo) => {
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);
  const [firstId, unusedId, lastId] = await page.evaluate(() => window.__store!.album.value.photos.map((p) => p.id));
  expect(await storedCopies(page, [unusedId])).toBe(2);
  await page.evaluate(async (m) => {
    const { renameAlbum } = await import(m);
    window.__store!.dispatch((a) => renameAlbum(a, 'Змінений'));
  }, ALBUM);
  await expect(page.getByTestId('album-title')).toHaveText('Змінений');
  await expectStoredCurrent(page);
  const before = await albumJson(page);

  const messages: string[] = [];
  page.once('dialog', (d) => {
    messages.push(d.message());
    void d.dismiss();
  });
  await chooseFile(page, path);
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toContain('Замінити наявний альбом?');
  await expectAlbumKept(page, before);

  page.once('dialog', (d) => void d.accept());
  await openArchive(page, path);
  await expect(page.getByTestId('album-title')).toHaveText('Новий альбом');
  await expectNoMissingPhoto(page, ['land-1.jpg', 'port-1.jpg'], 2);
  await expect(page.getByTestId('photo-land-2.jpg')).toHaveCount(0);
  // No stored album holds the unused photo after the replace.
  await expect.poll(() => storedCopies(page, [unusedId])).toBe(0);
  // The new album holds these two photos, so they keep their screen copies.
  expect(await storedCopies(page, [firstId, lastId])).toBe(4);

  await expectStoredCurrent(page);
  await page.reload();
  await expect(page.getByTestId('album-title')).toHaveText('Новий альбом');
  await expectNoMissingPhoto(page, ['land-1.jpg', 'port-1.jpg'], 2);
});

test('an archive with no photo shows no folder step, and the folder picker does not run', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await newAlbum(page, [LAND_1]);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo, 'opfs');
  await chooseFile(other, path, 'open-file');
  await expect(other.getByTestId('archive-open-done')).toBeVisible();
  await expect(other.getByTestId('archive-open-folder')).toHaveCount(0);
  await closeDone(other);
  await expect(other.getByTestId('photo-counter')).toHaveText('використано 0 / 0');
  expect(await folderPickerCalls(other)).toBe(0);
  expect(await rootEntries(other)).toEqual([]);
});

test('a replace with no folder removes the old folder handle, and the export asks for originals after a reload', async ({ page, browserName }, testInfo) => {
  desktopOnly(browserName);
  await stubFolderPicker(page, 'opfs');
  await albumOfThree(page);
  // The old folder holds files with the names and the sizes of the photos, so an old handle finds them.
  const files = { 'land-1.jpg': Array.from(await readFile(LAND_1)), 'port-1.jpg': Array.from(await readFile(PORT_1)) };
  await page.evaluate(
    async ([m, list]) => {
      const { putDirHandle } = await import(m);
      const earlier = await (await navigator.storage.getDirectory()).getDirectoryHandle('earlier', { create: true });
      for (const [name, bytes] of Object.entries(list)) {
        const writable = await (await earlier.getFileHandle(name, { create: true })).createWritable();
        await writable.write(new Uint8Array(bytes));
        await writable.close();
      }
      await putDirHandle(window.__store!.album.value.id, earlier);
    },
    [DB, files] as const,
  );
  const path = await saveArchive(page, testInfo);

  page.once('dialog', (d) => void d.accept());
  await chooseFile(page, path);
  await page.getByTestId('archive-open-continue').click();
  await closeDone(page);
  const noHandle = await page.evaluate(async (m) => {
    const { getDirHandle } = await import(m);
    return (await getDirHandle(window.__store!.album.value.id)) === undefined;
  }, DB);
  expect(noHandle).toBe(true);

  await expectStoredCurrent(page);
  await page.reload();
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 2 / 2');
  await page.getByTestId('action-export').click();
  await expect(page.getByTestId('export-start')).toBeEnabled();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-need-originals')).toBeVisible();
  await expect(page.getByTestId('export-need-originals')).toContainText('(2)');
});

for (const button of ['archive-open-continue', 'archive-open-choose-folder']) {
  test(`a double click on ${button} and a close before the render open the album one time`, async ({ page, browser, browserName }, testInfo) => {
    desktopOnly(browserName);
    await albumOfThree(page);
    const path = await saveArchive(page, testInfo);

    const other = await otherDevice(browser, page, testInfo, 'opfs');
    await newAlbum(other, [LAND_2]);
    await expectStoredCurrent(other);
    await chooseFile(other, path);
    await expect(other.getByTestId(button)).toBeVisible();

    // Each photo has 2 screen copies, so a second run of the steps writes more than 4 copies.
    await other.evaluate((id) => {
      const counter = window as unknown as { __copies: number };
      counter.__copies = 0;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
        if (this.name === 'previews') counter.__copies++;
        return put.apply(this, args);
      };
      // The three clicks come in one task, before any render.
      const target = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
      target.click();
      target.click();
      document.querySelector<HTMLElement>('[data-testid="archive-open-close"]')!.click();
    }, button);

    await closeDone(other);
    expect(await other.evaluate(() => (window as unknown as { __copies: number }).__copies)).toBe(4);
    if (button === 'archive-open-choose-folder') {
      expect(await folderPickerCalls(other)).toBe(1);
      expect(Object.keys(await folderFiles(other)).sort()).toEqual(['land-1.jpg', 'port-1.jpg']);
    } else {
      expect(await folderPickerCalls(other)).toBe(0);
      expect(await rootEntries(other)).toEqual([]);
    }
    await expect(other.getByTestId('album-title')).toHaveText('Новий альбом');

    // A later edit saves with no error.
    await other.evaluate(async (m) => {
      const { renameAlbum } = await import(m);
      window.__store!.dispatch((a) => renameAlbum(a, 'Після відкриття'));
    }, ALBUM);
    await expect(other.getByTestId('album-title')).toHaveText('Після відкриття');
    await expectStoredCurrent(other);
    await expect(other.getByTestId('banner-storage-error')).toHaveCount(0);
  });
}

test('an archive with no used photo opens with an empty photo column', async ({ page, browser }, testInfo) => {
  await newAlbum(page, [LAND_1]);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  await openArchive(other, path, 'open-file');
  await expect(other.getByTestId('photo-counter')).toHaveText('використано 0 / 0');
  await expect(other.getByTestId('photo-land-1.jpg')).toHaveCount(0);
});

test('a folder picker that rejects with an AbortError still opens the album, and the export finishes', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo, 'abort-once');
  await chooseFile(other, path, 'open-file');
  await other.getByTestId('archive-open-choose-folder').click();
  await closeDone(other);
  await expectNoMissingPhoto(other, ['land-1.jpg', 'port-1.jpg'], 2);
  expect(await rootEntries(other)).toEqual([]);
  await exportToEnd(other);
});

test('a folder picker that rejects with another error shows the error and keeps the album', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo, 'security-once');
  await newAlbum(other, [LAND_2]);
  await expectStoredCurrent(other);
  const before = await albumJson(other);

  await chooseFile(other, path);
  await other.getByTestId('archive-open-choose-folder').click();
  await expect(other.getByTestId('archive-open-error')).toContainText('Must be handling a user gesture.');
  await expect(other.getByTestId('archive-open-done')).toHaveCount(0);
  expect(await rootEntries(other)).toEqual([]);
  await other.getByTestId('archive-open-close').click();
  await expectAlbumKept(other, before);
});

test('the continue button opens the album with no folder', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo, 'opfs');
  await chooseFile(other, path, 'open-file');
  await other.getByTestId('archive-open-continue').click();
  await closeDone(other);
  await expectNoMissingPhoto(other, ['land-1.jpg', 'port-1.jpg'], 2);
  expect(await rootEntries(other)).toEqual([]);
});

test('a different file with the same name in the subfolder stays, and the album finds its own photo', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo, 'opfs');
  const otherBytes = Array.from(await readFile(PORT_1));
  await other.evaluate(
    async ([folder, bytes]) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder as string, { create: true });
      const writable = await (await dir.getFileHandle('LAND-1.JPG', { create: true })).createWritable();
      await writable.write(new Uint8Array(bytes as number[]));
      await writable.close();
    },
    [SUBFOLDER, otherBytes] as const,
  );
  await openWithFolder(other, path, 'open-file');

  expect(await folderFiles(other)).toEqual({
    'LAND-1.JPG': await fixtureSha(PORT_1),
    'land-1-2.jpg': await fixtureSha(LAND_1),
    'port-1.jpg': await fixtureSha(PORT_1),
  });
  const names = await other.evaluate(() => window.__store!.album.value.photos.map((p) => p.name));
  expect(names).toEqual(['land-1-2.jpg', 'port-1.jpg']);

  await expectStoredCurrent(other);
  await other.reload();
  await expectNoMissingPhoto(other, ['land-1-2.jpg', 'port-1.jpg'], 2);
  expect(await originalSha(other, 'land-1-2.jpg')).toBe(await fixtureSha(LAND_1));
  await exportToEnd(other);
});

test('a name that the file system refuses gets a new name, and no file leaves the subfolder', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await newAlbum(page, [LAND_1, LAND_2, PORT_1, DUP_A]);
  await placePhotos(page, 'row4', [0, 1, 2, 3]);
  const path = await saveArchive(page, testInfo);
  const crafted = await craftedArchive(path, testInfo, (entries, { album }) => {
    entries['photos/..'] = entries['photos/land-1.jpg'];
    entries['photos/'] = entries['photos/land-2.jpg'];
    entries['photos/same.jpg'] = entries['photos/port-1.jpg'];
    for (const old of ['land-1', 'land-2', 'port-1', 'IMG_0001']) delete entries[`photos/${old}.jpg`];
    // The album sorts its photos by name, so the order differs from the order of the import.
    const photo = (name: string) => album.photos.find((p) => p.name === name)!;
    photo('land-1.jpg').name = '..';
    photo('land-2.jpg').name = '';
    photo('port-1.jpg').name = 'same.jpg';
    const second = photo('IMG_0001.jpg');
    second.name = 'same.jpg';
    second.size = entries['photos/same.jpg'].length;
  });

  const other = await otherDevice(browser, page, testInfo, 'opfs');
  await openWithFolder(other, crafted, 'open-file');
  const names = await other.evaluate(() => window.__store!.album.value.photos.map((p) => p.name));
  expect([...names].sort()).toEqual(['photo-2.jpg', 'photo.jpg', 'same.jpg', 'same.jpg']);
  expect(await rootEntries(other)).toEqual([SUBFOLDER]);
  expect(await folderFiles(other)).toEqual({
    'photo.jpg': await fixtureSha(LAND_1),
    'photo-2.jpg': await fixtureSha(LAND_2),
    'same.jpg': await fixtureSha(PORT_1),
  });
  for (let i = 0; i < 4; i++) await expect(other.getByTestId(`cell-1-${i}`).locator('img')).toBeVisible();
});

test('a name that getFileHandle rejects gets a new name, and the album finds the photo after a reload', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo, 'refuse-name');
  await openWithFolder(other, path, 'open-file');
  expect(await folderFiles(other)).toEqual({
    'land-1-2.jpg': await fixtureSha(LAND_1),
    'port-1.jpg': await fixtureSha(PORT_1),
  });
  const names = await other.evaluate(() => window.__store!.album.value.photos.map((p) => p.name));
  expect(names).toEqual(['land-1-2.jpg', 'port-1.jpg']);

  await expectStoredCurrent(other);
  await other.reload();
  await expectNoMissingPhoto(other, ['land-1-2.jpg', 'port-1.jpg'], 2);
  await exportToEnd(other);
});

test('a write that fails shows an error, keeps the album and the folder clean, and leaves no screen copy', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);
  const { album } = await readAlbumFile(path);

  const other = await otherDevice(browser, page, testInfo, 'createWritable-fails');
  await newAlbum(other, [LAND_2]);
  await expectStoredCurrent(other);
  const before = await albumJson(other);

  await chooseFile(other, path);
  await other.getByTestId('archive-open-choose-folder').click();
  await expect(other.getByTestId('archive-open-error')).toContainText('No free space');
  await expect(other.getByTestId('archive-open-done')).toHaveCount(0);
  expect(await storedCopies(other, album.photos.map((p) => p.id))).toBe(0);
  expect(await folderFiles(other)).toEqual({});
  const noHandle = await other.evaluate(async ([m, id]) => {
    const { getDirHandle } = await import(m);
    return (await getDirHandle(id)) === undefined;
  }, [DB, album.id] as const);
  expect(noHandle).toBe(true);
  await other.getByTestId('archive-open-close').click();
  await expectAlbumKept(other, before);
});

const failScreenCopies = (page: Page) =>
  page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'previews') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });

test('a storage failure of the screen copies stops the open, and the album keeps its folder handle', async ({ page, browserName }, testInfo) => {
  desktopOnly(browserName);
  await stubFolderPicker(page, 'opfs');
  await albumOfThree(page);
  await page.evaluate(async (m) => {
    const { putDirHandle } = await import(m);
    const earlier = await (await navigator.storage.getDirectory()).getDirectoryHandle('earlier', { create: true });
    await putDirHandle(window.__store!.album.value.id, earlier);
  }, DB);
  const path = await saveArchive(page, testInfo);
  await page.evaluate(async (m) => {
    const { renameAlbum } = await import(m);
    window.__store!.dispatch((a) => renameAlbum(a, 'Змінений'));
  }, ALBUM);
  await expectStoredCurrent(page);
  const before = await albumJson(page);

  await failScreenCopies(page);
  page.once('dialog', (d) => void d.accept());
  await chooseFile(page, path);
  await page.getByTestId('archive-open-choose-folder').click();
  await expect(page.getByTestId('archive-open-error')).toContainText('копії фото');
  await expect(page.getByTestId('archive-open-done')).toHaveCount(0);

  const handleName = await page.evaluate(async (m) => {
    const { getDirHandle } = await import(m);
    return (await getDirHandle(window.__store!.album.value.id)).name;
  }, DB);
  expect(handleName).toBe('earlier');
  await page.getByTestId('archive-open-close').click();
  await expectAlbumKept(page, before);
  await expect(page.getByTestId('album-title')).toHaveText('Змінений');
  await expect(page.getByTestId('missing-bar')).toHaveCount(0);
});

test('a storage failure stops the open also with no folder, and no album opens with grey photos', async ({ page, browser }, testInfo) => {
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  await newAlbum(other, [LAND_2]);
  await expectStoredCurrent(other);
  const before = await albumJson(other);

  await failScreenCopies(other);
  await chooseFile(other, path);
  await expect(other.getByTestId('archive-open-error')).toContainText('копії фото');
  await other.getByTestId('archive-open-close').click();
  await expectAlbumKept(other, before);
  await expect(other.getByTestId('missing-bar')).toHaveCount(0);
});

test('a photo that the browser cannot decode is named, and the album opens', async ({ page, browser }, testInfo) => {
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);
  const crafted = await craftedArchive(path, testInfo, (entries, { album }) => {
    entries['photos/land-1.jpg'] = strToU8('these bytes are not an image');
    album.photos[0].size = entries['photos/land-1.jpg'].length;
  });

  const other = await otherDevice(browser, page, testInfo);
  await chooseFile(other, crafted, 'open-file');
  await expect(other.getByTestId('archive-open-undecodable')).toContainText('land-1.jpg');
  await expect(other.getByTestId('archive-open-undecodable')).not.toContainText('port-1.jpg');
  await closeDone(other);

  await expect(other.getByTestId('album-title')).toHaveText('Новий альбом');
  await expect(other.getByTestId('photo-port-1.jpg').locator('img')).toBeVisible();
  await expect(other.getByTestId('cell-1-1').locator('img')).toBeVisible();
  await expect(other.getByTestId('photo-land-1.jpg')).toHaveAttribute('data-missing', 'true');
});

test('a photo that decodes but has a refused name is named, and the album opens', async ({ page, browser }, testInfo) => {
  await albumOfThree(page);
  const path = await saveArchive(page, testInfo);
  const crafted = await craftedArchive(path, testInfo, (entries, { album }) => {
    entries['photos/pic.gif'] = entries['photos/land-1.jpg'];
    delete entries['photos/land-1.jpg'];
    album.photos.find((p) => p.name === 'land-1.jpg')!.name = 'pic.gif';
  });

  const other = await otherDevice(browser, page, testInfo);
  await chooseFile(other, crafted, 'open-file');
  await expect(other.getByTestId('archive-open-undecodable')).toContainText('pic.gif');
  await expect(other.getByTestId('archive-open-undecodable')).not.toContainText('port-1.jpg');
  await expect(other.getByTestId('archive-open-error')).toHaveCount(0);
  await expect(other.getByText('вільне місце')).toHaveCount(0);
  await closeDone(other);

  await expect(other.getByTestId('album-title')).toHaveText('Новий альбом');
  await expect(other.getByTestId('photo-port-1.jpg').locator('img')).toBeVisible();
  await expect(other.getByTestId('photo-pic.gif')).toHaveAttribute('data-missing', 'true');
});

test('an archive shows its photos after a layout file showed them as missing, with no reload', async ({ page, browser }, testInfo) => {
  await albumOfThree(page);
  const layout = await saveLayout(page, testInfo);
  const path = await saveArchive(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  await chooseFile(other, layout, 'open-file');
  await expect(other.getByTestId('missing-1-0')).toContainText('land-1.jpg');
  await expect(other.getByTestId('missing-bar')).toBeVisible();
  // The confirmation runs only for a stored album, so the autosaver must store the layout first.
  await expectStoredCurrent(other);

  const confirmation = other.waitForEvent('dialog');
  const opening = openArchive(other, path);
  await (await confirmation).accept();
  await opening;
  await expectNoMissingPhoto(other, ['land-1.jpg', 'port-1.jpg'], 2);

  // The new album holds these two photos, so they keep their screen copies after the replace.
  const ids = (await readAlbumFile(path)).album.photos.map((p) => p.id);
  expect(await storedCopies(other, ids)).toBe(4);
  await expectStoredCurrent(other);
  await other.reload();
  await expectNoMissingPhoto(other, ['land-1.jpg', 'port-1.jpg'], 2);
});

/** Holds the dialog at its folder step. WebKit has no folder picker, so its dialog runs to the done state. */
const folderStubOn = (browserName: string): FolderStub | undefined => (browserName === 'chromium' ? 'opfs' : undefined);

async function expectDialogWaits(page: Page, browserName: string) {
  await expect(page.getByTestId(browserName === 'chromium' ? 'archive-open-folder' : 'archive-open-done')).toBeVisible();
}

/** Ends the open and shows that the album holds the photos of the good archive. */
async function expectGoodArchiveOpens(page: Page, browserName: string) {
  await expect(page.getByTestId('archive-open-error')).toHaveCount(0);
  if (browserName === 'chromium') await page.getByTestId('archive-open-continue').click();
  await closeDone(page);
  await expectNoMissingPhoto(page, ['land-1.jpg', 'port-1.jpg'], 2);
  expect(await originalSha(page, 'land-1.jpg')).toBe(await fixtureSha(LAND_1));
}

for (const button of ['open-file', 'action-open-file']) {
  test(`the open button ${button} starts no second open while the open dialog shows, and the dialog has the focus`, async ({ page, browser, browserName }, testInfo) => {
    await albumOfThree(page);
    const good = await saveArchive(page, testInfo);
    const damaged = await damagedArchive(good, testInfo);

    const other = await otherDevice(browser, page, testInfo, folderStubOn(browserName));
    if (button === 'action-open-file') await newAlbum(other, [LAND_2]);
    await chooseFile(other, good, button);
    await expectDialogWaits(other, browserName);
    expect(await other.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('archive-open-dialog');

    let choosers = 0;
    other.on('filechooser', (chooser) => {
      choosers++;
      void chooser.setFiles(damaged);
    });
    await other.keyboard.press('Enter');
    // The Tab key can still reach a button behind the dialog. On WebKit the editor is behind it now.
    await other.locator('[data-testid="open-file"], [data-testid="action-open-file"]').first().focus();
    await other.keyboard.press('Enter');
    // The test waits for an event that must not come.
    await other.waitForTimeout(500);

    await expectGoodArchiveOpens(other, browserName);
    expect(choosers).toBe(0);
  });
}

for (const during of ['the read of the first file', 'the open dialog']) {
  test(`a file from a second file chooser is ignored during ${during}`, async ({ page, browser, browserName }, testInfo) => {
    await albumOfThree(page);
    const good = await saveArchive(page, testInfo);
    const damaged = await damagedArchive(good, testInfo);

    const other = await otherDevice(browser, page, testInfo, folderStubOn(browserName));
    const holdsRead = during === 'the read of the first file';
    await other.evaluate((hold) => {
      const w = window as unknown as { __readNames: string[]; __endRead: () => void };
      w.__readNames = [];
      const slice = Blob.prototype.slice;
      Blob.prototype.slice = function (this: Blob, ...args: Parameters<Blob['slice']>) {
        if (this instanceof File) w.__readNames.push(this.name);
        return slice.apply(this, args);
      };
      if (!hold) return;
      const ended = new Promise<void>((resolve) => (w.__endRead = resolve));
      const arrayBuffer = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = async function (this: Blob) {
        await ended;
        return arrayBuffer.call(this);
      };
    }, holdsRead);

    const choosers: FileChooser[] = [];
    other.on('filechooser', (chooser) => choosers.push(chooser));
    await other.getByTestId('open-file').click();
    await other.getByTestId('open-file').click();
    await expect.poll(() => choosers.length).toBeGreaterThanOrEqual(1);
    await choosers[0].setFiles(good);
    await expect.poll(() => choosers.length).toBe(2);
    if (!holdsRead) await expectDialogWaits(other, browserName);
    await choosers[1].setFiles(damaged);
    // The test waits for a read that must not start.
    await other.waitForTimeout(500);
    const readNames = () => other.evaluate(() => (window as unknown as { __readNames: string[] }).__readNames);
    expect(await readNames()).not.toContain('damaged.album.zip');

    if (holdsRead) {
      await other.evaluate(() => (window as unknown as { __endRead: () => void }).__endRead());
      await expectDialogWaits(other, browserName);
    }
    await expectGoodArchiveOpens(other, browserName);
    expect(await readNames()).not.toContain('damaged.album.zip');
  });
}

test('each end of a read releases the guard, so that the next file opens', async ({ page, browser }, testInfo) => {
  await albumOfThree(page);
  const good = await saveArchive(page, testInfo);
  const damaged = await damagedArchive(good, testInfo);
  const cutShort = testInfo.outputPath('cut.album.zip');
  const goodBytes = await readFile(good);
  await writeFile(cutShort, goodBytes.subarray(0, Math.floor(goodBytes.length / 2)));

  const other = await otherDevice(browser, page, testInfo);
  const messages: string[] = [];
  let acceptReplace = false;
  other.on('dialog', (d) => {
    messages.push(d.message());
    void (d.type() === 'confirm' && !acceptReplace ? d.dismiss() : d.accept());
  });

  // A read error of a file that is not an album.
  await chooseFile(other, NOTES, 'open-file');
  await expect.poll(() => messages.length).toBe(1);
  // A read error of an archive.
  await chooseFile(other, cutShort, 'open-file');
  await expect.poll(() => messages.length).toBe(2);
  // An error in the open dialog, and then a close of the dialog.
  await chooseFile(other, damaged, 'open-file');
  await expect(other.getByTestId('archive-open-error')).toContainText('Архів пошкоджено');
  await other.getByTestId('archive-open-close').click();
  // An open that ends, and then a close of the dialog.
  await openArchive(other, good, 'open-file');
  await expectNoMissingPhoto(other, ['land-1.jpg', 'port-1.jpg'], 2);
  await expectStoredCurrent(other);
  // A cancel of the replace confirmation.
  await chooseFile(other, good);
  await expect.poll(() => messages.length).toBe(3);
  expect(messages[2]).toContain('Замінити наявний альбом?');
  await expect(other.getByTestId('archive-open-dialog')).toHaveCount(0);

  acceptReplace = true;
  await openArchive(other, good);
  await expect.poll(() => messages.length).toBe(4);
  await expectNoMissingPhoto(other, ['land-1.jpg', 'port-1.jpg'], 2);
});

/** A file picker that stays open until the test ends it. A browser rejects a second call while a picker is open. */
async function holdFilePicker(page: Page) {
  await page.addInitScript(() => {
    const picker: HeldPicker = { calls: 0, reads: 0, end: null };
    const w = window as unknown as Record<string, unknown>;
    w.__picker = picker;
    w.showOpenFilePicker = () => {
      picker.calls++;
      if (picker.end) return Promise.reject(new DOMException('File picker already active.', 'NotAllowedError'));
      return new Promise((resolve, reject) => {
        picker.end = (file, error) => {
          picker.end = null;
          if (file) resolve([{ getFile: async () => file }]);
          else reject(new DOMException('The picker ended.', error));
        };
      });
    };
  });
  await page.reload();
}

const filePickerCalls = (page: Page) => page.evaluate(() => (window as unknown as { __picker: HeldPicker }).__picker.calls);
const fileReads = (page: Page) => page.evaluate(() => (window as unknown as { __picker: HeldPicker }).__picker.reads);

function endFilePickerWithError(page: Page, error: string) {
  return page.evaluate((name) => (window as unknown as { __picker: HeldPicker }).__picker.end!(null, name), error);
}

/** Ends the picker with this layout file, and counts each read of the text of the file. */
async function endFilePickerWithLayout(page: Page, path: string) {
  await page.evaluate((text) => {
    const picker = (window as unknown as { __picker: HeldPicker }).__picker;
    const file = new File([text], 'saved.album.json', { type: 'application/json' });
    const read = file.text.bind(file);
    file.text = () => {
      picker.reads++;
      return read();
    };
    picker.end!(file, '');
  }, await readFile(path, 'utf8'));
}

function alertsOf(page: Page): string[] {
  const messages: string[] = [];
  page.on('dialog', (d) => {
    messages.push(d.message());
    void d.accept();
  });
  return messages;
}

async function expectLayoutOpens(page: Page) {
  await expect(page.getByTestId('album-title')).toHaveText('Новий альбом');
  await expect(page.getByTestId('missing-1-0')).toContainText('land-1.jpg');
}

test('a double click on the open button starts one file picker, and the album opens one time', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await albumOfThree(page);
  const layout = await saveLayout(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  const messages = alertsOf(other);
  await holdFilePicker(other);
  await other.getByTestId('open-file').dblclick();
  expect(await filePickerCalls(other)).toBe(1);
  expect(messages).toEqual([]);

  await endFilePickerWithLayout(other, layout);
  await expectLayoutOpens(other);
  expect(await filePickerCalls(other)).toBe(1);
  expect(await fileReads(other)).toBe(1);
  expect(messages).toEqual([]);
});

test('a cancel after a double click shows no alert, and a next click opens the file picker again', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await albumOfThree(page);
  const layout = await saveLayout(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  const messages = alertsOf(other);
  await holdFilePicker(other);
  await other.getByTestId('open-file').dblclick();
  await endFilePickerWithError(other, 'AbortError');
  await expect(other.getByTestId('editor')).toHaveCount(0);
  expect(messages).toEqual([]);

  await other.getByTestId('open-file').click();
  expect(await filePickerCalls(other)).toBe(2);
  await endFilePickerWithLayout(other, layout);
  await expectLayoutOpens(other);
  expect(messages).toEqual([]);
});

test('a file picker failure after a double click shows one alert, and a next click opens the file picker again', async ({ page, browser, browserName }, testInfo) => {
  desktopOnly(browserName);
  await albumOfThree(page);
  const layout = await saveLayout(page, testInfo);

  const other = await otherDevice(browser, page, testInfo);
  const messages = alertsOf(other);
  await holdFilePicker(other);
  await other.getByTestId('open-file').dblclick();
  await endFilePickerWithError(other, 'SecurityError');
  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toContain('The picker ended.');
  // A second alert comes straight after the first alert, before this read of the page.
  expect(await filePickerCalls(other)).toBe(1);
  expect(messages.length).toBe(1);

  await other.getByTestId('open-file').click();
  expect(await filePickerCalls(other)).toBe(2);
  await endFilePickerWithError(other, 'SecurityError');
  await expect.poll(() => messages.length).toBe(2);

  await other.getByTestId('open-file').click();
  await endFilePickerWithLayout(other, layout);
  await expectLayoutOpens(other);
  expect(messages.length).toBe(2);
});

test('a refused folder picker in the print export asks for a new click, and the export finishes after it', async ({ page, browserName }) => {
  desktopOnly(browserName);
  await stubFolderPicker(page, 'security-once');
  await albumOfThree(page);

  await page.getByTestId('action-export').click();
  await expect(page.getByTestId('export-start')).toBeEnabled();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-continue')).toBeVisible();
  await expect(page.getByTestId('export-error')).toHaveCount(0);

  await page.getByTestId('export-continue').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
});

test('a save on a phone opens on a computer, and a save on a computer opens on a phone', async ({ baseURL, browserName }, testInfo) => {
  desktopOnly(browserName, 'This test starts both engines itself');
  test.setTimeout(240_000);
  const phoneEngine = await webkit.launch();
  const computerEngine = await chromium.launch();
  const phoneContext = () => phoneEngine.newContext({ ...devices['iPhone 13'], baseURL });
  const computerContext = () => computerEngine.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, baseURL });
  const device = async (context: BrowserContext) => {
    const p = await context.newPage();
    await withoutPickers(p);
    return p;
  };
  try {
    const phoneSave = await device(await phoneContext());
    await albumOfThree(phoneSave);
    const fromPhone = await saveArchive(phoneSave, testInfo, 'from-phone.album.zip');

    const computerOpen = await device(await computerContext());
    await computerOpen.goto('/');
    await openArchive(computerOpen, fromPhone, 'open-file');
    await expectNoMissingPhoto(computerOpen, ['land-1.jpg', 'port-1.jpg'], 2);
    await exportToEnd(computerOpen);

    const computerSave = await device(await computerContext());
    await albumOfThree(computerSave);
    const fromComputer = await saveArchive(computerSave, testInfo, 'from-computer.album.zip');

    const phoneOpen = await device(await phoneContext());
    await phoneOpen.goto('/');
    await chooseFile(phoneOpen, fromComputer, 'open-file');
    await expect(phoneOpen.getByTestId('archive-open-done')).toBeVisible();
    await expect(phoneOpen.getByTestId('archive-open-folder')).toHaveCount(0);
    await closeDone(phoneOpen);
    await expectNoMissingPhoto(phoneOpen, ['land-1.jpg', 'port-1.jpg'], 2);
  } finally {
    await Promise.all([phoneEngine.close(), computerEngine.close()]);
  }
});
