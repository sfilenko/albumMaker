// Book page mapping and print warnings. The cover is never a printed page.
import { effectiveDpi, LOW_DPI } from './crop';
import { cellRects } from './layout';
import type { Album, CellRef, Rect } from './types';
import { FOLD_X } from './units';

export type Side = 'left' | 'right';

export const MIN_PAGES = 24;

export function printedPages(a: Album): { page: number; spreadId: string; side: Side }[] {
  const spreads = a.spreads.filter((s) => !s.isCover);
  const out: { page: number; spreadId: string; side: Side }[] = [];
  spreads.forEach((s, i) => {
    const first = i === 0;
    const last = i === spreads.length - 1;
    for (const side of ['left', 'right'] as const) {
      if (a.settings.bookStart === 'single-right') {
        if (first && side === 'left') continue;
        if (last && side === 'right') continue;
      }
      out.push({ page: out.length + 1, spreadId: s.id, side });
    }
  });
  return out;
}

export function sideIsPrinted(a: Album, spreadId: string, side: Side): boolean {
  return printedPages(a).some((p) => p.spreadId === spreadId && p.side === side);
}

/** The pages that a cell rectangle (canvas coordinates) touches. */
export function cellSides(rect: Rect, bleedMm: number): Side[] {
  const fold = bleedMm + FOLD_X;
  const sides: Side[] = [];
  if (rect.x < fold) sides.push('left');
  if (rect.x + rect.w > fold) sides.push('right');
  return sides;
}

export type PrintWarning =
  | { kind: 'min-pages'; pages: number }
  | { kind: 'low-dpi'; ref: CellRef; dpi: number }
  | { kind: 'empty-cell'; ref: CellRef }
  | { kind: 'unprinted-photo'; ref: CellRef }
  | { kind: 'missing-photo'; photoId: string };

/**
 * `available` holds the photo ids whose screen copy or original is present. A cell on a half
 * that is not printed gives no `low-dpi` and no `empty-cell` warning: it does not print.
 */
export function printWarnings(a: Album, available: Set<string>): PrintWarning[] {
  const out: PrintWarning[] = [];
  const pages = printedPages(a).length;
  if (pages < MIN_PAGES) out.push({ kind: 'min-pages', pages });

  const metas = new Map(a.photos.map((p) => [p.id, p]));
  const missing = new Set<string>();
  for (const s of a.spreads) {
    if (s.isCover) continue;
    const rects = cellRects(s.layout, a.settings);
    s.cells.forEach((cell, cellIndex) => {
      const ref: CellRef = { spreadId: s.id, cellIndex };
      const printed = cellSides(rects[cellIndex], a.settings.bleedMm).some((side) => sideIsPrinted(a, s.id, side));
      if (cell.photoId === null) {
        if (printed) out.push({ kind: 'empty-cell', ref });
        return;
      }
      if (!printed) out.push({ kind: 'unprinted-photo', ref });
      const meta = metas.get(cell.photoId);
      if (!meta || !available.has(cell.photoId)) missing.add(cell.photoId);
      if (meta && printed) {
        const dpi = effectiveDpi(meta.width, meta.height, rects[cellIndex], cell.crop);
        if (dpi < LOW_DPI) out.push({ kind: 'low-dpi', ref, dpi });
      }
    });
  }
  for (const photoId of missing) out.push({ kind: 'missing-photo', photoId });
  return out;
}
