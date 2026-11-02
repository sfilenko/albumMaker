// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, expect, test, vi } from 'vitest';
import { addPhotos, applyTemplate, createAlbum, placePhoto, setCrop, updateSettings } from '../../src/model/album';
import { printWarnings } from '../../src/model/pages';
import type { Album, PhotoMeta } from '../../src/model/types';
import {
  ArchiveError,
  archivableAlbum,
  archivablePhotos,
  archiveFileName,
  assertFitsArchive,
  buildArchive,
  crc32OfBlob,
  freeName,
  isPlainName,
  isZip,
  nameKey,
  readArchive,
  saveArchiveBlob,
  UnreadablePhotoError,
  writeInSlices,
} from '../../src/storage/archive';
import { downloadBlob, LayoutFileError, parseLayout, safeBaseName, saveLayoutFile, serializeLayout } from '../../src/storage/layoutFile';

const SAVED_AT = Date.UTC(2026, 10, 1, 12, 0, 0);
const GB = 1024 ** 3;
const MB = 1024 ** 2;

type Bytes = Uint8Array<ArrayBuffer>;

class UnreadableBlob extends Blob {
  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.reject(new DOMException('the file changed', 'NotReadableError'));
  }
}

class UnreadableFile extends File {
  slice(): Blob {
    return new UnreadableBlob();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pattern = (n: number, seed: number): Bytes => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed + (i >> 8)) & 0xff;
  return out;
};
const fixture = (name: string): Bytes => new Uint8Array(readFileSync(`tests/fixtures/${name}`));
const fileOf = (bytes: Bytes, name = 'x.jpg', lastModified = SAVED_AT) => new File([bytes], name, { lastModified });
const bytesOf = async (blob: Blob): Promise<Bytes> => new Uint8Array(await blob.arrayBuffer());

const meta = (id: string, name: string, size: number): PhotoMeta => ({
  id,
  name,
  size,
  width: 600,
  height: 400,
  takenAt: null,
  lastModified: SAVED_AT,
});

/** An album with these photos. Each id in `used` goes into one cell of its own, after the cover. */
function albumWith(photos: PhotoMeta[], used: string[] = photos.map((p) => p.id)): Album {
  let a = addPhotos(createAlbum('Весілля'), photos);
  used.forEach((id, i) => {
    a = placePhoto(a, { spreadId: a.spreads[i + 1].id, cellIndex: 0 }, id);
  });
  return a;
}

/** Builds an archive of `album` with one file per id. */
async function archiveOf(album: Album, files: Record<string, File>): Promise<{ saved: Album; blob: Blob; bytes: Bytes }> {
  const saved = archivableAlbum(album, SAVED_AT);
  const blob = await buildArchive(saved, new Map(Object.entries(files)), () => {});
  return { saved, blob, bytes: await bytesOf(blob) };
}

/** An archive from a second ZIP writer, with each entry stored. */
function craftedArchive(layout: string, photos: Record<string, Uint8Array> = {}): Blob {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = { 'album.json': [strToU8(layout), { level: 0 }] };
  for (const [name, content] of Object.entries(photos)) entries[name] = [content, { level: 0 }];
  return new Blob([zipSync(entries) as Bytes]);
}

/**
 * Reads the bytes with fflate, and compares the headers of each entry with this reader of the
 * directory and with the CRC-32 of node:zlib, because fflate does not check them.
 */
function checkedZip(bytes: Bytes): Record<string, Uint8Array> {
  const unzipped = unzipSync(bytes);
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  expect(view.getUint16(end + 8, true)).toBe(count);
  expect(count).toBe(Object.keys(unzipped).length);
  let at = view.getUint32(end + 16, true);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const nameBytes = view.getUint16(at + 28, true);
    const name = strFromU8(bytes.subarray(at + 46, at + 46 + nameBytes));
    names.push(name);
    const offset = view.getUint32(at + 42, true);
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    // Version needed, flags, method, time, date, CRC, two sizes and the name length: 24 bytes.
    expect(bytes.subarray(offset + 4, offset + 28)).toEqual(bytes.subarray(at + 6, at + 30));
    expect(strFromU8(bytes.subarray(offset + 30, offset + 30 + nameBytes))).toBe(name);
    expect(view.getUint16(at + 8, true) & 0x0800).toBe(0x0800);
    expect(view.getUint16(at + 10, true)).toBe(0);
    expect(view.getUint32(at + 16, true)).toBe(crc32(unzipped[name]));
    expect(view.getUint32(at + 20, true)).toBe(unzipped[name].length);
    expect(view.getUint32(at + 24, true)).toBe(unzipped[name].length);
    at += 46 + nameBytes;
  }
  expect(names[0]).toBe('album.json');
  return unzipped;
}

const layoutIn = (unzipped: Record<string, Uint8Array>) => parseLayout(strFromU8(unzipped['album.json']));

/** The position of the first byte of the content of an entry. */
function contentStart(bytes: Bytes, name: string): number {
  const view = new DataView(bytes.buffer);
  let at = view.getUint32(bytes.length - 22 + 16, true);
  for (;;) {
    const nameBytes = view.getUint16(at + 28, true);
    if (strFromU8(bytes.subarray(at + 46, at + 46 + nameBytes)) === name) {
      const offset = view.getUint32(at + 42, true);
      return offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    }
    at += 46 + nameBytes;
  }
}

function reasonOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ArchiveError ? e.reason : undefined;
  }
  return undefined;
}

test('the sha256 of each photo matches after a round trip', async () => {
  // The third file is larger than one read slice.
  const contents: Record<string, Bytes> = { a: fixture('land-1.jpg'), b: fixture('port-1.jpg'), c: pattern(Math.round(2.5 * MB), 7) };
  const album = albumWith([meta('a', 'land-1.jpg', contents.a.length), meta('b', 'port-1.jpg', contents.b.length), meta('c', 'big.jpg', contents.c.length)]);
  const { saved, blob, bytes } = await archiveOf(album, {
    a: fileOf(contents.a, 'land-1.jpg'),
    b: fileOf(contents.b, 'port-1.jpg'),
    c: fileOf(contents.c, 'big.jpg'),
  });

  const unzipped = checkedZip(bytes);
  expect(sha256(unzipped['photos/land-1.jpg'])).toBe(sha256(contents.a));
  expect(sha256(unzipped['photos/port-1.jpg'])).toBe(sha256(contents.b));
  expect(sha256(unzipped['photos/big.jpg'])).toBe(sha256(contents.c));

  const opened = await readArchive(blob);
  expect(opened.album).toEqual(saved);
  await opened.verify(() => {});
  for (const id of ['a', 'b', 'c']) {
    expect(sha256(await bytesOf(opened.originals.get(id)!))).toBe(sha256(contents[id]));
  }
});

test('the layout round-trips with its spreads, cells, crops and settings', async () => {
  const content = pattern(100, 1);
  let album = albumWith([meta('a', 'a.jpg', 100)]);
  album = applyTemplate(album, album.spreads[2].id, 'g8');
  album = setCrop(album, { spreadId: album.spreads[1].id, cellIndex: 0 }, { cx: 0.25, cy: 0.75, zoom: 2.5 });
  album = updateSettings(album, { gapMm: 11, background: '#123456', bookStart: 'single-right' });
  const { saved, blob } = await archiveOf(album, { a: fileOf(content) });
  const opened = await readArchive(blob);
  expect(opened.album.spreads).toEqual(album.spreads);
  expect(opened.album.settings).toEqual(album.settings);
  expect(opened.album).toEqual(saved);
});

test('an unused photo is absent and a photo on the cover is present', async () => {
  const album = albumWith([meta('cover', 'cover.jpg', 10), meta('unused', 'unused.jpg', 20)], []);
  const onCover = placePhoto(album, { spreadId: album.spreads[0].id, cellIndex: 0 }, 'cover');
  expect(onCover.spreads[0].isCover).toBe(true);
  // The map holds no file for the unused photo, so a read of that photo gives an error.
  const { saved, bytes } = await archiveOf(onCover, { cover: fileOf(pattern(10, 1)) });
  expect(saved.photos.map((p) => p.id)).toEqual(['cover']);
  expect(Object.keys(checkedZip(bytes)).sort()).toEqual(['album.json', 'photos/cover.jpg']);
});

test('a photo that only an unprinted half uses is present', async () => {
  let album = albumWith([meta('half', 'half.jpg', 10)], []);
  const spreadId = album.spreads[1].id;
  album = applyTemplate(album, spreadId, 'two');
  album = placePhoto(album, { spreadId, cellIndex: 0 }, 'half');
  album = updateSettings(album, { bookStart: 'single-right' });
  expect(printWarnings(album, new Set(['half']))).toContainEqual({ kind: 'unprinted-photo', ref: { spreadId, cellIndex: 0 } });
  const { bytes } = await archiveOf(album, { half: fileOf(pattern(10, 1)) });
  expect(Object.keys(checkedZip(bytes))).toContain('photos/half.jpg');
});

test('two photos with the same name both survive', async () => {
  const one = pattern(50, 1);
  const two = pattern(50, 2);
  const album = albumWith([meta('a', 'IMG_0001.jpg', 50), meta('b', 'IMG_0001.jpg', 50)]);
  const { saved, blob, bytes } = await archiveOf(album, { a: fileOf(one), b: fileOf(two) });

  expect(saved.photos.map((p) => p.name)).toEqual(['IMG_0001.jpg', 'IMG_0001-2.jpg']);
  const unzipped = checkedZip(bytes);
  expect(sha256(unzipped['photos/IMG_0001.jpg'])).toBe(sha256(one));
  expect(sha256(unzipped['photos/IMG_0001-2.jpg'])).toBe(sha256(two));

  const opened = await readArchive(blob);
  expect(sha256(await bytesOf(opened.originals.get('a')!))).toBe(sha256(one));
  expect(sha256(await bytesOf(opened.originals.get('b')!))).toBe(sha256(two));
  expect(opened.originals.get('b')!.name).toBe('IMG_0001-2.jpg');
  // The album on the saving device keeps its names (R-14).
  expect(album.photos.map((p) => p.name)).toEqual(['IMG_0001.jpg', 'IMG_0001.jpg']);
});

test('two names that differ only in case both survive', async () => {
  const album = albumWith([meta('a', 'photo.JPG', 5), meta('b', 'photo.jpg', 5)]);
  const contents = { a: pattern(5, 1), b: pattern(5, 2) };
  const { saved, blob, bytes } = await archiveOf(album, { a: fileOf(contents.a), b: fileOf(contents.b) });
  // addPhotos sorts the photos, so the order of the album decides which photo keeps its name.
  expect(saved.photos.map((p) => p.name)).toEqual(['photo.jpg', 'photo-2.JPG']);
  expect(Object.keys(checkedZip(bytes)).length).toBe(3);
  const opened = await readArchive(blob);
  for (const id of ['a', 'b'] as const) {
    expect(sha256(await bytesOf(opened.originals.get(id)!))).toBe(sha256(contents[id]));
  }
});

test('a name that collides with an existing IMG_0001-2.jpg survives', async () => {
  const album = albumWith([meta('a', 'IMG_0001.jpg', 5), meta('b', 'IMG_0001.jpg', 5), meta('c', 'IMG_0001-2.jpg', 5)]);
  const contents = { a: pattern(5, 1), b: pattern(5, 2), c: pattern(5, 3) };
  const { saved, blob, bytes } = await archiveOf(album, { a: fileOf(contents.a), b: fileOf(contents.b), c: fileOf(contents.c) });
  const byId = new Map(saved.photos.map((p) => [p.id, p.name]));
  // A photo with a unique name keeps that name.
  expect(byId.get('c')).toBe('IMG_0001-2.jpg');
  expect(byId.get('b')).toBe('IMG_0001-3.jpg');
  expect(Object.keys(checkedZip(bytes)).length).toBe(4);
  const opened = await readArchive(blob);
  for (const id of ['a', 'b', 'c'] as const) {
    expect(sha256(await bytesOf(opened.originals.get(id)!))).toBe(sha256(contents[id]));
  }
});

test('a photo named a\\b.jpg round-trips through buildArchive and readArchive', async () => {
  const content = pattern(5, 1);
  const album = albumWith([meta('a', 'a\\b.jpg', 5)]);
  const { saved, blob, bytes } = await archiveOf(album, { a: fileOf(content) });
  expect(saved.photos[0].name).toBe('a_b.jpg');
  expect(Object.keys(checkedZip(bytes))).toContain('photos/a_b.jpg');
  const opened = await readArchive(blob);
  expect(opened.album.photos[0].name).toBe('a_b.jpg');
  expect(sha256(await bytesOf(opened.originals.get('a')!))).toBe(sha256(content));
  // The album on the saving device keeps its name (R-14).
  expect(album.photos[0].name).toBe('a\\b.jpg');
});

test('a name with a slash changes before the uniqueness rule runs', async () => {
  const contents = { a: pattern(5, 1), b: pattern(5, 2), c: pattern(5, 3) };
  const album = albumWith([meta('a', 'a/b.jpg', 5), meta('b', 'a\\b.jpg', 5), meta('c', 'a_b.jpg', 5)]);
  const { saved, blob } = await archiveOf(album, { a: fileOf(contents.a), b: fileOf(contents.b), c: fileOf(contents.c) });
  expect(saved.photos.map((p) => p.name).sort()).toEqual(['a_b-2.jpg', 'a_b-3.jpg', 'a_b.jpg']);
  const opened = await readArchive(blob);
  for (const id of ['a', 'b', 'c'] as const) {
    expect(sha256(await bytesOf(opened.originals.get(id)!))).toBe(sha256(contents[id]));
  }
});

test('a name of exactly .. does not reach the output of archivableAlbum', async () => {
  const contents = { a: pattern(5, 1), b: pattern(5, 2) };
  const album = albumWith([meta('a', '..', 5), meta('b', '.', 5)]);
  const { saved, blob } = await archiveOf(album, { a: fileOf(contents.a), b: fileOf(contents.b) });
  const names = saved.photos.map((p) => p.name);
  expect(names).not.toContain('..');
  expect(names).not.toContain('.');
  expect(new Set(names).size).toBe(2);
  const opened = await readArchive(blob);
  for (const id of ['a', 'b'] as const) {
    expect(sha256(await bytesOf(opened.originals.get(id)!))).toBe(sha256(contents[id]));
  }
});

test('an empty name does not reach the output of archivableAlbum', () => {
  const saved = archivableAlbum(albumWith([meta('a', '', 5)]), SAVED_AT);
  expect(saved.photos[0].name).toBe('_');
});

test('a Cyrillic name round-trips with flag bit 11 set', async () => {
  const album = albumWith([meta('a', 'Весілля №1.jpg', 5)]);
  const { blob, bytes } = await archiveOf(album, { a: fileOf(pattern(5, 1)) });
  // fflate decodes a name as UTF-8 only when the flag is set, and checkedZip reads the flag.
  expect(Object.keys(checkedZip(bytes))).toContain('photos/Весілля №1.jpg');
  const opened = await readArchive(blob);
  expect(opened.album.photos[0].name).toBe('Весілля №1.jpg');
  expect(opened.originals.get('a')!.name).toBe('Весілля №1.jpg');
});

test('an album with no used photo round-trips', async () => {
  const album = albumWith([meta('unused', 'unused.jpg', 5)], []);
  const { saved, blob, bytes } = await archiveOf(album, {});
  expect(Object.keys(checkedZip(bytes))).toEqual(['album.json']);
  const opened = await readArchive(blob);
  expect(opened.album).toEqual(saved);
  expect(opened.album.photos).toEqual([]);
  expect(opened.originals.size).toBe(0);
  await opened.verify(() => {});
});

test('the CRC-32 of the text 123456789 is the check value', async () => {
  expect(await crc32OfBlob(new Blob(['123456789']))).toBe(0xcbf43926);
});

test('the CRC-32 agrees with node:zlib over a slice boundary, and of no bytes', async () => {
  const content = pattern(MB + 5, 3);
  const seen: number[] = [];
  expect(await crc32OfBlob(new Blob([content]), (n) => seen.push(n))).toBe(crc32(content));
  expect(seen).toEqual([MB, MB + 5]);
  expect(await crc32OfBlob(new Blob([]))).toBe(0);
});

test('album.json holds the size of the file, also when the file has another size than the photo', async () => {
  const album = albumWith([meta('a', 'a.jpg', 999)]);
  const { blob, bytes } = await archiveOf(album, { a: fileOf(pattern(40, 1)) });
  expect(layoutIn(checkedZip(bytes)).photos[0].size).toBe(40);
  const opened = await readArchive(blob);
  expect(opened.album.photos[0].size).toBe(40);
  expect(opened.originals.get('a')!.size).toBe(40);
  // The album on the saving device does not change.
  expect(album.photos[0].size).toBe(999);
});

test('lastFileSaveAt in album.json equals the save time, and the source album stays as it was', async () => {
  const album = albumWith([meta('a', 'a.jpg', 5)]);
  const { saved, bytes } = await archiveOf(album, { a: fileOf(pattern(5, 1)) });
  expect(layoutIn(checkedZip(bytes)).lastFileSaveAt).toBe(SAVED_AT);
  expect(saved.updatedAt).toBe(album.updatedAt);
  expect(album.lastFileSaveAt).toBeNull();
});

test('an archive cut short gives zip', async () => {
  const { bytes } = await archiveOf(albumWith([meta('a', 'a.jpg', 200)]), { a: fileOf(pattern(200, 1)) });
  for (const length of [bytes.length - 1, bytes.length - 30, 100, 4]) {
    const cut = new Blob([bytes.slice(0, length)]);
    expect(await isZip(cut)).toBe(true);
    await expect(readArchive(cut)).rejects.toMatchObject({ reason: 'zip' });
  }
});

test('a deflated ZIP gives zip', async () => {
  const layout = serializeLayout(albumWith([]));
  const deflated = zipSync({ 'album.json': strToU8(layout) }) as Bytes;
  expect(new DataView(deflated.buffer).getUint16(8, true)).toBe(8);
  await expect(readArchive(new Blob([deflated]))).rejects.toMatchObject({ reason: 'zip' });
});

test('a directory out of the file gives zip', async () => {
  const { bytes } = await archiveOf(albumWith([]), {});
  new DataView(bytes.buffer).setUint32(bytes.length - 22 + 16, bytes.length, true);
  await expect(readArchive(new Blob([bytes]))).rejects.toMatchObject({ reason: 'zip' });
});

// `at` holds the positions of the end record, and of the first entry in the directory and in the file.
type Patch = (v: DataView, at: { end: number; central: number; local: number }) => void;

const REFUSALS: [string, Patch][] = [
  ['a disk number in the end record', (v, at) => v.setUint16(at.end + 4, 1, true)],
  ['a directory disk number in the end record', (v, at) => v.setUint16(at.end + 6, 1, true)],
  ['an entry count above the directory', (v, at) => v.setUint16(at.end + 10, 3, true)],
  ['a bad central signature', (v, at) => v.setUint32(at.central, 0x01020304, true)],
  ['the encrypted flag', (v, at) => v.setUint16(at.central + 8, v.getUint16(at.central + 8, true) | 1, true)],
  ['a packed size that differs from the size', (v, at) => v.setUint32(at.central + 20, v.getUint32(at.central + 20, true) + 1, true)],
  ['a name that overruns the directory', (v, at) => v.setUint16(at.central + 28, 0xffff, true)],
  ['a bad local signature', (v, at) => v.setUint32(at.local, 0x01020304, true)],
  ['a local header out of the file', (v, at) => v.setUint32(at.central + 42, v.byteLength, true)],
  ['content that overruns the directory', (v, at) => v.setUint16(at.local + 26, 0xffff, true)],
];

test.each(REFUSALS)('%s gives zip', async (_title, patch) => {
  const { blob, bytes } = await archiveOf(albumWith([meta('a', 'a.jpg', 5)]), { a: fileOf(pattern(5, 1)) });
  await expect(readArchive(blob)).resolves.toBeDefined();
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  patch(view, { end, central: view.getUint32(end + 16, true), local: 0 });
  await expect(readArchive(new Blob([bytes]))).rejects.toMatchObject({ reason: 'zip' });
});

test('a failed read rejects with the raw DOMException, from readArchive and from verify', async () => {
  const expectRawReadError = (failure: unknown) => {
    expect(failure).toBeInstanceOf(DOMException);
    expect(failure).toMatchObject({ name: 'NotReadableError' });
    expect(failure).not.toBeInstanceOf(ArchiveError);
  };
  const unreadable = new UnreadableFile([pattern(100, 1)], 'x.album.zip');
  expectRawReadError(await readArchive(unreadable).catch((e: unknown) => e));

  const { blob } = await archiveOf(albumWith([meta('a', 'a.jpg', 5)]), { a: fileOf(pattern(5, 1)) });
  const opened = await readArchive(blob);
  opened.originals.set('a', new UnreadableFile([pattern(5, 1)], 'a.jpg'));
  expectRawReadError(await opened.verify(() => {}).catch((e: unknown) => e));
});

test('the memory rule holds on the read side: readArchive and verify read a large photo in slices', async () => {
  const content = pattern(3 * MB, 1);
  const { blob } = await archiveOf(albumWith([meta('a', 'a.jpg', 3 * MB)]), { a: fileOf(content) });
  // archiveOf reads the whole archive, so the spies start after it.
  const reads = vi.spyOn(Blob.prototype, 'arrayBuffer');
  const texts = vi.spyOn(Blob.prototype, 'text');
  const opened = await readArchive(blob);
  const readBeforeVerify = reads.mock.contexts.length;
  await opened.verify(() => {});

  const sizes = (reads.mock.contexts as Blob[]).map((b) => b.size);
  expect(Math.max(...sizes)).toBe(MB);
  // verify reads the 3 MB photo in 3 slices.
  expect(sizes.slice(readBeforeVerify)).toEqual([MB, MB, MB]);
  for (const text of texts.mock.contexts as Blob[]) expect(text.size).toBeLessThanOrEqual(MB);
});

test('expectedCrc holds the CRC-32 of each photo, by photo id', async () => {
  const contents = { a: pattern(50, 1), b: pattern(70, 2) };
  const { blob } = await archiveOf(albumWith([meta('a', 'a.jpg', 50), meta('b', 'b.jpg', 70)]), {
    a: fileOf(contents.a),
    b: fileOf(contents.b),
  });
  const opened = await readArchive(blob);
  expect(opened.expectedCrc).toEqual(new Map([['a', crc32(contents.a)], ['b', crc32(contents.b)]]));
});

test('expectedCrc comes from the directory, so a changed photo byte does not change it', async () => {
  const content = pattern(50, 1);
  const { bytes } = await archiveOf(albumWith([meta('a', 'a.jpg', 50)]), { a: fileOf(content) });
  bytes[contentStart(bytes, 'photos/a.jpg') + 25] ^= 0x01;
  const opened = await readArchive(new Blob([bytes]));
  expect(opened.expectedCrc.get('a')).toBe(crc32(content));
});

test('a file that is not a ZIP gives zip', async () => {
  await expect(readArchive(new Blob(['not a zip file, and longer than the end record of a zip']))).rejects.toMatchObject({ reason: 'zip' });
  await expect(readArchive(new Blob([]))).rejects.toMatchObject({ reason: 'zip' });
});

test('a changed photo byte gives damaged from verify', async () => {
  const { bytes } = await archiveOf(albumWith([meta('a', 'a.jpg', 50)]), { a: fileOf(pattern(50, 1)) });
  bytes[contentStart(bytes, 'photos/a.jpg') + 25] ^= 0x01;
  const opened = await readArchive(new Blob([bytes]));
  await expect(opened.verify(() => {})).rejects.toMatchObject({ reason: 'damaged' });
});

test('a changed layout byte gives damaged from readArchive', async () => {
  const { bytes } = await archiveOf(albumWith([]), {});
  bytes[contentStart(bytes, 'album.json') + 20] ^= 0x01;
  await expect(readArchive(new Blob([bytes]))).rejects.toMatchObject({ reason: 'damaged' });
});

test('a newer layout version gives LayoutFileError', async () => {
  const layout = JSON.stringify({ format: 'album-builder', version: 2, album: albumWith([]) });
  const failure = await readArchive(craftedArchive(layout)).catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(LayoutFileError);
  expect(failure).toMatchObject({ reason: 'version' });
});

test('a ZIP with no album.json gives content', async () => {
  const foreign = zipSync({ 'notes.txt': [strToU8('hello'), { level: 0 }] }) as Bytes;
  await expect(readArchive(new Blob([foreign]))).rejects.toMatchObject({ reason: 'content' });
});

test('a layout with no photos array gives content', async () => {
  const layout = JSON.stringify({ format: 'album-builder', version: 1, album: { ...albumWith([]), photos: undefined } });
  await expect(readArchive(craftedArchive(layout))).rejects.toMatchObject({ reason: 'content' });
});

test('a photo name with a slash gives content, also when the entry exists', async () => {
  const album = albumWith([meta('a', '../x.jpg', 5)]);
  const archive = craftedArchive(serializeLayout(album), { 'photos/../x.jpg': pattern(5, 1) });
  await expect(readArchive(archive)).rejects.toMatchObject({ reason: 'content' });
});

test('a photo name with a backslash gives content, also when the entry exists', async () => {
  const album = albumWith([meta('a', '..\\x.jpg', 5)]);
  const archive = craftedArchive(serializeLayout(album), { 'photos/..\\x.jpg': pattern(5, 1) });
  await expect(readArchive(archive)).rejects.toMatchObject({ reason: 'content' });
});

test('an album photo with no entry gives content', async () => {
  const album = albumWith([meta('a', 'a.jpg', 5)]);
  await expect(readArchive(craftedArchive(serializeLayout(album)))).rejects.toMatchObject({ reason: 'content' });
});

test('an entry of another size gives content', async () => {
  const album = albumWith([meta('a', 'a.jpg', 5)]);
  const archive = craftedArchive(serializeLayout(album), { 'photos/a.jpg': pattern(6, 1) });
  await expect(readArchive(archive)).rejects.toMatchObject({ reason: 'content' });
});

test('sizes of 5 GB give too-large, and so do 65,536 entries', () => {
  expect(reasonOf(() => assertFitsArchive([5 * GB]))).toBe('too-large');
  expect(reasonOf(() => assertFitsArchive([3 * GB, 3 * GB]))).toBe('too-large');
  expect(reasonOf(() => assertFitsArchive(new Array<number>(65_536).fill(1)))).toBe('too-large');
});

test('the limit check accepts the agreed size and leaves a margin for the headers', () => {
  expect(() => assertFitsArchive(new Array<number>(301).fill(5 * MB))).not.toThrow();
  expect(() => assertFitsArchive([3.5 * GB])).not.toThrow();
  expect(() => assertFitsArchive(new Array<number>(65_535).fill(1))).not.toThrow();
  // The content fits in 32 bits, but the content and the headers do not.
  expect(reasonOf(() => assertFitsArchive([4 * GB - 100]))).toBe('too-large');
});

test('a build over the limit gives too-large and reads no file', async () => {
  const file = fileOf(pattern(5, 1));
  Object.defineProperty(file, 'size', { value: 5 * GB });
  const slice = vi.spyOn(file, 'slice');
  const saved = archivableAlbum(albumWith([meta('a', 'a.jpg', 5)]), SAVED_AT);
  await expect(buildArchive(saved, new Map([['a', file]]), () => {})).rejects.toMatchObject({ reason: 'too-large' });
  expect(slice).not.toHaveBeenCalled();
});

test('a file that cannot be read gives UnreadablePhotoError with its photo id', async () => {
  const saved = archivableAlbum(albumWith([meta('good', 'good.jpg', 5), meta('bad', 'bad.jpg', 5)]), SAVED_AT);
  const originals = new Map<string, File>([
    ['good', fileOf(pattern(5, 1))],
    ['bad', new UnreadableFile([pattern(5, 2)], 'bad.jpg')],
  ]);
  const failure = await buildArchive(saved, originals, () => {}).catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(UnreadablePhotoError);
  expect(failure).toMatchObject({ photoId: 'bad' });
});

test('a failure in the progress handler is not a failure to read a photo', async () => {
  const saved = archivableAlbum(albumWith([meta('a', 'a.jpg', 5)]), SAVED_AT);
  const bug = new TypeError('a bug in the handler');
  const handler = (done: number) => {
    if (done > 0) throw bug;
  };
  await expect(buildArchive(saved, new Map([['a', fileOf(pattern(5, 1))]]), handler)).rejects.toBe(bug);
});

test('a photo with no file in the map gives UnreadablePhotoError with its photo id', async () => {
  const saved = archivableAlbum(albumWith([meta('a', 'a.jpg', 5)]), SAVED_AT);
  const failure = await buildArchive(saved, new Map(), () => {}).catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(UnreadablePhotoError);
  expect(failure).toMatchObject({ photoId: 'a' });
});

test('the build reads a large file in slices and never as a whole', async () => {
  const file = fileOf(pattern(3 * MB, 1));
  const slice = vi.spyOn(file, 'slice');
  const whole = vi.spyOn(file, 'arrayBuffer');
  await archiveOf(albumWith([meta('a', 'a.jpg', 3 * MB)]), { a: file });
  expect(slice.mock.calls.length).toBeGreaterThan(1);
  for (const [start, end] of slice.mock.calls) expect(end! - start!).toBeLessThanOrEqual(MB);
  expect(whole).not.toHaveBeenCalled();
});

test('the build and verify report bytes that advance to the total', async () => {
  const size = 2 * MB + 10;
  const saved = archivableAlbum(albumWith([meta('a', 'a.jpg', size), meta('b', 'b.jpg', 10)]), SAVED_AT);
  const originals = new Map([
    ['a', fileOf(pattern(size, 1))],
    ['b', fileOf(pattern(10, 2))],
  ]);
  const building: number[] = [];
  const blob = await buildArchive(saved, originals, (done, total) => {
    expect(total).toBe(size + 10);
    building.push(done);
  });
  expect(building[0]).toBe(0);
  expect(building.at(-1)).toBe(size + 10);
  expect(building).toEqual([...building].sort((x, y) => x - y));

  const verifying: number[] = [];
  await (await readArchive(blob)).verify((done, total) => {
    expect(total).toBe(size + 10);
    verifying.push(done);
  });
  expect(verifying).toEqual(building);
});

test('an opened photo refers to its own part of the archive, with its name and date and type', async () => {
  const { blob } = await archiveOf(albumWith([meta('a', 'a.JPG', 5), meta('b', 'b.webp', 7)]), {
    a: fileOf(pattern(5, 1)),
    b: fileOf(pattern(7, 2)),
  });
  const { originals } = await readArchive(blob);
  expect(originals.get('a')).toMatchObject({ name: 'a.JPG', size: 5, type: 'image/jpeg', lastModified: SAVED_AT });
  expect(originals.get('b')).toMatchObject({ name: 'b.webp', size: 7, type: 'image/webp', lastModified: SAVED_AT });
});

test('the reader follows the local header and accepts a ZIP comment', async () => {
  const album = albumWith([meta('a', 'a.jpg', 5)]);
  const content = pattern(5, 1);
  const zipped = zipSync({
    'album.json': [strToU8(serializeLayout(album)), { level: 0 }],
    'photos/a.jpg': [content, { level: 0, extra: { 0x7075: pattern(9, 4) } }],
  }) as Bytes;
  const comment = strToU8('a comment');
  const withComment = new Uint8Array(zipped.length + comment.length);
  withComment.set(zipped);
  withComment.set(comment, zipped.length);
  new DataView(withComment.buffer).setUint16(zipped.length - 2, comment.length, true);

  const opened = await readArchive(new Blob([withComment]));
  expect(sha256(await bytesOf(opened.originals.get('a')!))).toBe(sha256(content));
  await opened.verify(() => {});
});

test('each entry gets a valid ZIP date from its file', async () => {
  const modified = new Date(2024, 4, 17, 10, 30, 20).getTime();
  const { bytes } = await archiveOf(albumWith([meta('new', 'new.jpg', 5), meta('old', 'old.jpg', 5), meta('far', 'far.jpg', 5)]), {
    new: fileOf(pattern(5, 1), 'new.jpg', modified),
    old: fileOf(pattern(5, 2), 'old.jpg', 0),
    far: fileOf(pattern(5, 3), 'far.jpg', new Date(2200, 0, 1).getTime()),
  });
  const view = new DataView(bytes.buffer);
  const headerOf = (name: string) => contentStart(bytes, name) - 30 - strToU8(name).length;
  const newest = headerOf('photos/new.jpg');
  expect(view.getUint16(newest + 10, true)).toBe((10 << 11) | (30 << 5) | 10);
  expect(view.getUint16(newest + 12, true)).toBe((44 << 9) | (5 << 5) | 17);
  // A time before 1980 becomes 1980-01-01, the first date that a ZIP can hold.
  const oldest = headerOf('photos/old.jpg');
  expect(view.getUint16(oldest + 10, true)).toBe(0);
  expect(view.getUint16(oldest + 12, true)).toBe((1 << 5) | 1);
  // A time after 2107 becomes the last moment that a ZIP can hold.
  const farthest = headerOf('photos/far.jpg');
  expect(view.getUint16(farthest + 10, true)).toBe((23 << 11) | (59 << 5) | 29);
  expect(view.getUint16(farthest + 12, true)).toBe((127 << 9) | (12 << 5) | 31);
});

test('isZip accepts a ZIP and refuses other files', async () => {
  const { blob } = await archiveOf(albumWith([]), {});
  expect(await isZip(blob)).toBe(true);
  expect(await isZip(new Blob(['{"format":"album-builder"}']))).toBe(false);
  expect(await isZip(new Blob(['PK']))).toBe(false);
  expect(await isZip(new Blob([]))).toBe(false);
});

test('archiveFileName ends in .album.zip and replaces the marks that a file name cannot hold', () => {
  const album = createAlbum('Весілля');
  expect(archiveFileName(album)).toBe('Весілля.album.zip');
  expect(archiveFileName({ ...album, name: 'a/b:c' })).toBe('a_b_c.album.zip');
  expect(archiveFileName({ ...album, name: '' })).toBe('album.album.zip');
});

test('safeBaseName replaces each mark that a file name cannot hold, and no name gives album', () => {
  expect(safeBaseName('Весілля 2026')).toBe('Весілля 2026');
  expect(safeBaseName('a\\b/c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  // Each mark gets its own `_`. The print export collapses a run of marks, and it stays separate.
  expect(safeBaseName('a::b')).toBe('a__b');
  expect(safeBaseName('')).toBe('album');
});

test('nameKey ignores case, and freeName returns a free name as it is', () => {
  expect(nameKey('IMG.JPG')).toBe(nameKey('img.jpg'));
  const taken = new Set<string>();
  expect(freeName('IMG.jpg', taken)).toBe('IMG.jpg');
  expect(taken).toEqual(new Set(['img.jpg']));
});

test('freeName adds a number before the extension, without regard to case, and the result goes into taken', () => {
  const taken = new Set(['img.jpg', 'img-2.jpg']);
  expect(freeName('IMG.JPG', taken)).toBe('IMG-3.JPG');
  expect(taken.has('img-3.jpg')).toBe(true);
  expect(freeName('img.jpg', taken)).toBe('img-4.jpg');
});

test('freeName adds the number at the end of a name with no extension', () => {
  expect(freeName('notes', new Set(['notes']))).toBe('notes-2');
  expect(freeName('.hidden', new Set(['.hidden']))).toBe('.hidden-2');
});

test('isPlainName refuses a name that can leave its folder', () => {
  for (const name of ['', '.', '..', 'a/b.jpg', 'a\\b.jpg']) expect(isPlainName(name)).toBe(false);
  for (const name of ['a.jpg', '...', 'a:b.jpg', 'Весілля.jpg']) expect(isPlainName(name)).toBe(true);
});

test('archivablePhotos holds the used photos with their names in the album', () => {
  let album = albumWith([meta('cover', 'b/c.jpg', 5), meta('half', 'half.jpg', 5), meta('cell', 'cell.jpg', 5), meta('unused', 'unused.jpg', 5)], []);
  album = placePhoto(album, { spreadId: album.spreads[0].id, cellIndex: 0 }, 'cover');
  const spreadId = album.spreads[1].id;
  album = applyTemplate(album, spreadId, 'two');
  album = placePhoto(album, { spreadId, cellIndex: 0 }, 'half');
  album = placePhoto(album, { spreadId: album.spreads[2].id, cellIndex: 0 }, 'cell');
  album = updateSettings(album, { bookStart: 'single-right' });
  expect(printWarnings(album, new Set(['cover', 'half', 'cell']))).toContainEqual({ kind: 'unprinted-photo', ref: { spreadId, cellIndex: 0 } });

  const photos = archivablePhotos(album);
  expect(photos.map((p) => p.id).sort()).toEqual(['cell', 'cover', 'half']);
  // The originals come under these names. Only the archive holds the changed names.
  expect(photos.find((p) => p.id === 'cover')!.name).toBe('b/c.jpg');
  expect(archivableAlbum(album, SAVED_AT).photos.map((p) => p.id)).toEqual(photos.map((p) => p.id));
});

/** A file handle in memory. `failOn` selects the operation that rejects. */
function fakeWritable(failOn: { write?: number; close?: boolean; abort?: boolean } = {}) {
  const written: Blob[] = [];
  const close = vi.fn(() => (failOn.close ? Promise.reject(new Error('close failed')) : Promise.resolve()));
  const abort = vi.fn(() => (failOn.abort ? Promise.reject(new Error('abort failed')) : Promise.resolve()));
  const write = vi.fn((d: Blob) => {
    if (written.length === failOn.write) return Promise.reject(new Error('write failed'));
    written.push(d);
    return Promise.resolve();
  });
  const createWritable = vi.fn(() => Promise.resolve({ write, close, abort }));
  return { written, write, close, abort, createWritable, handle: { createWritable } };
}

test('writeInSlices writes all bytes in slices of 1 MiB and reports each slice', async () => {
  const content = pattern(2 * MB + 10, 1);
  const file = fakeWritable();
  const seen: number[] = [];
  await writeInSlices(file.handle, new Blob([content]), (done) => seen.push(done));
  expect(file.written.map((b) => b.size)).toEqual([MB, MB, 10]);
  expect(sha256(await bytesOf(new Blob(file.written)))).toBe(sha256(content));
  expect(seen).toEqual([MB, 2 * MB, 2 * MB + 10]);
  expect(file.close).toHaveBeenCalledTimes(1);
  expect(file.abort).not.toHaveBeenCalled();
});

test('a failed write in writeInSlices calls abort, does not close, and rejects with the write error', async () => {
  const file = fakeWritable({ write: 1 });
  const seen: number[] = [];
  await expect(writeInSlices(file.handle, new Blob([pattern(2 * MB, 1)]), (done) => seen.push(done))).rejects.toThrow('write failed');
  expect(seen).toEqual([MB]);
  expect(file.abort).toHaveBeenCalledTimes(1);
  expect(file.close).not.toHaveBeenCalled();
});

test('a failed close in writeInSlices calls abort and rejects with the close error', async () => {
  const file = fakeWritable({ close: true });
  await expect(writeInSlices(file.handle, new Blob([pattern(5, 1)]), () => {})).rejects.toThrow('close failed');
  expect(file.abort).toHaveBeenCalledTimes(1);
});

test('a rejected abort in writeInSlices leaves the first error as the result', async () => {
  const file = fakeWritable({ write: 0, abort: true });
  await expect(writeInSlices(file.handle, new Blob([pattern(5, 1)]), () => {})).rejects.toThrow('write failed');
  expect(file.abort).toHaveBeenCalledTimes(1);
});

test('saveArchiveBlob starts the write only after the picker resolves, and gives saved', async () => {
  const file = fakeWritable();
  let choose!: (handle: typeof file.handle) => void;
  const showSaveFilePicker = vi.fn(() => new Promise((resolve) => (choose = resolve)));
  vi.stubGlobal('window', { showSaveFilePicker });
  const seen: number[] = [];

  const saving = saveArchiveBlob(new Blob([pattern(MB + 1, 1)]), 'a.album.zip', (done) => seen.push(done));
  expect(showSaveFilePicker).toHaveBeenCalledWith({
    suggestedName: 'a.album.zip',
    types: [{ accept: { 'application/zip': ['.zip'] } }],
  });
  await Promise.resolve();
  expect(file.createWritable).not.toHaveBeenCalled();
  expect(seen).toEqual([]);

  choose(file.handle);
  await expect(saving).resolves.toBe('saved');
  expect(seen).toEqual([0, MB, MB + 1]);
  expect(file.close).toHaveBeenCalledTimes(1);
});

test('saveArchiveBlob lets an AbortError of the picker propagate, and writes nothing', async () => {
  const cancel = new DOMException('the person closed the picker', 'AbortError');
  vi.stubGlobal('window', { showSaveFilePicker: () => Promise.reject(cancel) });
  const onBytes = vi.fn();
  await expect(saveArchiveBlob(new Blob(['x']), 'a.album.zip', onBytes)).rejects.toBe(cancel);
  expect(onBytes).not.toHaveBeenCalled();
});

test('saveArchiveBlob rejects with a write error after the picker', async () => {
  const file = fakeWritable({ write: 0 });
  vi.stubGlobal('window', { showSaveFilePicker: () => Promise.resolve(file.handle) });
  await expect(saveArchiveBlob(new Blob(['x']), 'a.album.zip', () => {})).rejects.toThrow('write failed');
  expect(file.abort).toHaveBeenCalledTimes(1);
});

/** Stubs the page objects that a download uses. */
function stubDownload() {
  const link = { href: '', download: '', click: vi.fn() };
  vi.stubGlobal('document', { createElement: () => link });
  const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  return { link, created, revoked };
}

test('downloadBlob clicks a link with the name, and revokes the URL after the lifetime', () => {
  vi.useFakeTimers();
  const { link, created, revoked } = stubDownload();
  const blob = new Blob(['x']);
  downloadBlob(blob, 'a.zip', 1000);
  expect(created).toHaveBeenCalledWith(blob);
  expect(link).toMatchObject({ href: 'blob:test', download: 'a.zip' });
  expect(link.click).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(999);
  expect(revoked).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(revoked).toHaveBeenCalledWith('blob:test');
});

test('with no picker, saveArchiveBlob starts a download that stays valid for 10 minutes, and gives received', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {});
  const { link, revoked } = stubDownload();
  const onBytes = vi.fn();
  await expect(saveArchiveBlob(new Blob(['x']), 'a.album.zip', onBytes)).resolves.toBe('received');
  expect(link.download).toBe('a.album.zip');
  expect(link.click).toHaveBeenCalledTimes(1);
  expect(onBytes).not.toHaveBeenCalled();
  vi.advanceTimersByTime(10 * 60_000 - 1);
  expect(revoked).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(revoked).toHaveBeenCalledTimes(1);
});

test('saveLayoutFile with no picker downloads under the safe name of the album', async () => {
  vi.stubGlobal('window', {});
  const { link } = stubDownload();
  await saveLayoutFile({ ...createAlbum('a'), name: 'a/b' });
  expect(link.download).toBe('a_b.album.json');
  expect(link.click).toHaveBeenCalledTimes(1);
});
