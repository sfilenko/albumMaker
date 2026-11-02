// The parts that the archive specs share. This file is not a spec, so it does not run as a test.
import { expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
export const LAND_1 = join(FIXTURES, 'land-1.jpg');
export const LAND_2 = join(FIXTURES, 'land-2.jpg');
export const PORT_1 = join(FIXTURES, 'port-1.jpg');
export const DUP_A = join(FIXTURES, 'dup-a', 'IMG_0001.jpg');
export const DUP_B = join(FIXTURES, 'dup-b', 'IMG_0001.jpg');
export const ALBUM = '/src/model/album.ts';
export const ORIGINALS = '/src/photos/originals.ts';
export const DB = '/src/storage/db.ts';

export interface FilePayload { name: string; mimeType: string; buffer: Buffer }

export async function newAlbum(page: Page, files: string[] | FilePayload[]) {
  await page.goto('/');
  await page.getByTestId('create-album').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('add-photos').click();
  await (await chooser).setFiles(files);
  await expect(page.getByTestId('photo-counter')).toHaveText(`використано 0 / ${files.length}`);
}

/** Puts the photos at `indexes` of the photo column into the cells of the first spread. */
export async function usePhotos(page: Page, indexes: number[]) {
  await page.evaluate(
    async ([path, which]) => {
      const m = await import(path);
      window.__store!.dispatch((a) => {
        let next = m.applyTemplate(a, a.spreads[1].id, 'two');
        which.forEach((p, cellIndex) => {
          next = m.placePhoto(next, { spreadId: a.spreads[1].id, cellIndex }, a.photos[p].id);
        });
        return next;
      });
    },
    [ALBUM, indexes] as const,
  );
  await expect(page.getByTestId('photo-counter')).toHaveText(`використано ${indexes.length} / ${await page.evaluate(() => window.__store!.album.value.photos.length)}`);
}

export const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const fixtureSha = async (path: string) => sha(await readFile(path));

/** Records each text of the element, so a test sees the values of a fast counter. */
export async function recordTexts(page: Page, testId: string) {
  await page.evaluate((id) => {
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    const read = () => {
      const text = document.querySelector(`[data-testid="${id}"]`)?.textContent;
      if (text && seen.at(-1) !== text) seen.push(text);
    };
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, testId);
}

export const recorded = (page: Page) => page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);

export const albumJson = (page: Page) => page.evaluate(() => JSON.stringify(window.__store!.album.value));
