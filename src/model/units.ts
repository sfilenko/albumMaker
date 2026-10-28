// All album geometry is in millimetres; pixels appear only at export time.
export const DPI = 300;
export const PX_PER_MM = DPI / 25.4;

export const TRIM_W = 600;
export const TRIM_H = 300;
export const PAGE_W = 300;
export const FOLD_X = 300;

export function mmToPx(mm: number): number {
  return Math.round(mm * PX_PER_MM);
}

export function canvasSizeMm(bleedMm: number): { w: number; h: number } {
  return { w: TRIM_W + 2 * bleedMm, h: TRIM_H + 2 * bleedMm };
}
