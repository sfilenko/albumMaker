import { expect, test, type Locator, type Page } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { readFile } from 'node:fs/promises';
import {
  albumJson,
  DB,
  DUP_A,
  DUP_B,
  fixtureSha,
  LAND_1,
  LAND_2,
  newAlbum,
  ORIGINALS,
  PORT_1,
  recorded,
  recordTexts,
  sha,
  usePhotos,
  type FilePayload,
} from './archive-helpers';

type PickerMode = 'writes' | 'held' | 'opfs' | 'cancels' | 'picker-fails' | 'createWritable-fails' | 'write-fails' | 'abort-fails';
interface PickerLog { calls: number; chunks: Blob[]; closed: boolean; aborted: boolean; release?: () => void }
const pickerCalls = () => (window as unknown as { __picker: PickerLog }).__picker.calls;

// The dialog takes the link route with no save picker, as in Safari and Firefox.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w.showSaveFilePicker;
    delete w.showDirectoryPicker;
  });
});

/** A save picker that records its calls. No browser in these tests shows a real one. */
async function stubSavePicker(page: Page, mode: PickerMode) {
  await page.addInitScript((m) => {
    const log: PickerLog = { calls: 0, chunks: [], closed: false, aborted: false };
    const w = window as unknown as Record<string, unknown>;
    w.__picker = log;
    w.showSaveFilePicker = async () => {
      log.calls++;
      if (m === 'cancels') throw new DOMException('The user aborted a request.', 'AbortError');
      if (m === 'picker-fails') throw new DOMException('The picker is not allowed', 'NotAllowedError');
      if (m === 'held') await new Promise<void>((resolve) => (log.release = resolve));
      if (m === 'opfs') return (await navigator.storage.getDirectory()).getFileHandle('saved.zip', { create: true });
      return {
        async createWritable() {
          if (m === 'createWritable-fails') throw new DOMException('No free space', 'QuotaExceededError');
          return {
            async write(d: Blob) {
              if (m === 'write-fails' || m === 'abort-fails') throw new DOMException('No free space', 'QuotaExceededError');
              log.chunks.push(d);
            },
            async close() {
              log.closed = true;
            },
            async abort() {
              log.aborted = true;
              if (m === 'abort-fails') throw new DOMException('The stream is closed', 'InvalidStateError');
            },
          };
        },
      };
    };
  }, mode);
}

/** 3 photos in the column: land-1.jpg and port-1.jpg in cells, land-2.jpg unused. */
async function albumOfThree(page: Page) {
  await newAlbum(page, [LAND_1, LAND_2, PORT_1]);
  await usePhotos(page, [0, 2]);
}

async function openDialog(page: Page) {
  await page.getByTestId('action-save-archive').click();
  await expect(page.getByTestId('archive-dialog')).toBeVisible();
}

async function startBuild(page: Page) {
  await openDialog(page);
  await page.getByTestId('archive-start').click();
}

async function choose(page: Page, files: string[] | FilePayload[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('archive-choose-originals').click();
  await (await chooser).setFiles(files);
}

/** land-1.jpg with the same pixels: comment segments of about 64 KiB with a pattern after its first segment. */
async function jpegWithComments(count: number): Promise<Buffer> {
  const jpeg = await readFile(LAND_1);
  const firstSegmentEnd = 4 + jpeg.readUInt16BE(4);
  const comments = Array.from({ length: count }, (_, n) => {
    const segment = Buffer.alloc(2 + 0xffff);
    segment.writeUInt16BE(0xfffe, 0);
    segment.writeUInt16BE(0xffff, 2);
    for (let i = 4; i < segment.length; i++) segment[i] = (i * 31 + n) & 0xff;
    return segment;
  });
  return Buffer.concat([jpeg.subarray(0, firstSegmentEnd), ...comments, jpeg.subarray(firstSegmentEnd)]);
}

/** About 2.5 MiB. */
const largeJpeg = () => jpegWithComments(40);

/** A file named as the fixture, with the same pixel size and another byte size. */
const closeCopy = async (): Promise<FilePayload> => ({ name: 'land-1.jpg', mimeType: 'image/jpeg', buffer: await jpegWithComments(1) });

async function downloadedZip(page: Page): Promise<Record<string, Uint8Array>> {
  await expect(page.getByTestId('archive-link')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('archive-save').click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/\.album\.zip$/);
  return unzipSync(new Uint8Array(await readFile((await d.path())!)));
}

async function expectLand1AndPort1(zip: Record<string, Uint8Array>) {
  expect(Object.keys(zip).sort()).toEqual(['album.json', 'photos/land-1.jpg', 'photos/port-1.jpg']);
  expect(sha(zip['photos/land-1.jpg'])).toBe(await fixtureSha(LAND_1));
  expect(sha(zip['photos/port-1.jpg'])).toBe(await fixtureSha(PORT_1));
}

/** The album with no save time, so that two forms of one album compare equal. */
const withoutSaveTime = (json: string) => JSON.stringify({ ...JSON.parse(json), lastFileSaveAt: null });

const lastFileSaveAt = (page: Page) => page.evaluate(() => window.__store!.album.value.lastFileSaveAt);

const KNOWN_SAVE_TIME = 1_000;

/** The album of 3 photos, with a save time that no save in a test can give. */
async function albumWithKnownSaveTime(page: Page) {
  await albumOfThree(page);
  await page.evaluate((at) => window.__store!.replace({ ...window.__store!.album.value, lastFileSaveAt: at }), KNOWN_SAVE_TIME);
  expect(await lastFileSaveAt(page)).toBe(KNOWN_SAVE_TIME);
}

async function expectColumnKept(page: Page) {
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 2 / 3');
  await expect(page.getByTestId('photo-land-2.jpg')).toBeVisible();
}

/** land-1.jpg in one cell, after a reload, with the dialog at its request for the photo. */
async function requestForLand1(page: Page) {
  await newAlbum(page, [LAND_1]);
  await usePhotos(page, [0]);
  await page.reload();
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 1 / 1');
  await startBuild(page);
  await expect(page.getByTestId('archive-need-originals')).toContainText('(1)');
}

/** The album of 3 photos after a reload, with the dialog at its request for 2 photos. */
async function requestForLand1AndPort1(page: Page) {
  await albumOfThree(page);
  await page.reload();
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 2 / 3');
  await startBuild(page);
  await expect(page.getByTestId('archive-need-originals')).toContainText('(2)');
}

test('the download holds the layout and the used photos with their exact bytes, and no unused photo', async ({ page }) => {
  await albumOfThree(page);
  await openDialog(page);
  await expect(page.getByTestId('archive-count')).toContainText('2');
  await recordTexts(page, 'archive-progress');
  await page.getByTestId('archive-start').click();

  const zip = await downloadedZip(page);
  await expectLand1AndPort1(zip);
  expect(new Set(await recorded(page)).size).toBeGreaterThanOrEqual(2);

  const { album } = JSON.parse(strFromU8(zip['album.json']));
  expect(album.photos.map((p: { name: string }) => p.name)).toEqual(['land-1.jpg', 'port-1.jpg']);
  expect(album.lastFileSaveAt).toEqual(expect.any(Number));

  // The link route says only what the page knows: the browser received the file.
  await expect(page.getByTestId('archive-done')).toHaveText('Браузер отримав файл. Перевірте завантаження в браузері.');
});

test('the saving device keeps its album, its counter and its photo column', async ({ page }) => {
  await albumOfThree(page);
  const loadStored = () =>
    page.evaluate(async (path) => {
      const { loadAlbum } = await import(path);
      return JSON.stringify(await loadAlbum(window.__store!.album.value.id));
    }, DB);
  const before = await albumJson(page);
  await expect.poll(loadStored).toBe(before);

  await startBuild(page);
  await downloadedZip(page);
  await expect(page.getByTestId('archive-done')).toBeVisible();
  await page.getByTestId('archive-close').click();

  await expectColumnKept(page);
  const after = await albumJson(page);
  expect(withoutSaveTime(after)).toBe(withoutSaveTime(before));
  await expect.poll(loadStored).toBe(after);
});

test('after a reload the save asks for the originals of the used photos only, and a new click goes on', async ({ page }) => {
  await albumOfThree(page);
  await page.reload();
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 2 / 3');

  await startBuild(page);
  await expect(page.getByTestId('archive-need-originals')).toContainText('(2)');

  await choose(page, [LAND_1, PORT_1]);
  await page.getByTestId('archive-continue').click();
  await expectLand1AndPort1(await downloadedZip(page));
});

test('with one file not chosen no download starts, and the name of that photo shows', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => downloads++);
  await albumOfThree(page);
  await page.reload();
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 2 / 3');

  await startBuild(page);
  await choose(page, [LAND_1]);
  const request = page.getByTestId('archive-need-originals');
  await expect(request).toContainText('port-1.jpg');
  await expect(request).toContainText('(1)');
  await expect(request).not.toContainText('land-1.jpg');
  await expect(page.getByTestId('archive-continue')).toHaveCount(0);
  await expect(page.getByTestId('archive-save')).toHaveCount(0);
  expect(downloads).toBe(0);
});

test('two rounds of the file chooser find two photos with one name', async ({ page }) => {
  await newAlbum(page, [DUP_A, DUP_B]);
  await usePhotos(page, [0, 1]);
  await page.reload();
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 2 / 2');

  await startBuild(page);
  await expect(page.getByTestId('archive-need-originals')).toContainText('(2)');
  await choose(page, [DUP_A]);
  await expect(page.getByTestId('archive-need-originals')).toContainText('(1)');
  await choose(page, [DUP_B]);
  await page.getByTestId('archive-continue').click();

  const zip = await downloadedZip(page);
  expect(Object.keys(zip).sort()).toEqual(['album.json', 'photos/IMG_0001-2.jpg', 'photos/IMG_0001.jpg']);
  const shas = [sha(zip['photos/IMG_0001.jpg']), sha(zip['photos/IMG_0001-2.jpg'])].sort();
  expect(shas).toEqual([await fixtureSha(DUP_A), await fixtureSha(DUP_B)].sort());

  // Each name in the layout goes with the size of its own file.
  const { album } = JSON.parse(strFromU8(zip['album.json']));
  for (const p of album.photos as { name: string; size: number }[]) {
    expect(zip[`photos/${p.name}`].length).toBe(p.size);
  }
});

test('two photos with one name and one size take one chosen file', async ({ page }) => {
  await newAlbum(page, [DUP_A, DUP_A]);
  await usePhotos(page, [0, 1]);
  await page.reload();
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 2 / 2');

  await startBuild(page);
  await choose(page, [DUP_A]);
  await page.getByTestId('archive-continue').click();

  const zip = await downloadedZip(page);
  expect(Object.keys(zip).sort()).toEqual(['album.json', 'photos/IMG_0001-2.jpg', 'photos/IMG_0001.jpg']);
  expect(sha(zip['photos/IMG_0001-2.jpg'])).toBe(await fixtureSha(DUP_A));
});

for (const dialog of ['archive', 'export'] as const) {
  test(`in the ${dialog} dialog, two files that fit one photo ask for one file and do not say "not found"`, async ({ page }) => {
    const bytes = await readFile(LAND_1);
    const named = (name: string): FilePayload => ({ name, mimeType: 'image/jpeg', buffer: bytes });
    await newAlbum(page, [named('IMG_1.jpg')]);
    await usePhotos(page, [0]);
    await page.reload();
    await expect(page.getByTestId('photo-counter')).toHaveText('використано 1 / 1');

    await page.getByTestId(dialog === 'archive' ? 'action-save-archive' : 'action-export').click();
    await page.getByTestId(`${dialog}-start`).click();
    const request = page.getByTestId(`${dialog}-need-originals`);
    await expect(request).toBeVisible();

    const round = async (files: FilePayload[]) => {
      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId(`${dialog}-choose-originals`).click();
      await (await chooser).setFiles(files);
    };
    await round([named('IMG_1.jpeg'), named('IMG_1.png')]);
    await expect(request).toContainText('Неоднозначний збіг: IMG_1.jpg. Оберіть по одному файлу для кожного з цих фото.');
    await expect(request).not.toContainText('Не знайдено');
    await expect(page.getByTestId(`${dialog}-continue`)).toHaveCount(0);

    // A round with one file ends the request. This file has another name, so the archive asks first.
    await round([named('IMG_1.jpeg')]);
    if (dialog === 'archive') {
      await expect(page.getByTestId('archive-inexact')).toContainText('IMG_1.jpg');
      await page.getByTestId('archive-inexact-accept').click();
    }
    await expect(page.getByTestId(`${dialog}-continue`)).toBeVisible();
  });
}

for (const dialog of ['archive', 'export'] as const) {
  test(`in the ${dialog} dialog, the second file of one name is a request for one more file, not a "not found"`, async ({ page }) => {
    await newAlbum(page, [DUP_A, DUP_B]);
    await usePhotos(page, [0, 1]);
    await page.reload();
    await expect(page.getByTestId('photo-counter')).toHaveText('використано 2 / 2');

    await page.getByTestId(dialog === 'archive' ? 'action-save-archive' : 'action-export').click();
    await page.getByTestId(`${dialog}-start`).click();
    const request = page.getByTestId(`${dialog}-need-originals`);
    await expect(request).toContainText('(2)');

    const round = async (file: string) => {
      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId(`${dialog}-choose-originals`).click();
      await (await chooser).setFiles(file);
    };
    await round(DUP_A);
    await expect(request).toContainText('(1)');
    await expect(request).toContainText('Оберіть ще один файл із цією назвою.');
    await expect(request).toContainText('IMG_0001.jpg');
    await expect(request).not.toContainText('Не знайдено');

    // No other photo of this name gets a file in this round, so this file really is no match.
    await round(PORT_1);
    await expect(request).toContainText('Не знайдено: IMG_0001.jpg');
    await expect(request).not.toContainText('Оберіть ще один файл із цією назвою.');
  });
}

test('the match of chosen files shows a live count, and the close button stays disabled', async ({ page }) => {
  await albumOfThree(page);
  await page.reload();
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 2 / 3');
  // Each decode of a chosen file waits for the test, so the test reads each count.
  await page.evaluate(() => {
    const w = window as unknown as { __releaseDecode: () => boolean };
    const decode = window.createImageBitmap.bind(window) as (...a: unknown[]) => Promise<ImageBitmap>;
    const waiting: (() => void)[] = [];
    w.__releaseDecode = () => {
      const next = waiting.shift();
      next?.();
      return next !== undefined;
    };
    (window as unknown as { createImageBitmap: unknown }).createImageBitmap = async (...args: unknown[]) => {
      await new Promise<void>((resolve) => waiting.push(resolve));
      return decode(...args);
    };
  });
  const releaseDecode = () => page.evaluate(() => (window as unknown as { __releaseDecode: () => boolean }).__releaseDecode());

  await startBuild(page);
  await choose(page, [LAND_1, PORT_1]);

  const matching = page.getByTestId('archive-matching');
  await expect(matching).toHaveText('Пошук оригіналів: 0 / 2');
  await expect(page.getByTestId('archive-close')).toBeDisabled();
  await expect(page.getByTestId('archive-progress')).toHaveCount(0);

  await expect.poll(releaseDecode).toBe(true);
  await expect(matching).toHaveText('Пошук оригіналів: 1 / 2');
  await expect(page.getByTestId('archive-close')).toBeDisabled();

  await expect.poll(releaseDecode).toBe(true);
  await expect(page.getByTestId('archive-continue')).toBeVisible();
  await expect(page.getByTestId('archive-close')).toBeEnabled();
});

test('a chosen file of another size needs a click, and the accept button keeps it', async ({ page }) => {
  const copy = await closeCopy();
  await requestForLand1(page);
  await choose(page, [copy]);

  await expect(page.getByTestId('archive-inexact')).toContainText('land-1.jpg');
  await expect(page.getByTestId('archive-continue')).toHaveCount(0);
  await expect(page.getByTestId('archive-save')).toHaveCount(0);

  await page.getByTestId('archive-inexact-accept').click();
  await expect(page.getByTestId('archive-inexact')).toHaveCount(0);
  await page.getByTestId('archive-continue').click();

  const zip = await downloadedZip(page);
  expect(sha(zip['photos/land-1.jpg'])).toBe(sha(copy.buffer));
});

test('the other button of a close match removes the file and asks for the photo again', async ({ page }) => {
  await requestForLand1(page);
  await choose(page, [await closeCopy()]);
  await page.getByTestId('archive-inexact-choose').click();
  await expect(page.getByTestId('archive-need-originals')).toContainText('(1)');
  await expect(page.getByTestId('archive-continue')).toHaveCount(0);

  await choose(page, [LAND_1]);
  await expect(page.getByTestId('archive-continue')).toBeVisible();
  await expect(page.getByTestId('archive-inexact')).toHaveCount(0);
  await page.getByTestId('archive-continue').click();

  const zip = await downloadedZip(page);
  expect(sha(zip['photos/land-1.jpg'])).toBe(await fixtureSha(LAND_1));
});

test('after a close match, the accept button asks only for the photo that is still missing', async ({ page }) => {
  await requestForLand1AndPort1(page);
  await choose(page, [await closeCopy()]);
  await expect(page.getByTestId('archive-inexact')).toContainText('land-1.jpg');
  await expect(page.getByTestId('archive-inexact')).not.toContainText('port-1.jpg');

  await page.getByTestId('archive-inexact-accept').click();
  const request = page.getByTestId('archive-need-originals');
  await expect(request).toContainText('(1)');
  await expect(request).toContainText('Не знайдено: port-1.jpg');
});

test('after a close match, the other button asks for that photo and for the photo that is still missing', async ({ page }) => {
  await requestForLand1AndPort1(page);
  await choose(page, [await closeCopy()]);
  await page.getByTestId('archive-inexact-choose').click();
  await expect(page.getByTestId('archive-need-originals')).toContainText('(2)');

  await choose(page, [LAND_1, PORT_1]);
  await expect(page.getByTestId('archive-inexact')).toHaveCount(0);
  await page.getByTestId('archive-continue').click();
  await expectLand1AndPort1(await downloadedZip(page));
});

test('a close at a close match keeps the file in memory, and the next save asks again', async ({ page }) => {
  const copy = await closeCopy();
  await requestForLand1(page);
  await choose(page, [copy]);
  await expect(page.getByTestId('archive-inexact')).toBeVisible();

  await page.getByTestId('archive-close').click();
  const inMemory = await page.evaluate(async (path) => {
    const { readOriginals } = await import(path);
    const album = window.__store!.album.value;
    const files: Map<string, File> = await readOriginals(album.id, album.photos);
    return files.get(album.photos[0].id)!.size;
  }, ORIGINALS);
  expect(inMemory).toBe(copy.buffer.length);

  await startBuild(page);
  await expect(page.getByTestId('archive-inexact')).toContainText('land-1.jpg');
  await expect(page.getByTestId('archive-need-originals')).toHaveCount(0);
  await expect(page.getByTestId('archive-link')).toHaveCount(0);
});

test('the archive asks about a close file that the print export took earlier, and it asks one time', async ({ page }) => {
  const copy = await closeCopy();
  await newAlbum(page, [LAND_1]);
  await usePhotos(page, [0]);
  await page.reload();
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 1 / 1');

  await page.getByTestId('action-export').click();
  await page.getByTestId('export-start').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('export-choose-originals').click();
  await (await chooser).setFiles(copy);
  await expect(page.getByTestId('export-continue')).toBeVisible();
  await page.getByTestId('export-close').click();

  await startBuild(page);
  await expect(page.getByTestId('archive-inexact')).toContainText('land-1.jpg');
  await expect(page.getByTestId('archive-save')).toHaveCount(0);

  await page.getByTestId('archive-inexact-accept').click();
  await page.getByTestId('archive-continue').click();
  const zip = await downloadedZip(page);
  expect(sha(zip['photos/land-1.jpg'])).toBe(sha(copy.buffer));
});

test('at the start of a save, the other button forgets a close file from memory and asks for the photo', async ({ page }) => {
  await newAlbum(page, [LAND_1]);
  await usePhotos(page, [0]);
  const copy = await closeCopy();
  await page.evaluate(
    async ([path, base64]) => {
      const { registerOriginals } = await import(path);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'land-1.jpg', { type: 'image/jpeg' });
      registerOriginals(new Map([[window.__store!.album.value.photos[0].id, file]]));
    },
    [ORIGINALS, copy.buffer.toString('base64')] as const,
  );

  await startBuild(page);
  await page.getByTestId('archive-inexact-choose').click();
  await expect(page.getByTestId('archive-need-originals')).toContainText('(1)');

  await choose(page, [LAND_1]);
  await page.getByTestId('archive-continue').click();
  const zip = await downloadedZip(page);
  expect(sha(zip['photos/land-1.jpg'])).toBe(await fixtureSha(LAND_1));
});

test('the Tab key does not reach a control behind the save dialog, and the undo button works after a close', async ({ page }) => {
  // A cancel of the picker changes nothing, so the Enter key is safe also on the save button.
  await stubSavePicker(page, 'cancels');
  await albumOfThree(page);
  const before = await albumJson(page);
  await expect(page.getByTestId('undo')).toBeEnabled();

  await openDialog(page);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('archive-dialog');
  await expect(page.getByTestId('editor').getByTestId('archive-dialog')).toHaveCount(0);

  await page.getByTestId('archive-start').click();
  await expect(page.getByTestId('archive-link')).toBeVisible();

  const outside: string[] = [];
  for (let press = 0; press < 30; press++) {
    await page.keyboard.press('Tab');
    const found = await page.evaluate(() => {
      const el = document.activeElement;
      const inDialog = el === document.body || el === null || el.closest('[data-testid="archive-dialog"]') !== null;
      return inDialog ? null : (el.getAttribute('data-testid') ?? el.outerHTML.slice(0, 80));
    });
    if (found !== null) outside.push(found);
  }
  expect(outside).toEqual([]);
  // The Tab key of a browser can skip buttons, so the test reads the state of the editor too.
  await expect(page.getByTestId('editor')).toHaveAttribute('inert');

  await page.keyboard.press('Enter');
  expect(await albumJson(page)).toBe(before);

  // The Enter key can have closed the dialog, when the focus was on its close button.
  const close = page.getByTestId('archive-close');
  if (await close.isVisible()) await close.click();
  await expect(page.getByTestId('archive-dialog')).toHaveCount(0);
  await expect(page.getByTestId('editor')).not.toHaveAttribute('inert');

  await page.getByTestId('undo').click();
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 0 / 3');
});

test('the undo and redo keys do not change the album while the save dialog is open, and undo works after a close', async ({ page }) => {
  await albumOfThree(page);
  const before = await albumJson(page);
  await startBuild(page);
  await expect(page.getByTestId('archive-link')).toBeVisible();

  // This listener comes after the listener of the editor, so it reads the result of that listener.
  await page.evaluate(() => {
    const w = window as unknown as { __prevented: string[] };
    w.__prevented = [];
    window.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) w.__prevented.push(e.key);
    });
  });
  for (const key of ['Control+z', 'Control+y', 'Control+Shift+z']) {
    await page.keyboard.press(key);
    expect(await albumJson(page)).toBe(before);
  }
  expect(await page.evaluate(() => (window as unknown as { __prevented: string[] }).__prevented)).toEqual([]);
  await expect(page.getByTestId('archive-dialog')).toHaveAttribute('data-state', 'link');

  await page.getByTestId('archive-close').click();
  await expect(page.getByTestId('archive-dialog')).toHaveCount(0);
  // The editor changes its key listener after the paint, so the first key can come too early.
  await expect(async () => {
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('photo-counter')).toHaveText('використано 0 / 3', { timeout: 500 });
  }).toPass();
});

test('the print export takes a close file with no question', async ({ page }) => {
  await newAlbum(page, [LAND_1]);
  await usePhotos(page, [0]);
  await page.reload();
  await expect(page.getByTestId('photo-counter')).toHaveText('використано 1 / 1');

  await page.getByTestId('action-export').click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-need-originals')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('export-choose-originals').click();
  await (await chooser).setFiles(await closeCopy());

  await expect(page.getByTestId('export-continue')).toBeVisible();
  await expect(page.getByTestId('archive-inexact')).toHaveCount(0);
  await expect(page.getByTestId('export-dialog')).not.toContainText('Використати ці файли');
});

for (const dialog of ['archive', 'export'] as const) {
  test(`in the ${dialog} dialog, a stored folder that no longer exists gives the request for originals`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'WebKit has no folder picker, so no album on it stores a folder');
    await albumOfThree(page);
    const failure = await page.evaluate(async (path) => {
      const { putDirHandle } = await import(path);
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('removed-folder', { create: true });
      await putDirHandle(window.__store!.album.value.id, dir);
      await root.removeEntry('removed-folder', { recursive: true });
      try {
        await (dir as unknown as { values(): AsyncIterator<unknown> }).values().next();
        return null;
      } catch (e) {
        return (e as DOMException).name;
      }
    }, DB);
    // The read of the folder really rejects, so this test drives the failure.
    expect(failure).toBe('NotFoundError');
    await page.reload();
    await expect(page.getByTestId('photo-counter')).toHaveText('використано 2 / 3');

    await page.getByTestId(dialog === 'archive' ? 'action-save-archive' : 'action-export').click();
    await page.getByTestId(`${dialog}-start`).click();
    await expect(page.getByTestId(`${dialog}-need-originals`)).toContainText('(2)');
    await expect(page.getByTestId(`${dialog}-error`)).toHaveCount(0);
  });
}

test('an album with no used photo saves only the layout', async ({ page }) => {
  await newAlbum(page, [LAND_1]);
  await startBuild(page);
  expect(Object.keys(await downloadedZip(page))).toEqual(['album.json']);
});

test('the second click calls the save picker, and the counter advances during the write', async ({ page }) => {
  await stubSavePicker(page, 'writes');
  await albumOfThree(page);
  await startBuild(page);
  await expect(page.getByTestId('archive-link')).toBeVisible();
  expect(await page.evaluate(pickerCalls)).toBe(0);

  await recordTexts(page, 'archive-write-progress');
  await page.getByTestId('archive-save').click();
  await expect(page.getByTestId('archive-done')).toHaveText('Архів збережено.');
  expect(await recorded(page)).toEqual(['Запис архіву: 0%', 'Запис архіву: 100%']);

  const log = await page.evaluate(async () => {
    const { calls, chunks, closed, aborted } = (window as unknown as { __picker: PickerLog }).__picker;
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    return { calls, closed, aborted, base64: btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')) };
  });
  expect(log).toMatchObject({ calls: 1, closed: true, aborted: false });
  await expectLand1AndPort1(unzipSync(new Uint8Array(Buffer.from(log.base64, 'base64'))));
});

test('an archive over 2 MiB goes through the save picker in slices, with the exact bytes of the photo', async ({ page }) => {
  const photo = await largeJpeg();
  await stubSavePicker(page, 'writes');
  await newAlbum(page, [{ name: 'large.jpg', mimeType: 'image/jpeg', buffer: photo }]);
  await usePhotos(page, [0]);
  await startBuild(page);
  await expect(page.getByTestId('archive-link')).toBeVisible();

  await recordTexts(page, 'archive-write-progress');
  await page.getByTestId('archive-save').click();
  await expect(page.getByTestId('archive-done')).toHaveText('Архів збережено.');

  const written = await page.evaluate(async () => {
    const { chunks } = (window as unknown as { __picker: PickerLog }).__picker;
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    return { sizes: chunks.map((c) => c.size), base64: btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')) };
  });
  const bytes = new Uint8Array(Buffer.from(written.base64, 'base64'));
  expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024);

  const MIB = 1024 * 1024;
  expect(written.sizes).toEqual([MIB, MIB, bytes.length - 2 * MIB]);
  const percent = (n: number) => `Запис архіву: ${Math.floor((n * 100) / bytes.length)}%`;
  expect(await recorded(page)).toEqual([percent(0), percent(MIB), percent(2 * MIB), percent(bytes.length)]);

  const zip = unzipSync(bytes);
  expect(Object.keys(zip).sort()).toEqual(['album.json', 'photos/large.jpg']);
  expect(sha(zip['photos/large.jpg'])).toBe(sha(photo));
});

test('the save picker writes a real file of the browser storage', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebKit in this test has no writable stream on such a file');
  await stubSavePicker(page, 'opfs');
  await albumOfThree(page);
  await startBuild(page);
  await page.getByTestId('archive-save').click();
  await expect(page.getByTestId('archive-done')).toHaveText('Архів збережено.');

  const base64 = await page.evaluate(async () => {
    const file = await (await (await navigator.storage.getDirectory()).getFileHandle('saved.zip')).getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
  });
  await expectLand1AndPort1(unzipSync(new Uint8Array(Buffer.from(base64, 'base64'))));
});

test('a cancel of the picker returns to the link state with no second build', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => downloads++);
  await stubSavePicker(page, 'cancels');
  await albumOfThree(page);
  await startBuild(page);
  await expect(page.getByTestId('archive-link')).toBeVisible();

  await recordTexts(page, 'archive-progress');
  await page.getByTestId('archive-save').click();
  await expect.poll(() => page.evaluate(pickerCalls)).toBe(1);
  await expect(page.getByTestId('archive-dialog')).toHaveAttribute('data-state', 'link');

  await page.getByTestId('archive-save').click();
  await expect.poll(() => page.evaluate(pickerCalls)).toBe(2);
  await expect(page.getByTestId('archive-link')).toBeVisible();

  expect(await recorded(page)).toEqual([]);
  await expect(page.getByTestId('archive-error')).toHaveCount(0);
  await expect(page.getByTestId('archive-done')).toHaveCount(0);
  expect(downloads).toBe(0);
});

test('a failed write shows an error, calls abort, and shows no done message', async ({ page }) => {
  await stubSavePicker(page, 'write-fails');
  await albumOfThree(page);
  const before = await albumJson(page);
  await startBuild(page);
  await page.getByTestId('archive-save').click();

  await expect(page.getByTestId('archive-error')).toContainText('No free space');
  await expect(page.getByTestId('archive-done')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __picker: PickerLog }).__picker.aborted)).toBe(true);
  expect(await albumJson(page)).toBe(before);
});

test('a failed createWritable shows an error and no done message', async ({ page }) => {
  await stubSavePicker(page, 'createWritable-fails');
  await albumOfThree(page);
  const before = await albumJson(page);
  await startBuild(page);
  await page.getByTestId('archive-save').click();

  await expect(page.getByTestId('archive-error')).toContainText('No free space');
  await expect(page.getByTestId('archive-done')).toHaveCount(0);
  expect(await albumJson(page)).toBe(before);
});

const doubleClicks: Record<string, (save: Locator) => Promise<unknown>> = {
  'a double click': (save) => save.dblclick(),
  // Both clicks come before a render, so only the flag can stop the second click.
  'two clicks in one task': (save) =>
    save.evaluate((button: HTMLElement) => {
      button.click();
      button.click();
    }),
};

for (const [name, clickTwice] of Object.entries(doubleClicks)) {
  test(`with ${name} on the save button, the save picker runs one time and no error shows`, async ({ page }) => {
    await stubSavePicker(page, 'held');
    await albumOfThree(page);
    await startBuild(page);
    await expect(page.getByTestId('archive-link')).toBeVisible();

    await clickTwice(page.getByTestId('archive-save'));
    const dialog = page.getByTestId('archive-dialog');
    await expect(dialog).toHaveAttribute('data-state', 'picking');
    await expect(dialog).toContainText('Оберіть місце для архіву у вікні браузера.');
    await expect(page.getByTestId('archive-close')).toBeDisabled();
    await expect(page.getByTestId('archive-save')).toHaveCount(0);
    expect(await page.evaluate(pickerCalls)).toBe(1);

    await page.evaluate(() => (window as unknown as { __picker: PickerLog }).__picker.release!());
    await expect(page.getByTestId('archive-done')).toHaveText('Архів збережено.');
    expect(await page.evaluate(pickerCalls)).toBe(1);
    await expect(page.getByTestId('archive-error')).toHaveCount(0);
  });
}

test('a rejected abort does not replace the first failure of the write', async ({ page }) => {
  await stubSavePicker(page, 'abort-fails');
  await albumOfThree(page);
  await startBuild(page);
  await page.getByTestId('archive-save').click();

  const error = page.getByTestId('archive-error');
  await expect(error).toContainText('No free space');
  await expect(error).not.toContainText('The stream is closed');
  await expect(page.getByTestId('archive-done')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __picker: PickerLog }).__picker.aborted)).toBe(true);
});

test('a picker failure that is not a cancel shows an error and does not return to the link', async ({ page }) => {
  await stubSavePicker(page, 'picker-fails');
  await albumOfThree(page);
  await startBuild(page);
  await page.getByTestId('archive-save').click();

  await expect(page.getByTestId('archive-error')).toContainText('The picker is not allowed');
  await expect(page.getByTestId('archive-link')).toHaveCount(0);
  await expect(page.getByTestId('archive-done')).toHaveCount(0);
});

test('a download sets the file save time, and the counter and the photo column stay', async ({ page }) => {
  await albumWithKnownSaveTime(page);
  await startBuild(page);
  const before = Date.now();
  await downloadedZip(page);
  await expect(page.getByTestId('archive-done')).toBeVisible();

  expect(await lastFileSaveAt(page)).toBeGreaterThanOrEqual(before);
  expect(await lastFileSaveAt(page)).toBeLessThanOrEqual(Date.now());
  await page.getByTestId('archive-close').click();
  await expectColumnKept(page);
});

test('a write through the save picker sets the file save time, and the counter and the photo column stay', async ({ page }) => {
  await stubSavePicker(page, 'held');
  await albumWithKnownSaveTime(page);
  await startBuild(page);
  await page.getByTestId('archive-save').click();
  await expect(page.getByTestId('archive-dialog')).toHaveAttribute('data-state', 'picking');
  // While the picker is open, no file exists.
  expect(await lastFileSaveAt(page)).toBe(KNOWN_SAVE_TIME);

  const before = Date.now();
  await page.evaluate(() => (window as unknown as { __picker: PickerLog }).__picker.release!());
  await expect(page.getByTestId('archive-done')).toHaveText('Архів збережено.');
  expect(await lastFileSaveAt(page)).toBeGreaterThanOrEqual(before);
  expect(await lastFileSaveAt(page)).toBeLessThanOrEqual(Date.now());
  await page.getByTestId('archive-close').click();
  await expectColumnKept(page);
});

for (const mode of ['cancels', 'picker-fails', 'createWritable-fails', 'write-fails'] as const) {
  test(`the file save time does not change when the picker stub ${mode}`, async ({ page }) => {
    await stubSavePicker(page, mode);
    await albumWithKnownSaveTime(page);
    await startBuild(page);
    await page.getByTestId('archive-save').click();
    await expect.poll(() => page.evaluate(pickerCalls)).toBe(1);
    await expect(page.getByTestId('archive-dialog')).toHaveAttribute('data-state', mode === 'cancels' ? 'link' : 'error');

    expect(await lastFileSaveAt(page)).toBe(KNOWN_SAVE_TIME);
    await page.getByTestId('archive-close').click();
    await expectColumnKept(page);
  });
}

test('a file that stops being readable returns the dialog to the request for that photo', async ({ page }) => {
  let downloads = 0;
  page.on('download', () => downloads++);
  await albumOfThree(page);
  await page.evaluate(() => {
    const slice = Blob.prototype.slice;
    let armed = true;
    Blob.prototype.slice = function (this: Blob, ...args: Parameters<Blob['slice']>) {
      const part = slice.apply(this, args);
      if (armed && this instanceof File && this.name === 'port-1.jpg') {
        armed = false;
        part.arrayBuffer = () => Promise.reject(new DOMException('The file changed', 'NotReadableError'));
      }
      return part;
    };
  });

  await startBuild(page);
  const request = page.getByTestId('archive-need-originals');
  await expect(request).toContainText('port-1.jpg');
  await expect(request).toContainText('(1)');
  expect(downloads).toBe(0);

  await choose(page, [PORT_1]);
  await page.getByTestId('archive-continue').click();
  await expectLand1AndPort1(await downloadedZip(page));
});

test('an album over the ZIP limit shows its own message', async ({ page }) => {
  await newAlbum(page, [LAND_1]);
  await usePhotos(page, [0]);
  await page.evaluate(async (path) => {
    const { registerOriginals } = await import(path);
    const a = window.__store!.album.value;
    const huge = new File(['x'], 'land-1.jpg');
    Object.defineProperty(huge, 'size', { value: 5 * 1024 ** 3 });
    registerOriginals(new Map([[a.photos[0].id, huge]]));
  }, ORIGINALS);

  await startBuild(page);
  // This file has another size than the photo, so the dialog asks before the build.
  await page.getByTestId('archive-inexact-accept').click();
  await page.getByTestId('archive-continue').click();
  await expect(page.getByTestId('archive-error')).toContainText('завеликий');
  await expect(page.getByTestId('archive-done')).toHaveCount(0);
});
