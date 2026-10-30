// Crop geometry. Zoom 1 is the cover fit: the photo exactly covers its cell. Under zoom 1 the
// photo is smaller than the cell on one or both axes, and the album background shows there.
import type { Crop, Rect } from './types';

export const LOW_DPI = 200;
const MAX_ZOOM = 8;
const MM_PER_INCH = 25.4;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Size of the cell in photo pixels. Under zoom 1 it is larger than the photo on one or both axes. */
function visibleSize(photoW: number, photoH: number, cell: Rect, zoom: number): { sw: number; sh: number } {
  const a = cell.w / cell.h;
  const sw = Math.min(photoW, photoH * a) / zoom;
  return { sw, sh: sw / a };
}

/** The allowed zoom for this photo in this cell. min is half of the "whole photo" zoom; max is 8. */
export function zoomLimits(photoW: number, photoH: number, cell: Rect): { min: number; max: number } {
  const a = cell.w / cell.h;
  // At this zoom the whole photo shows, and it touches two opposite sides of the cell.
  const whole = Math.min(photoW, photoH * a) / Math.max(photoW, photoH * a);
  return { min: whole / 2, max: MAX_ZOOM };
}

/**
 * Keeps a centre so that the cell shows only the photo where the photo is larger than the cell,
 * and the whole photo where the photo is smaller. `half` is half of the cell in photo units.
 */
const clampCentre = (c: number, half: number) => (half <= 0.5 ? clamp(c, half, 1 - half) : clamp(c, 1 - half, half));

/** Keeps the zoom in its limits and moves the centre so that the photo needs no shift. */
export function clampCrop(photoW: number, photoH: number, cell: Rect, crop: Crop): Crop {
  const { min, max } = zoomLimits(photoW, photoH, cell);
  const zoom = clamp(crop.zoom, min, max);
  const { sw, sh } = visibleSize(photoW, photoH, cell, zoom);
  return { cx: clampCentre(crop.cx, sw / 2 / photoW), cy: clampCentre(crop.cy, sh / 2 / photoH), zoom };
}

/** The cell as a window on the photo, in photo pixels, and the millimetres per photo pixel. */
function cellWindow(photoW: number, photoH: number, cell: Rect, crop: Crop) {
  const c = clampCrop(photoW, photoH, cell, crop);
  const { sw, sh } = visibleSize(photoW, photoH, cell, c.zoom);
  return { vx: c.cx * photoW - sw / 2, vy: c.cy * photoH - sh / 2, sw, sh, mmPerPx: cell.w / sw };
}

/**
 * The part of the photo that shows, and where it lands. `src` is in photo pixels, always inside
 * the photo. `dst` is in millimetres from the top-left corner of the cell, always inside the cell.
 */
export function visiblePart(
  photoW: number,
  photoH: number,
  cell: Rect,
  crop: Crop,
): { src: { sx: number; sy: number; sw: number; sh: number }; dst: Rect } {
  const { vx, vy, sw, sh, mmPerPx } = cellWindow(photoW, photoH, cell, crop);
  const sx = Math.max(vx, 0);
  const sy = Math.max(vy, 0);
  const src = { sx, sy, sw: Math.min(vx + sw, photoW) - sx, sh: Math.min(vy + sh, photoH) - sy };
  const dst = { x: (sx - vx) * mmPerPx, y: (sy - vy) * mmPerPx, w: src.sw * mmPerPx, h: src.sh * mmPerPx };
  return { src, dst };
}

/** The rectangle of the whole photo, in millimetres from the top-left corner of the cell. It can extend past the cell. */
export function photoBox(photoW: number, photoH: number, cell: Rect, crop: Crop): Rect {
  const { vx, vy, mmPerPx } = cellWindow(photoW, photoH, cell, crop);
  return { x: -vx * mmPerPx, y: -vy * mmPerPx, w: photoW * mmPerPx, h: photoH * mmPerPx };
}

/** Dragging the picture right by `dxMm` (cell millimetres) moves the visible area left. */
export function panCrop(
  photoW: number,
  photoH: number,
  cell: Rect,
  crop: Crop,
  dxMm: number,
  dyMm: number,
): Crop {
  const c = clampCrop(photoW, photoH, cell, crop);
  const { sw, sh } = visibleSize(photoW, photoH, cell, c.zoom);
  const cx = c.cx - (dxMm * (sw / cell.w)) / photoW;
  const cy = c.cy - (dyMm * (sh / cell.h)) / photoH;
  return clampCrop(photoW, photoH, cell, { ...c, cx, cy });
}

export function zoomCrop(photoW: number, photoH: number, cell: Rect, crop: Crop, zoom: number): Crop {
  return clampCrop(photoW, photoH, cell, { ...crop, zoom });
}

/** Photo pixels per inch of the printed photo. */
export function effectiveDpi(photoW: number, photoH: number, cell: Rect, crop: Crop): number {
  const { src, dst } = visiblePart(photoW, photoH, cell, crop);
  return src.sw / (dst.w / MM_PER_INCH);
}
