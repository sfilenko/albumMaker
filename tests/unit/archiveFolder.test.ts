// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, expect, test, vi } from 'vitest';
import { addPhotos, createAlbum } from '../../src/model/album';
import type { Album, PhotoMeta } from '../../src/model/types';
import {
  deleteReplacedPreviews,
  deleteStrayPreviews,
  makeScreenCopies,
  newNames,
  ScreenCopyError,
  subfolderName,
  writeToFolder,
} from '../../src/photos/archiveFolder';
import { acceptedExtension, isAccepted } from '../../src/photos/import';
import { crc32OfBlob, isPlainName, type OpenedArchive } from '../../src/storage/archive';
import { hasPreviews, loadAlbum, putPreview, saveAlbum } from '../../src/storage/db';

const noProgress = () => {};

afterEach(() => {
  vi.unstubAllGlobals();
});

test.each([
  ['Весілля', 'album-Весілля'],
  ['a:b*c', 'album-a_b_c'],
  ['a::b', 'album-a_b'],
  ['../x', 'album-.._x'],
  ['Весілля.', 'album-Весілля'],
  ['Весілля. . ', 'album-Весілля'],
  ['  Весілля  ', 'album-Весілля'],
  ['...', 'album-album'],
  ['', 'album-album'],
  ['   ', 'album-album'],
])('subfolderName of %j is %j', (name, expected) => {
  expect(subfolderName(name)).toBe(expected);
});

test.each([
  ['a:b.jpg', ['a_b.jpg', 'photo.jpg']],
  ['a/b.webp', ['a_b.webp', 'photo.webp']],
  ['a\\b.png', ['a_b.png', 'photo.png']],
  ['a\u0001.jpg', ['a_.jpg', 'photo.jpg']],
  ['X.PNG', ['X.PNG', 'photo.PNG']],
  ['x.png.', ['x.png', 'photo.jpg']],
  ['x.jpg .', ['x.jpg', 'photo.jpg']],
  ['...', ['photo.jpg']],
  ['..', ['photo.jpg']],
  ['', ['photo.jpg']],
  ['pic.gif', ['photo.jpg']],
])('newNames of %j is %j', (name, expected) => {
  const names = newNames(name, new Set());
  expect(names).toEqual(expected);
  for (const n of names) {
    expect(isPlainName(n)).toBe(true);
    expect(isAccepted(n)).toBe(true);
  }
});

test('newNames adds a number to a taken name, without regard to case', () => {
  expect(newNames('A:B.JPG', new Set(['a_b.jpg', 'photo.jpg']))).toEqual(['A_B-2.JPG', 'photo-2.JPG']);
  expect(newNames('a:b.jpg', new Set(['a_b.jpg', 'a_b-2.jpg']))).toEqual(['a_b-3.jpg', 'photo.jpg']);
});

test('a candidate that newNames does not keep stays free for a later photo', () => {
  const taken = new Set(['land.jpg']);
  expect(newNames('a:b.jpg', taken)).toEqual(['a_b.jpg', 'photo.jpg']);
  expect([...taken]).toEqual(['land.jpg']);
  expect(newNames('a:b.jpg', taken)).toEqual(['a_b.jpg', 'photo.jpg']);
  expect(newNames('c:d.jpg', taken)).toEqual(['c_d.jpg', 'photo.jpg']);
  expect([...taken]).toEqual(['land.jpg']);
});

test('acceptedExtension gives the extension as the name writes it, and null for any other name', () => {
  expect(acceptedExtension('a.JPeG')).toBe('.JPeG');
  expect(acceptedExtension('a.b.webp')).toBe('.webp');
  expect(acceptedExtension('a.gif')).toBeNull();
  expect(acceptedExtension('jpg')).toBeNull();
});

const bytesOf = (text: string) => new TextEncoder().encode(text);

/** A folder in memory. `refused` holds the names that `getFileHandle` rejects. */
function fakeFolder(existing: Record<string, string> = {}, refused: string[] = []) {
  const files = new Map<string, { kind: 'file'; name: string; getFile(): Promise<File>; createWritable(): Promise<unknown> }>();
  const writes: string[] = [];
  const add = (name: string, first: Blob) => {
    let content = first;
    const entry = {
      kind: 'file' as const,
      name,
      getFile: async () => new File([content], name),
      createWritable: async () => {
        const parts: Blob[] = [];
        return {
          write: async (d: Blob) => void parts.push(d),
          close: async () => {
            content = new Blob(parts);
            writes.push(name);
          },
          abort: async () => {},
        };
      },
    };
    files.set(name, entry);
    return entry;
  };
  for (const [name, text] of Object.entries(existing)) add(name, new Blob([bytesOf(text)]));
  const dir = {
    getFileHandle: async (name: string) => {
      if (refused.includes(name)) throw new TypeError('Name is not allowed.');
      return files.get(name) ?? add(name, new Blob([]));
    },
    values: async function* () {
      yield* files.values();
    },
    removeEntry: async (name: string) => void files.delete(name),
  };
  const asked: string[] = [];
  const root = {
    getDirectoryHandle: async (name: string) => {
      asked.push(name);
      return dir;
    },
  } as unknown as FileSystemDirectoryHandle;
  return { root, files, writes, asked };
}

const meta = (id: string, name: string, size: number): PhotoMeta => ({ id, name, size, width: 10, height: 10, takenAt: null, lastModified: 0 });

/** An archive that holds these photos. `crcOf` can give a CRC that differs from the bytes. */
async function archiveOf(photos: [id: string, name: string, text: string][], crcOf = crc32OfBlob): Promise<OpenedArchive> {
  const originals = new Map(photos.map(([id, name, text]) => [id, new File([bytesOf(text)], name)]));
  const expectedCrc = new Map<string, number>();
  for (const [id, file] of originals) expectedCrc.set(id, await crcOf(file));
  const album: Album = { ...createAlbum('Весілля.'), photos: photos.map(([id, name, text]) => meta(id, name, bytesOf(text).length)) };
  return { album, originals, expectedCrc, verify: async () => {} };
}

test('writeToFolder writes each photo into the subfolder of the album', async () => {
  const folder = fakeFolder();
  const { album, files } = await writeToFolder(folder.root, await archiveOf([['p1', 'a.jpg', 'aaa'], ['p2', 'b.jpg', 'bb']]), noProgress);
  expect(folder.asked).toEqual(['album-Весілля']);
  expect(folder.writes).toEqual(['a.jpg', 'b.jpg']);
  expect(album.photos.map((p) => p.name)).toEqual(['a.jpg', 'b.jpg']);
  expect(await files.get('p2')!.text()).toBe('bb');
});

test('writeToFolder uses a file again when its name and the CRC of the directory agree', async () => {
  const folder = fakeFolder({ 'a.jpg': 'aaa' });
  const { album } = await writeToFolder(folder.root, await archiveOf([['p1', 'a.jpg', 'aaa']]), noProgress);
  expect(folder.writes).toEqual([]);
  expect(album.photos[0].name).toBe('a.jpg');
});

test('writeToFolder compares a file with the CRC of the directory, not with the bytes of the archive', async () => {
  const folder = fakeFolder({ 'a.jpg': 'aaa' });
  const opened = await archiveOf([['p1', 'a.jpg', 'aaa']], async () => 1);
  const { album } = await writeToFolder(folder.root, opened, noProgress);
  expect(folder.writes).toEqual(['a-2.jpg']);
  expect(album.photos[0].name).toBe('a-2.jpg');
});

test('writeToFolder reads no bytes of a file with another size', async () => {
  const folder = fakeFolder({ 'a.jpg': 'a much longer file' });
  const opened = await archiveOf([['p1', 'a.jpg', 'aaa']]);
  const entry = folder.files.get('a.jpg')!;
  const getFile = entry.getFile;
  let sliced = 0;
  entry.getFile = async () => {
    const file = await getFile();
    file.slice = () => {
      sliced++;
      return new Blob();
    };
    return file;
  };
  await writeToFolder(folder.root, opened, noProgress);
  expect(sliced).toBe(0);
  expect(folder.writes).toEqual(['a-2.jpg']);
});

test('writeToFolder keeps a file whose name differs only in case, and gives the photo a new name', async () => {
  const folder = fakeFolder({ 'A.JPG': 'other' });
  const { album } = await writeToFolder(folder.root, await archiveOf([['p1', 'a.jpg', 'aaa']]), noProgress);
  expect(folder.writes).toEqual(['a-2.jpg']);
  expect(album.photos[0].name).toBe('a-2.jpg');
  expect(await (await folder.files.get('A.JPG')!.getFile()).text()).toBe('other');
});

test('writeToFolder tries the next name when the file system refuses a name', async () => {
  const folder = fakeFolder({}, ['a.jpg', 'a-2.jpg']);
  const { album } = await writeToFolder(folder.root, await archiveOf([['p1', 'a.jpg', 'aaa']]), noProgress);
  expect(folder.writes).toEqual(['photo.jpg']);
  expect(album.photos[0].name).toBe('photo.jpg');
});

test('a candidate that one photo does not use stays free for a later photo', async () => {
  // The first photo gets its first candidate. Its candidate photo.jpg goes to the second photo.
  const folder = fakeFolder({}, ['a:b.jpg', 'c:d.jpg', 'c_d.jpg']);
  const { album } = await writeToFolder(folder.root, await archiveOf([['p1', 'a:b.jpg', 'aaa'], ['p2', 'c:d.jpg', 'bb']]), noProgress);
  expect(album.photos.map((p) => p.name)).toEqual(['a_b.jpg', 'photo.jpg']);
});

test('writeToFolder removes a file that it created when the write fails', async () => {
  const folder = fakeFolder();
  const opened = await archiveOf([['p1', 'a.jpg', 'aaa']]);
  const failure = new DOMException('No free space', 'QuotaExceededError');
  const slice = vi.spyOn(File.prototype, 'slice').mockImplementation(() => {
    throw failure;
  });
  await expect(writeToFolder(folder.root, opened, noProgress)).rejects.toBe(failure);
  slice.mockRestore();
  expect([...folder.files.keys()]).toEqual([]);
});

test('a refused name that decodes is named, and it is no storage failure', async () => {
  const decode = vi.fn(async () => ({ width: 100, height: 100, close() {} }));
  vi.stubGlobal('createImageBitmap', decode);
  const file = new File([bytesOf('an image')], 'pic.gif');
  expect(await makeScreenCopies(new Map([['p1', file]]), noProgress)).toEqual(['pic.gif']);
  expect(decode).not.toHaveBeenCalled();
});

test('a file that the browser cannot decode is named', async () => {
  vi.stubGlobal('createImageBitmap', async () => {
    throw new DOMException('bad', 'InvalidStateError');
  });
  const file = new File([bytesOf('not an image')], 'a.jpg');
  expect(await makeScreenCopies(new Map([['p1', file]]), noProgress)).toEqual(['a.jpg']);
});

test('a file that decodes and gets no screen copy is a storage failure', async () => {
  // The bitmap decodes, and with no canvas in this environment the screen copy fails.
  vi.stubGlobal('createImageBitmap', async () => ({ width: 100, height: 100, close() {} }));
  const file = new File([bytesOf('an image')], 'a.jpg');
  await expect(makeScreenCopies(new Map([['p1', file]]), noProgress)).rejects.toBeInstanceOf(ScreenCopyError);
});

const withCopies = async (...ids: string[]) => {
  for (const id of ids) {
    await putPreview(id, 'full', new Blob(['f']));
    await putPreview(id, 'thumb', new Blob(['t']));
  }
};

test('deleteStrayPreviews keeps the copies of a stored photo, and gives the ids that it deleted', async () => {
  await saveAlbum(addPhotos(createAlbum('held'), [meta('stray-held', 'h.jpg', 1)]));
  await withCopies('stray-held', 'stray-gone');
  expect(await deleteStrayPreviews(['stray-held', 'stray-gone'])).toEqual(['stray-gone']);
  expect(await hasPreviews(['stray-held', 'stray-gone'])).toEqual(new Set(['stray-held']));
});

test('deleteReplacedPreviews stores the new album first, so that a photo of the new album keeps its copies', async () => {
  const old = addPhotos(createAlbum('old'), [meta('replaced-kept', 'k.jpg', 1), meta('replaced-gone', 'g.jpg', 1)]);
  await saveAlbum(old);
  await withCopies('replaced-kept', 'replaced-gone');
  const next: Album = { ...old, photos: old.photos.filter((p) => p.id === 'replaced-kept') };
  expect(await deleteReplacedPreviews(next, old)).toEqual(['replaced-gone']);
  expect((await loadAlbum(old.id))?.photos.map((p) => p.id)).toEqual(['replaced-kept']);
  expect(await hasPreviews(['replaced-kept', 'replaced-gone'])).toEqual(new Set(['replaced-kept']));
});

test('deleteReplacedPreviews with no replaced album deletes nothing', async () => {
  expect(await deleteReplacedPreviews(createAlbum('new'), undefined)).toEqual([]);
});
