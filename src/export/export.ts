// The print export: which files, then writing them into a chosen folder or one ZIP.
import { Zip, ZipPassThrough } from 'fflate';
import { printedPages } from '../model/pages';
import type { Album, Rect } from '../model/types';
import { canvasSizeMm, mmToPx, PAGE_W } from '../model/units';
import { getOriginal } from '../photos/originals';
import { renderRegion } from './render';

export interface ExportJob { file: string; spreadId: string; regionMm: Rect; px: { w: number; h: number } }

export type ExportKind = 'spreads' | 'pages';

export class MissingOriginalsError extends Error {
  constructor(readonly photoIds: string[]) {
    super(`Original files are missing for ${photoIds.length} photo(s)`);
    this.name = 'MissingOriginalsError';
  }
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const pxOf = (r: Rect) => ({ w: mmToPx(r.w), h: mmToPx(r.h) });

export const jobKind = (job: ExportJob): ExportKind => (job.file.startsWith('spreads/') ? 'spreads' : 'pages');

/** Every non-cover spread as a whole canvas, then every printed page in book order. */
export function exportPlan(a: Album): ExportJob[] {
  const b = a.settings.bleedMm;
  const canvas = canvasSizeMm(b);
  const jobs: ExportJob[] = [];

  a.spreads
    .filter((s) => !s.isCover)
    .forEach((s, i) => {
      const regionMm = { x: 0, y: 0, w: canvas.w, h: canvas.h };
      jobs.push({ file: `spreads/spread-${pad(i + 1, 2)}.jpg`, spreadId: s.id, regionMm, px: pxOf(regionMm) });
    });

  for (const p of printedPages(a)) {
    // With bleed, the fold-side bleed of a page is the neighbouring page's image.
    const regionMm =
      a.settings.pageExport === 'bleed'
        ? { x: p.side === 'left' ? 0 : PAGE_W, y: 0, w: PAGE_W + 2 * b, h: PAGE_W + 2 * b }
        : { x: (p.side === 'left' ? 0 : PAGE_W) + b, y: b, w: PAGE_W, h: PAGE_W };
    jobs.push({ file: `pages/page-${pad(p.page, 3)}.jpg`, spreadId: p.spreadId, regionMm, px: pxOf(regionMm) });
  }
  return jobs;
}

interface Sink { write(path: string, blob: Blob): Promise<void>; close(): Promise<void> }

interface WritableDirWindow {
  showDirectoryPicker?: (o: { mode: 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'album';

async function folderSink(root: FileSystemDirectoryHandle, albumName: string): Promise<Sink> {
  const top = await root.getDirectoryHandle(`export-${safeName(albumName)}`, { create: true });
  return {
    async write(path, blob) {
      const [dir, name] = path.split('/');
      const sub = await top.getDirectoryHandle(dir, { create: true });
      const writable = await (await sub.getFileHandle(name, { create: true })).createWritable();
      await writable.write(blob);
      await writable.close();
    },
    async close() {},
  };
}

function zipSink(albumName: string): Sink {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let done!: () => void;
  let failed!: (e: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    done = resolve;
    failed = reject;
  });
  const zip = new Zip((err, chunk, final) => {
    if (err) return failed(err);
    chunks.push(chunk as Uint8Array<ArrayBuffer>);
    if (final) done();
  });
  return {
    async write(path, blob) {
      // JPEG data does not compress, so the files are stored as they are.
      const entry = new ZipPassThrough(path);
      zip.add(entry);
      entry.push(new Uint8Array(await blob.arrayBuffer()), true);
    },
    async close() {
      zip.end();
      await finished;
      const url = URL.createObjectURL(new Blob(chunks, { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `export-${safeName(albumName)}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  };
}

/**
 * Renders the jobs of the chosen kinds one at a time. Throws `MissingOriginalsError` before it
 * writes anything when an original of a used photo cannot be read. A folder picker that the
 * user cancels rejects with an `AbortError`.
 */
export async function runExport(
  a: Album,
  onProgress: (done: number, total: number) => void,
  kinds: ExportKind[] = ['spreads', 'pages'],
): Promise<void> {
  const jobs = exportPlan(a).filter((j) => kinds.includes(jobKind(j)));
  const spreadIds = new Set(jobs.map((j) => j.spreadId));
  const used = new Set(
    a.spreads.filter((s) => spreadIds.has(s.id)).flatMap((s) => s.cells.flatMap((c) => (c.photoId ? [c.photoId] : []))),
  );

  const files = new Map<string, File>();
  const missing: string[] = [];
  for (const meta of a.photos.filter((p) => used.has(p.id))) {
    const file = await getOriginal(a.id, meta);
    if (file) files.set(meta.id, file);
    else missing.push(meta.id);
  }
  if (missing.length > 0) throw new MissingOriginalsError(missing);

  const picker = (window as WritableDirWindow).showDirectoryPicker;
  const sink = picker ? await folderSink(await picker({ mode: 'readwrite' }), a.name) : zipSink(a.name);

  onProgress(0, jobs.length);
  for (const [i, job] of jobs.entries()) {
    const spread = a.spreads.find((s) => s.id === job.spreadId)!;
    const blob = await renderRegion(a, spread, job.regionMm, job.px, (meta) =>
      createImageBitmap(files.get(meta.id)!, { imageOrientation: 'from-image' }),
    );
    await sink.write(job.file, blob);
    onProgress(i + 1, jobs.length);
  }
  await sink.close();
}
