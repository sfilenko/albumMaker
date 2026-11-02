// The parts of an archive open that need no interface: the folder files, their name rules and the
// screen copies. The dialog keeps the picker and the order of the steps.
import { safeName } from '../export/export';
import type { Album, PhotoMeta } from '../model/types';
import { crc32OfBlob, freeName, isPlainName, nameKey, writeInSlices, type OpenedArchive } from '../storage/archive';
import { deletePreviews, saveAlbum, storedPhotoIds } from '../storage/db';
import { acceptedExtension, DECODE_LIMIT, describeFile, importFiles, isAccepted, mapLimit } from './import';

type Progress = (done: number, total: number) => void;

/** `importFiles` skipped a photo that the browser can decode: a storage failure, not a bad photo. */
export class ScreenCopyError extends Error {
  constructor() {
    super('The app cannot store a screen copy');
    this.name = 'ScreenCopyError';
  }
}

/** The subfolder of an album. A folder name cannot end with a dot or a space on Windows. */
export const subfolderName = (albumName: string) => `album-${safeName(albumName).replace(/[. ]+$/, '') || 'album'}`;

/**
 * The names to try for a photo whose own name cannot be used. `importFiles` accepts each of them.
 * `taken` does not change: the caller adds only the name that it keeps, so that a name it does not
 * keep stays free for a later photo.
 */
export function newNames(name: string, taken: Set<string>): string[] {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  const extension = acceptedExtension(name) ?? '.jpg';
  const names = isAccepted(clean) ? [clean, `photo${extension}`] : [`photo${extension}`];
  return names.map((n) => freeName(n, new Set(taken)));
}

/** Tries each name in turn, because a file system can refuse a name. The first failure is the one to show. */
async function createFile(dir: FileSystemDirectoryHandle, names: string[]): Promise<{ handle: FileSystemFileHandle; name: string }> {
  let first: unknown = null;
  for (const name of names) {
    try {
      return { handle: await dir.getFileHandle(name, { create: true }), name };
    } catch (e) {
      first ??= e;
    }
  }
  throw first;
}

/** The same exact name and the same CRC-32 mean that the file in the folder is this photo. */
async function isSameFile(entry: FileSystemHandle | undefined, name: string, size: number, crc: number): Promise<boolean> {
  if (entry?.kind !== 'file' || entry.name !== name) return false;
  const file = await (entry as FileSystemFileHandle).getFile();
  return file.size === size && (await crc32OfBlob(file)) === crc;
}

/**
 * Writes the originals into a new subfolder and never overwrites a file. A file that exists there
 * under the name of a photo, without regard to case, stays. The photo then gets a new name, and so
 * does a photo whose name the file system refuses. The result holds the album with these names and
 * the files of the folder.
 */
export async function writeToFolder(
  root: FileSystemDirectoryHandle,
  { album, originals, expectedCrc }: OpenedArchive,
  onProgress: Progress,
): Promise<{ album: Album; files: Map<string, File>; dir: FileSystemDirectoryHandle }> {
  const dir = await root.getDirectoryHandle(subfolderName(album.name), { create: true });
  const inFolder = new Map<string, FileSystemHandle>();
  for await (const entry of dir.values()) inFolder.set(nameKey(entry.name), entry);
  // Each name of the album stays reserved, so that a new name never takes the name of a later photo.
  const taken = new Set([...inFolder.keys(), ...album.photos.map((p) => nameKey(p.name))]);

  const total = album.photos.reduce((sum, p) => sum + originals.get(p.id)!.size, 0);
  let done = 0;
  onProgress(0, total);
  const files = new Map<string, File>();
  const photos: PhotoMeta[] = [];
  for (const photo of album.photos) {
    const original = originals.get(photo.id)!;
    const entry = inFolder.get(nameKey(photo.name));
    let handle: FileSystemFileHandle;
    let name = photo.name;
    if (await isSameFile(entry, photo.name, original.size, expectedCrc.get(photo.id)!)) {
      handle = entry as FileSystemFileHandle;
    } else {
      const own = !entry && isPlainName(photo.name) ? [photo.name] : [];
      ({ handle, name } = await createFile(dir, [...own, ...newNames(photo.name, taken)]));
      taken.add(nameKey(name));
      inFolder.set(nameKey(name), handle);
      try {
        await writeInSlices(handle, original, (n) => onProgress(done + n, total));
      } catch (e) {
        // This run created the file. A file that stays with no content would block the next try.
        try {
          await dir.removeEntry(name);
        } catch {
          // The first failure is the one to show.
        }
        throw e;
      }
    }
    done += original.size;
    onProgress(done, total);
    files.set(photo.id, await handle.getFile());
    photos.push({ ...photo, name });
  }
  return { album: { ...album, photos }, files, dir };
}

/**
 * Makes the screen copies, and returns the names of the photos with no screen copy: a name that the
 * app refuses, and a file that the browser cannot decode. Throws ScreenCopyError when a screen copy
 * of a good photo cannot be stored.
 */
export async function makeScreenCopies(files: Map<string, File>, onProgress: Progress): Promise<string[]> {
  const list = [...files.values()];
  const ids = new Map([...files].map(([id, file]) => [file, id] as const));
  const { skipped } = await importFiles(list, onProgress, ids);
  const left = list.filter((f) => skipped.includes(f.name));
  // A refused name can decode, so a read of its pixels says nothing about it.
  const refused = left.filter((f) => !isAccepted(f.name));
  // An accepted file has two causes: a photo that cannot be decoded, and a failed write of a screen copy.
  const described = await mapLimit(left.filter((f) => isAccepted(f.name)), DECODE_LIMIT, (f) => describeFile(f));
  if (described.some((c) => c.width !== 0)) throw new ScreenCopyError();
  return [...new Set([...refused, ...described].map((f) => f.name))];
}

/** Deletes the screen copies of the photos that no stored album holds, and returns their ids. */
async function deleteUnheldPreviews(ids: string[]): Promise<string[]> {
  const held = await storedPhotoIds();
  const stray = ids.filter((id) => !held.has(id));
  await deletePreviews(stray);
  return stray;
}

/**
 * Screen copies of a replaced album. The stored album changes first, so that no stored album loses a
 * copy. Returns the ids of the deleted copies.
 */
export async function deleteReplacedPreviews(album: Album, replaced: Album | undefined): Promise<string[]> {
  if (!replaced) return [];
  try {
    await saveAlbum(album);
    return await deleteUnheldPreviews(replaced.photos.map((p) => p.id));
  } catch {
    // A copy that stays only takes space. The autosaver shows a failed save of the album.
    return [];
  }
}

/** The screen copies of a failed open. A photo that a stored album holds keeps its copies. Returns the ids of the deleted copies. */
export async function deleteStrayPreviews(ids: string[]): Promise<string[]> {
  try {
    return await deleteUnheldPreviews(ids);
  } catch {
    // A copy that stays only takes space. The error of the open is the one to show.
    return [];
  }
}
