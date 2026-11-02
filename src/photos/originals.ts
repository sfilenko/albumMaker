// Access to the original photo files, which the print export and the album archive need.
import type { PhotoMeta } from '../model/types';
import { getDirHandle } from '../storage/db';
import { DECODE_LIMIT, describeFile, mapLimit } from './import';
import { matchPhotos } from './match';

export class MissingOriginalsError extends Error {
  constructor(readonly photoIds: string[]) {
    super(`Original files are missing for ${photoIds.length} photo(s)`);
    this.name = 'MissingOriginalsError';
  }
}

// The permission members of the File System Access API, not in the DOM typings.
interface ReadableDir extends FileSystemDirectoryHandle {
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' }): Promise<PermissionState>;
}

// Photo id → original file, for this session only.
const memory = new Map<string, File>();

export function registerOriginals(files: Map<string, File>): void {
  for (const [id, file] of files) memory.set(id, file);
}

/** Removes the stored file of a photo from the memory of this session. */
export function forgetOriginal(photoId: string): void {
  memory.delete(photoId);
}

async function canRead(dir: ReadableDir): Promise<boolean> {
  if ((await dir.queryPermission?.({ mode: 'read' })) === 'granted') return true;
  try {
    return (await dir.requestPermission?.({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}

/**
 * The original from this session, else from the album's stored folder, matched by name and size.
 * A folder that the person moved or removed gives `null`, so the person gets the normal request.
 */
async function getOriginal(albumId: string, meta: PhotoMeta): Promise<File | null> {
  const known = memory.get(meta.id);
  if (known) return known;
  const dir = (await getDirHandle(albumId)) as ReadableDir | undefined;
  if (!dir) return null;
  try {
    if (!(await canRead(dir))) return null;
    for await (const entry of dir.values()) {
      if (entry.kind !== 'file' || entry.name !== meta.name) continue;
      const file = await (entry as FileSystemFileHandle).getFile();
      if (file.size === meta.size) {
        memory.set(meta.id, file);
        return file;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** True when the file has the name and the size of the photo. Another file can differ from the first import. */
export function isExactOriginal(file: File, meta: PhotoMeta): boolean {
  return file.name === meta.name && file.size === meta.size;
}

/** Returns an original for each photo, or throws MissingOriginalsError. */
export async function readOriginals(albumId: string, photos: PhotoMeta[]): Promise<Map<string, File>> {
  const files = new Map<string, File>();
  const missing: string[] = [];
  for (const meta of photos) {
    const file = await getOriginal(albumId, meta);
    if (file) files.set(meta.id, file);
    else missing.push(meta.id);
  }
  if (missing.length > 0) throw new MissingOriginalsError(missing);
  return files;
}

export interface ChosenOriginals {
  /** The photos that still have no file. */
  left: PhotoMeta[];
  /** Names of photos in `left` with no single candidate. */
  ambiguous: string[];
  /** Names of photos in `left` with no candidate, when no other photo of this name got a file in this round. */
  unmatched: string[];
  /** Names of photos in `left` with no candidate, when another photo of this name got a file in this round. */
  sameName: string[];
  /** The photos whose registered file has another name or another size. */
  inexact: PhotoMeta[];
}

const namesOf = (photos: PhotoMeta[]) => [...new Set(photos.map((p) => p.name))];

/**
 * Matches the chosen files and registers each match. Two photos with one name and one size are one
 * file that the person added twice, so one chosen file goes to all these photos. `onDescribed` gets
 * the count of files that the function read until now.
 */
export async function registerChosenOriginals(
  wanted: PhotoMeta[],
  files: File[],
  onDescribed?: (done: number, total: number) => void,
): Promise<ChosenOriginals> {
  const sameFile = new Map<string, PhotoMeta[]>();
  for (const p of wanted) {
    const key = `${p.size}/${p.name}`;
    sameFile.set(key, [...(sameFile.get(key) ?? []), p]);
  }
  const groups = [...sameFile.values()];
  let described = 0;
  // At most DECODE_LIMIT originals decode at the same time, as on import.
  const candidates = await mapLimit(files, DECODE_LIMIT, async (f) => {
    const c = await describeFile(f);
    onDescribed?.(++described, files.length);
    return c;
  });
  const { matched, ambiguous } = matchPhotos(groups.map((g) => g[0]), candidates);

  const found = new Map<string, File>();
  for (const group of groups) {
    const index = matched.get(group[0].id);
    if (index !== undefined) for (const p of group) found.set(p.id, files[index]);
  }
  registerOriginals(found);

  const noSingleCandidate = new Set(groups.filter((g) => ambiguous.includes(g[0].id)).flat().map((p) => p.id));
  const namesWithFile = new Set(wanted.filter((p) => found.has(p.id)).map((p) => p.name));
  const left = wanted.filter((p) => !found.has(p.id));
  const noCandidate = left.filter((p) => !noSingleCandidate.has(p.id));
  return {
    left,
    ambiguous: namesOf(left.filter((p) => noSingleCandidate.has(p.id))),
    unmatched: namesOf(noCandidate.filter((p) => !namesWithFile.has(p.name))),
    sameName: namesOf(noCandidate.filter((p) => namesWithFile.has(p.name))),
    inexact: wanted.filter((p) => {
      const file = found.get(p.id);
      return file !== undefined && !isExactOriginal(file, p);
    }),
  };
}
