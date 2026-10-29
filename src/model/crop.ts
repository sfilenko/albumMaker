// Cover crop: a photo always fills its cell, so the visible area has the cell's aspect ratio.
import type { Crop, Rect } from './types';

export const LOW_DPI = 200;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const MM_PER_INCH = 25.4;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Size of the visible area in photo pixels. */
function visibleSize(photoW: number, photoH: number, cell: Rect, zoom: number): { sw: number; sh: number } {
  const a = cell.w / cell.h;
  const sw = Math.min(photoW, photoH * a) / zoom;
  return { sw, sh: sw / a };
}

/** The part of the photo that the cell shows, in photo pixels, kept inside the photo. */
export function sourceRect(
  photoW: number,
  photoH: number,
  cell: Rect,
  crop: Crop,
): { sx: number; sy: number; sw: number; sh: number } {
  const { sw, sh } = visibleSize(photoW, photoH, cell, clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM));
  const sx = clamp(crop.cx * photoW - sw / 2, 0, photoW - sw);
  const sy = clamp(crop.cy * photoH - sh / 2, 0, photoH - sh);
  return { sx, sy, sw, sh };
}

/** Keeps zoom in 1..8 and moves the centre so that the visible area needs no shift. */
export function clampCrop(photoW: number, photoH: number, cell: Rect, crop: Crop): Crop {
  const zoom = clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM);
  const { sw, sh } = visibleSize(photoW, photoH, cell, zoom);
  const hx = sw / 2 / photoW;
  const hy = sh / 2 / photoH;
  return { cx: clamp(crop.cx, hx, 1 - hx), cy: clamp(crop.cy, hy, 1 - hy), zoom };
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
  const { sw, sh } = visibleSize(photoW, photoH, cell, clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM));
  const cx = crop.cx - (dxMm * (sw / cell.w)) / photoW;
  const cy = crop.cy - (dyMm * (sh / cell.h)) / photoH;
  return clampCrop(photoW, photoH, cell, { ...crop, cx, cy });
}

export function zoomCrop(photoW: number, photoH: number, cell: Rect, crop: Crop, zoom: number): Crop {
  return clampCrop(photoW, photoH, cell, { ...crop, zoom });
}

/** Photo pixels per inch of the printed cell. */
export function effectiveDpi(photoW: number, photoH: number, cell: Rect, crop: Crop): number {
  const { sw } = sourceRect(photoW, photoH, cell, crop);
  return sw / (cell.w / MM_PER_INCH);
}
