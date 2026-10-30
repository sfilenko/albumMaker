// Draws one region of a spread at print size: background, then each photo clipped to its cell.
import { visiblePart } from '../model/crop';
import { cellRects } from '../model/layout';
import type { Album, PhotoMeta, Rect, Spread } from '../model/types';
import { setJpegDpi } from './jpeg';

const QUALITY = 0.95;
const PRINT_DPI = 300;

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { ctx: Canvas2D; toJpeg: () => Promise<Blob> } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    return { ctx: canvas.getContext('2d')!, toJpeg: () => canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY }) };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return {
    ctx: canvas.getContext('2d')!,
    toJpeg: () =>
      new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', QUALITY),
      ),
  };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** `load` gives an upright bitmap of the original. Each bitmap is closed after use. */
export async function renderRegion(
  a: Album,
  spread: Spread,
  regionMm: Rect,
  px: { w: number; h: number },
  load: (meta: PhotoMeta) => Promise<ImageBitmap>,
): Promise<Blob> {
  const { ctx, toJpeg } = makeCanvas(px.w, px.h);
  const kx = px.w / regionMm.w;
  const ky = px.h / regionMm.h;
  ctx.fillStyle = a.settings.background;
  ctx.fillRect(0, 0, px.w, px.h);
  ctx.imageSmoothingQuality = 'high';

  const metas = new Map(a.photos.map((p) => [p.id, p]));
  const rects = cellRects(spread.layout, a.settings);
  for (const [i, cell] of spread.cells.entries()) {
    const meta = cell.photoId ? metas.get(cell.photoId) : undefined;
    const r = rects[i];
    if (!meta || !r || !overlaps(r, regionMm)) continue;
    const bitmap = await load(meta);
    try {
      // The crop is in the photo's recorded pixels; an original of another size scales with it.
      const s = bitmap.width / meta.width;
      const { src, dst } = visiblePart(meta.width, meta.height, r, cell.crop);
      const dx = (r.x - regionMm.x) * kx;
      const dy = (r.y - regionMm.y) * ky;
      const dw = r.w * kx;
      const dh = r.h * ky;
      ctx.save();
      ctx.beginPath();
      ctx.rect(dx, dy, dw, dh);
      ctx.clip();
      // A photo under zoom 1 covers only a part of the cell; the background shows around it.
      ctx.drawImage(
        bitmap,
        src.sx * s,
        src.sy * s,
        src.sw * s,
        src.sh * s,
        dx + dst.x * kx,
        dy + dst.y * ky,
        dst.w * kx,
        dst.h * ky,
      );
      ctx.restore();
    } finally {
      bitmap.close();
    }
  }

  const bytes = new Uint8Array(await (await toJpeg()).arrayBuffer());
  return new Blob([setJpegDpi(bytes, PRINT_DPI)], { type: 'image/jpeg' });
}
