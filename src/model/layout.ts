// Canvas coordinates: the origin is the top-left corner of the bleed area.
import type { AlbumSettings, GutterRef, LayoutNode, Rect, SpreadLayout } from './types';
import { FOLD_X, PAGE_W, TRIM_H, TRIM_W } from './units';

const MIN_CELL_MM = 20;
const EPS = 0.001;

interface Area { side: GutterRef['side']; node: LayoutNode; rect: Rect }

/** The trim-space area that each layout tree fills, before the bleed shift. */
function areas(layout: SpreadLayout, s: AlbumSettings): Area[] {
  const m = s.marginMm;
  const g = s.gapMm;
  if (layout.mode === 'spread') {
    const p = layout.padMm ?? m;
    return [{ side: 'spread', node: layout.root, rect: { x: p, y: p, w: TRIM_W - 2 * p, h: TRIM_H - 2 * p } }];
  }
  const out: Area[] = [];
  const p = layout.padMm;
  const left: Rect =
    p === undefined
      ? { x: m, y: m, w: FOLD_X - g / 2 - m, h: TRIM_H - 2 * m }
      : { x: p, y: p, w: PAGE_W - 2 * p, h: TRIM_H - 2 * p };
  const right: Rect =
    p === undefined
      ? { x: FOLD_X + g / 2, y: m, w: TRIM_W - m - (FOLD_X + g / 2), h: TRIM_H - 2 * m }
      : { x: FOLD_X + p, y: p, w: PAGE_W - 2 * p, h: TRIM_H - 2 * p };
  if (layout.left) out.push({ side: 'left', node: layout.left, rect: left });
  if (layout.right) out.push({ side: 'right', node: layout.right, rect: right });
  return out;
}

/** Splits a node's extent minus the gaps between its children by `sizes`. */
function childRects(node: Exclude<LayoutNode, { kind: 'cell' }>, rect: Rect, g: number): Rect[] {
  const n = node.children.length;
  const horizontal = node.kind === 'cols';
  const avail = (horizontal ? rect.w : rect.h) - g * (n - 1);
  const sum = node.sizes.reduce((a, b) => a + b, 0);
  const out: Rect[] = [];
  let pos = horizontal ? rect.x : rect.y;
  for (let i = 0; i < n; i++) {
    const len = (avail * node.sizes[i]) / sum;
    out.push(horizontal ? { x: pos, y: rect.y, w: len, h: rect.h } : { x: rect.x, y: pos, w: rect.w, h: len });
    pos += len + g;
  }
  return out;
}

function collectCells(node: LayoutNode, rect: Rect, g: number, out: Rect[]): void {
  if (node.kind === 'cell') {
    out.push(rect);
    return;
  }
  childRects(node, rect, g).forEach((r, i) => collectCells(node.children[i], r, g, out));
}

/** Shifts a trim-space rect into canvas space and extends each edge on a trim edge to the canvas edge. */
function toCanvas(r: Rect, b: number): Rect {
  let x1 = r.x + b;
  let y1 = r.y + b;
  let x2 = r.x + r.w + b;
  let y2 = r.y + r.h + b;
  if (Math.abs(x1 - b) < EPS) x1 = 0;
  if (Math.abs(y1 - b) < EPS) y1 = 0;
  if (Math.abs(x2 - (b + TRIM_W)) < EPS) x2 = TRIM_W + 2 * b;
  if (Math.abs(y2 - (b + TRIM_H)) < EPS) y2 = TRIM_H + 2 * b;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Cell rectangles in canvas coordinates, depth-first, left page before right page. */
export function cellRects(layout: SpreadLayout, s: AlbumSettings): Rect[] {
  const trim: Rect[] = [];
  for (const a of areas(layout, s)) collectCells(a.node, a.rect, s.gapMm, trim);
  return trim.map((r) => toCanvas(r, s.bleedMm));
}

/** The gap strips between sibling children. The fold gap between two page trees is not one of them. */
export function gutters(
  layout: SpreadLayout,
  s: AlbumSettings,
): { ref: GutterRef; orientation: 'v' | 'h'; rect: Rect }[] {
  const g = s.gapMm;
  const b = s.bleedMm;
  const out: { ref: GutterRef; orientation: 'v' | 'h'; rect: Rect }[] = [];
  const walk = (side: GutterRef['side'], node: LayoutNode, rect: Rect, path: number[]) => {
    if (node.kind === 'cell') return;
    const rs = childRects(node, rect, g);
    for (let i = 0; i < rs.length - 1; i++) {
      const c = rs[i];
      const strip: Rect =
        node.kind === 'cols' ? { x: c.x + c.w, y: rect.y, w: g, h: rect.h } : { x: rect.x, y: c.y + c.h, w: rect.w, h: g };
      out.push({
        ref: { side, path, index: i },
        orientation: node.kind === 'cols' ? 'v' : 'h',
        rect: { x: strip.x + b, y: strip.y + b, w: strip.w, h: strip.h },
      });
    }
    rs.forEach((r, i) => walk(side, node.children[i], r, [...path, i]));
  };
  for (const a of areas(layout, s)) walk(a.side, a.node, a.rect, []);
  return out;
}

function replaceAt(node: LayoutNode, path: number[], fn: (n: LayoutNode) => LayoutNode): LayoutNode {
  if (path.length === 0) return fn(node);
  if (node.kind === 'cell') return node;
  const [head, ...rest] = path;
  return { ...node, children: node.children.map((c, i) => (i === head ? replaceAt(c, rest, fn) : c)) };
}

/**
 * Moves one border by `deltaMm`. The two neighbouring children keep the sum of their sizes,
 * and both keep a trim-space extent of 20 mm or more.
 */
export function moveGutter(layout: SpreadLayout, ref: GutterRef, deltaMm: number, s: AlbumSettings): SpreadLayout {
  const area = areas(layout, s).find((a) => a.side === ref.side);
  if (!area) return layout;
  let node = area.node;
  let rect = area.rect;
  for (const i of ref.path) {
    if (node.kind === 'cell') return layout;
    rect = childRects(node, rect, s.gapMm)[i];
    node = node.children[i];
    if (!node) return layout;
  }
  if (node.kind === 'cell' || ref.index < 0 || ref.index + 1 >= node.children.length) return layout;

  const target = node;
  const rs = childRects(target, rect, s.gapMm);
  const len = (r: Rect) => (target.kind === 'cols' ? r.w : r.h);
  const a = len(rs[ref.index]);
  const pair = a + len(rs[ref.index + 1]);
  if (pair < 2 * MIN_CELL_MM) return layout;
  const next = Math.min(Math.max(a + deltaMm, MIN_CELL_MM), pair - MIN_CELL_MM);
  const sizePair = target.sizes[ref.index] + target.sizes[ref.index + 1];
  const sizes = [...target.sizes];
  sizes[ref.index] = (sizePair * next) / pair;
  sizes[ref.index + 1] = sizePair - sizes[ref.index];

  const update = (root: LayoutNode) => replaceAt(root, ref.path, (n) => ({ ...(n as typeof target), sizes }));
  if (layout.mode === 'spread') return { ...layout, root: update(layout.root) };
  if (ref.side === 'left' && layout.left) return { ...layout, left: update(layout.left) };
  if (ref.side === 'right' && layout.right) return { ...layout, right: update(layout.right) };
  return layout;
}

/** Guide lines in canvas coordinates: the trim area, the two safe zones and the fold. */
export function guides(s: AlbumSettings): { trim: Rect; safeLeft: Rect; safeRight: Rect; foldX: number } {
  const b = s.bleedMm;
  const k = s.safeMm;
  const side = PAGE_W - 2 * k;
  return {
    trim: { x: b, y: b, w: TRIM_W, h: TRIM_H },
    safeLeft: { x: b + k, y: b + k, w: side, h: TRIM_H - 2 * k },
    safeRight: { x: b + FOLD_X + k, y: b + k, w: side, h: TRIM_H - 2 * k },
    foldX: b + FOLD_X,
  };
}
