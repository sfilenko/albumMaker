// Photo import: oriented size, capture date and two screen copies per photo.
// The originals stay on disk; only the screen copies go into IndexedDB.
import exifr from 'exifr';
import { newId } from '../model/album';
import type { PhotoMeta } from '../model/types';
import { putPreview, type PreviewKind } from '../storage/db';
import type { Candidate } from './match';

const ACCEPTED = /\.(jpe?g|png|webp)$/i;
export const DECODE_LIMIT = 2;
const PREVIEW_EDGE: Record<PreviewKind, number> = { full: 1600, thumb: 320 };
const PREVIEW_QUALITY = 0.85;

export function isAccepted(name: string): boolean {
  return ACCEPTED.test(name);
}

/** Runs `fn` over `items` with at most `limit` calls in progress, and keeps the input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// The directory picker is not in every browser, nor in the DOM typings.
type DirPickerWindow = Window & { showDirectoryPicker?: (o: { mode: 'read' }) => Promise<FileSystemDirectoryHandle> };

/** The top-level files of a folder, or null when the browser has no folder picker or the user cancels. */
export async function pickFolder(): Promise<{ dir: FileSystemDirectoryHandle; files: File[] } | null> {
  const picker = (window as DirPickerWindow).showDirectoryPicker;
  if (!picker) return null;
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await picker({ mode: 'read' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
  const files: File[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') files.push(await (entry as FileSystemFileHandle).getFile());
  }
  return { dir, files };
}

/** Files that the user chooses. An empty list when the user cancels. */
export function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

/** EXIF DateTimeOriginal as a local ISO time without a zone, for example 2026-06-14T15:30:00. */
async function readTakenAt(file: File): Promise<string | null> {
  try {
    const tags = await exifr.parse(file, { pick: ['DateTimeOriginal'], reviveValues: false });
    const raw: unknown = tags?.DateTimeOriginal;
    if (typeof raw !== 'string') return null;
    const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw);
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
  } catch {
    return null;
  }
}

/**
 * The name, size, upright pixel size and capture date of a chosen file, for matching. The date
 * comes from the same reader as import, so the ladder compares dates in one form. A file that
 * the browser cannot decode gets 0×0.
 */
export async function describeFile(file: File): Promise<Candidate> {
  const takenAt = await readTakenAt(file);
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const c = { name: file.name, size: file.size, width: bitmap.width, height: bitmap.height, takenAt };
    bitmap.close();
    return c;
  } catch {
    return { name: file.name, size: file.size, width: 0, height: 0, takenAt };
  }
}

async function scaledJpeg(bitmap: ImageBitmap, longEdge: number): Promise<Blob> {
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: PREVIEW_QUALITY });
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', PREVIEW_QUALITY),
  );
}

/**
 * Imports the accepted files, at most two decoded at the same time. A file that is not
 * accepted, or that the browser cannot decode, goes into `skipped` by name. When `ids` maps
 * a file to an existing photo id, the photo keeps that id.
 */
export async function importFiles(
  files: File[],
  onProgress: (done: number, total: number) => void,
  ids?: Map<File, string>,
): Promise<{ metas: PhotoMeta[]; skipped: string[] }> {
  const accepted = files.filter((f) => isAccepted(f.name));
  const skipped = files.filter((f) => !isAccepted(f.name)).map((f) => f.name);
  let done = 0;
  onProgress(0, accepted.length);

  const results = await mapLimit(accepted, DECODE_LIMIT, async (file): Promise<PhotoMeta | null> => {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const id = ids?.get(file) ?? newId();
      const meta: PhotoMeta = {
        id,
        name: file.name,
        size: file.size,
        width: bitmap.width,
        height: bitmap.height,
        takenAt: await readTakenAt(file),
        lastModified: file.lastModified,
      };
      for (const kind of ['full', 'thumb'] as const) {
        await putPreview(id, kind, await scaledJpeg(bitmap, PREVIEW_EDGE[kind]));
      }
      return meta;
    } catch {
      skipped.push(file.name);
      return null;
    } finally {
      bitmap?.close();
      onProgress(++done, accepted.length);
    }
  });

  return { metas: results.filter((m): m is PhotoMeta => m !== null), skipped };
}
