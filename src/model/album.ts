// Pure album operations. Each one returns a new Album with a new updatedAt,
// or the same Album when nothing changes.
import { moveGutter } from './layout';
import { cellCount, templateLayout } from './templates';
import type { Album, AlbumSettings, Cell, CellRef, Crop, GutterRef, PhotoMeta, Spread, TemplateId } from './types';
import { DEFAULT_SETTINGS, EMPTY_CROP } from './types';

const SPREADS_IN_NEW_ALBUM = 15;

export function newId(): string {
  return crypto.randomUUID();
}

const emptyCell = (): Cell => ({ photoId: null, crop: { ...EMPTY_CROP } });

function newSpread(templateId: TemplateId, isCover = false): Spread {
  const layout = templateLayout(templateId);
  return { id: newId(), templateId, layout, cells: Array.from({ length: cellCount(layout) }, emptyCell), isCover };
}

function touch(a: Album, patch: Partial<Album>): Album {
  return { ...a, ...patch, updatedAt: Date.now() };
}

function mapSpread(a: Album, spreadId: string, fn: (s: Spread) => Spread): Album {
  if (!a.spreads.some((s) => s.id === spreadId)) return a;
  return touch(a, { spreads: a.spreads.map((s) => (s.id === spreadId ? fn(s) : s)) });
}

function getCell(a: Album, ref: CellRef): Cell | undefined {
  return a.spreads.find((s) => s.id === ref.spreadId)?.cells[ref.cellIndex];
}

function setCell(a: Album, ref: CellRef, cell: Cell): Album {
  if (!getCell(a, ref)) return a;
  return mapSpread(a, ref.spreadId, (s) => ({
    ...s,
    cells: s.cells.map((c, i) => (i === ref.cellIndex ? cell : c)),
  }));
}

export function createAlbum(name: string, id?: string): Album {
  const now = Date.now();
  return {
    id: id ?? newId(),
    name,
    createdAt: now,
    updatedAt: now,
    lastFileSaveAt: null,
    settings: { ...DEFAULT_SETTINGS },
    photos: [],
    spreads: [newSpread('full', true), ...Array.from({ length: SPREADS_IN_NEW_ALBUM }, () => newSpread('full'))],
  };
}

const byName = (x: PhotoMeta, y: PhotoMeta) => x.name.localeCompare(y.name, undefined, { numeric: true });

export function addPhotos(a: Album, metas: PhotoMeta[]): Album {
  const known = new Set(a.photos.map((p) => p.id));
  const fresh = metas.filter((m) => !known.has(m.id));
  if (fresh.length === 0) return a;
  return touch(a, { photos: [...a.photos, ...fresh].sort(byName) });
}

/** Removes the photo from the album and empties every cell that shows it. */
export function removePhoto(a: Album, photoId: string): Album {
  if (!a.photos.some((p) => p.id === photoId)) return a;
  return touch(a, {
    photos: a.photos.filter((p) => p.id !== photoId),
    spreads: a.spreads.map((s) => ({
      ...s,
      cells: s.cells.map((c) => (c.photoId === photoId ? emptyCell() : c)),
    })),
  });
}

/** A photo may be in several cells. */
export function placePhoto(a: Album, ref: CellRef, photoId: string): Album {
  return setCell(a, ref, { photoId, crop: { ...EMPTY_CROP } });
}

/** Swaps the photos and crops of two cells, on one spread or across spreads. */
export function swapCells(a: Album, from: CellRef, to: CellRef): Album {
  const x = getCell(a, from);
  const y = getCell(a, to);
  if (!x || !y) return a;
  return setCell(setCell(a, from, y), to, x);
}

export function clearCell(a: Album, ref: CellRef): Album {
  return setCell(a, ref, emptyCell());
}

export function setCrop(a: Album, ref: CellRef, crop: Crop): Album {
  const cell = getCell(a, ref);
  if (!cell) return a;
  return setCell(a, ref, { ...cell, crop });
}

/**
 * Changes the spread to a template. The photos of the spread fill the new cells in their
 * previous order. Photos that do not fit leave the spread but stay in `photos`.
 */
export function applyTemplate(a: Album, spreadId: string, templateId: TemplateId): Album {
  return mapSpread(a, spreadId, (s) => {
    const layout = templateLayout(templateId);
    const used = s.cells.flatMap((c) => (c.photoId === null ? [] : [c.photoId]));
    const cells = Array.from({ length: cellCount(layout) }, (_, i): Cell =>
      i < used.length ? { photoId: used[i], crop: { ...EMPTY_CROP } } : emptyCell(),
    );
    return { ...s, templateId, layout, cells };
  });
}

export function moveGutterOp(a: Album, spreadId: string, ref: GutterRef, deltaMm: number): Album {
  return mapSpread(a, spreadId, (s) => ({ ...s, layout: moveGutter(s.layout, ref, deltaMm, a.settings) }));
}

/** Adds a spread on template full after the spread at `afterIndex`. */
export function addSpread(a: Album, afterIndex: number): Album {
  const at = Math.min(Math.max(afterIndex + 1, 1), a.spreads.length);
  const spreads = [...a.spreads];
  spreads.splice(at, 0, newSpread('full'));
  return touch(a, { spreads });
}

/** The cover cannot be removed. */
export function removeSpread(a: Album, spreadId: string): Album {
  const s = a.spreads.find((x) => x.id === spreadId);
  if (!s || s.isCover) return a;
  return touch(a, { spreads: a.spreads.filter((x) => x.id !== spreadId) });
}

/** The cover stays at index 0: `from` 0 is refused and `to` clamps to 1 or more. */
export function moveSpread(a: Album, from: number, to: number): Album {
  const last = a.spreads.length - 1;
  if (from < 1 || from > last) return a;
  const target = Math.min(Math.max(to, 1), last);
  if (target === from) return a;
  const spreads = [...a.spreads];
  const [moved] = spreads.splice(from, 1);
  spreads.splice(target, 0, moved);
  return touch(a, { spreads });
}

export function renameAlbum(a: Album, name: string): Album {
  return touch(a, { name });
}

/** A setting applies to every spread; no setting removes a photo from a cell. */
export function updateSettings(a: Album, patch: Partial<AlbumSettings>): Album {
  return touch(a, { settings: { ...a.settings, ...patch } });
}

/** The number of cells that show each photo. */
export function photoUsage(a: Album): Map<string, number> {
  const usage = new Map<string, number>();
  for (const s of a.spreads) {
    for (const c of s.cells) {
      if (c.photoId !== null) usage.set(c.photoId, (usage.get(c.photoId) ?? 0) + 1);
    }
  }
  return usage;
}
