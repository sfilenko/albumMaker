// The current spread: cells with their photos, guide lines, halves that do not print,
// draggable borders, drag and drop of photos, crop mode, and a grey box for a photo that
// this device does not have. Geometry comes from the model, in millimetres.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { moveGutterOp, placePhoto, setCrop, swapCells } from '../model/album';
import { effectiveDpi, LOW_DPI, panCrop, sourceRect, zoomCrop } from '../model/crop';
import { cellRects, guides, gutters } from '../model/layout';
import { cellSides, sideIsPrinted, type Side } from '../model/pages';
import type { Cell, CellRef, PhotoMeta, Rect } from '../model/types';
import { canvasSizeMm, FOLD_X } from '../model/units';
import type { AlbumStore } from '../state/store';
import { armedPhoto, registerDropTarget, startDrag } from './dnd';
import { usePreviewUrl } from './previews';
import { strings } from './strings';

const MIN_HIT_PX = 12;
const DOUBLE_TAP_MS = 300;
const WHEEL_ZOOM_PER_PX = 0.002;
const WHEEL_GESTURE_MS = 400;

const box = (r: Rect, s: number) => ({ left: `${r.x * s}px`, top: `${r.y * s}px`, width: `${r.w * s}px`, height: `${r.h * s}px` });
const sameRef = (a: CellRef | null, b: CellRef) => a?.spreadId === b.spreadId && a.cellIndex === b.cellIndex;

/** Pixels per millimetre that fit the canvas into the host. */
function useScale(cw: number, ch: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0) setScale(h > 0 ? Math.min(w / cw, h / ch) : w / cw);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cw, ch]);
  return { ref, scale };
}

/** A photo inside its cell, placed by the crop. The preview uses it too. */
export function CellPhoto({ meta, rect, cell }: { meta: PhotoMeta; rect: Rect; cell: Cell }) {
  const url = usePreviewUrl(meta.id, 'full');
  if (!url) return null;
  const { sx, sy, sw, sh } = sourceRect(meta.width, meta.height, rect, cell.crop);
  return (
    <img
      class="cell-photo"
      src={url}
      alt={meta.name}
      draggable={false}
      style={{
        width: `${(meta.width / sw) * 100}%`,
        height: `${(meta.height / sh) * 100}%`,
        left: `${(-sx / sw) * 100}%`,
        top: `${(-sy / sh) * 100}%`,
      }}
    />
  );
}

interface CellBoxProps {
  store: AlbumStore;
  spreadIndex: number;
  cellRef: CellRef;
  rect: Rect;
  cell: Cell;
  meta: PhotoMeta | undefined;
  /** The photo has no screen copy on this device. */
  missing: boolean;
  scale: number;
  printed: boolean;
  selected: boolean;
  cropping: boolean;
  onSelect: (ref: CellRef) => void;
  onCrop: (ref: CellRef | null) => void;
  onFindPhoto: (photoId: string) => void;
}

function CellBox(props: CellBoxProps) {
  const { store, spreadIndex, cellRef, rect, cell, meta, missing, scale, printed, selected, cropping, onSelect, onCrop, onFindPhoto } = props;
  const el = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ key: string; pinch?: { dist: number; zoom: number } } | null>(null);
  const lastTap = useRef(0);
  const lastWheel = useRef({ at: 0, key: '' });

  useEffect(() => {
    if (!el.current) return;
    return registerDropTarget(
      el.current,
      (p) => p.kind === 'photo' || (p.kind === 'cell' && !sameRef(p.ref, cellRef)),
      (p) => {
        if (p.kind === 'photo') store.dispatch((a) => placePhoto(a, cellRef, p.photoId));
        else if (p.kind === 'cell') store.dispatch((a) => swapCells(a, p.ref, cellRef));
      },
    );
  }, [store, cellRef.spreadId, cellRef.cellIndex]);

  const crop = (next: (c: Cell['crop']) => Cell['crop'], key: string) => {
    if (!meta) return;
    store.dispatch(
      (a) => {
        const c = a.spreads.find((s) => s.id === cellRef.spreadId)?.cells[cellRef.cellIndex];
        return c ? setCrop(a, cellRef, next(c.crop)) : a;
      },
      { coalesce: key },
    );
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!cropping) {
      if (meta && el.current) startDrag(e, { kind: 'cell', ref: cellRef }, el.current);
      return;
    }
    e.stopPropagation();
    el.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // One pan or pinch is one undo step.
    gesture.current = { key: `crop:${e.timeStamp}` };
  };

  const onPointerMove = (e: PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!cropping || !prev || !meta || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const zoomNow = cell.crop.zoom;
      gesture.current.pinch ??= { dist, zoom: zoomNow };
      const { dist: d0, zoom: z0 } = gesture.current.pinch;
      crop((c) => zoomCrop(meta.width, meta.height, rect, c, (z0 * dist) / d0), gesture.current.key);
      return;
    }
    const dx = (e.clientX - prev.x) / scale;
    const dy = (e.clientY - prev.y) / scale;
    crop((c) => panCrop(meta.width, meta.height, rect, c, dx, dy), gesture.current.key);
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    if (e.pointerType !== 'mouse' && meta && !missing) {
      if (e.timeStamp - lastTap.current < DOUBLE_TAP_MS) onCrop(cellRef);
      lastTap.current = e.timeStamp;
    }
  };

  const onWheel = (e: WheelEvent) => {
    if (!cropping || !meta) return;
    e.preventDefault();
    if (e.timeStamp - lastWheel.current.at > WHEEL_GESTURE_MS) lastWheel.current.key = `crop:wheel:${e.timeStamp}`;
    lastWheel.current.at = e.timeStamp;
    const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_PER_PX);
    crop((c) => zoomCrop(meta.width, meta.height, rect, c, c.zoom * factor), lastWheel.current.key);
  };

  const dpi = meta && printed && !missing ? effectiveDpi(meta.width, meta.height, rect, cell.crop) : null;
  const id = `${spreadIndex}-${cellRef.cellIndex}`;

  const content = !meta ? (
    <span class="drop-hint">{strings.dropHere}</span>
  ) : missing ? (
    <div class="missing-photo" data-testid={`missing-${id}`}>
      <span class="missing-name">{meta.name}</span>
      <button
        type="button"
        data-testid={`find-photo-${id}`}
        onPointerDown={(e) => e.stopPropagation()}
        onDblClick={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onFindPhoto(meta.id);
        }}
      >
        {strings.findPhoto}
      </button>
    </div>
  ) : (
    <CellPhoto meta={meta} rect={rect} cell={cell} />
  );

  return (
    <div
      ref={el}
      class={`cell${selected ? ' selected' : ''}${cropping ? ' cropping' : ''}${meta ? '' : ' empty'}${meta && missing ? ' missing' : ''}`}
      data-testid={`cell-${id}`}
      data-photo={cell.photoId ?? ''}
      style={box(rect, scale)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onDblClick={(e) => {
        e.stopPropagation();
        if (meta && !missing) onCrop(cellRef);
      }}
      onClick={(e) => {
        e.stopPropagation();
        const armed = armedPhoto.value;
        if (armed !== null) {
          armedPhoto.value = null;
          store.dispatch((a) => placePhoto(a, cellRef, armed));
        }
        onSelect(cellRef);
      }}
    >
      {content}
      {dpi !== null && dpi < LOW_DPI && (
        <span class="low-dpi" data-testid={`low-dpi-${id}`} title={strings.lowDpi(Math.round(dpi))}>
          ⚠ {Math.round(dpi)} dpi
        </span>
      )}
    </div>
  );
}

export function SpreadView({
  store,
  spreadIndex,
  selected,
  onSelect,
  cropping,
  onCrop,
  missing,
  onFindPhoto,
}: {
  store: AlbumStore;
  spreadIndex: number;
  selected: CellRef | null;
  onSelect: (ref: CellRef | null) => void;
  cropping: CellRef | null;
  onCrop: (ref: CellRef | null) => void;
  /** Photos that have no screen copy on this device. */
  missing: ReadonlySet<string>;
  onFindPhoto: (photoId: string) => void;
}) {
  const album = store.album.value;
  const spread = album.spreads[spreadIndex];
  const s = album.settings;
  const canvas = canvasSizeMm(s.bleedMm);
  const { ref, scale } = useScale(canvas.w, canvas.h);
  const drag = useRef<{ id: number; key: string; offsetMm: number } | null>(null);

  if (!spread) return null;
  const rects = cellRects(spread.layout, s);
  const borders = gutters(spread.layout, s);
  const g = guides(s);
  const metas = new Map(album.photos.map((p) => [p.id, p]));
  const sides: Side[] = ['left', 'right'];
  const unprinted = spread.isCover ? [] : sides.filter((side) => !sideIsPrinted(album, spread.id, side));
  const fold = s.bleedMm + FOLD_X;

  // The pointer position along the border's axis, in canvas millimetres.
  const pointerMm = (e: PointerEvent, vertical: boolean): number | null => {
    const stage = ref.current?.querySelector('.stage')?.getBoundingClientRect();
    if (!stage) return null;
    return (vertical ? e.clientX - stage.left : e.clientY - stage.top) / scale;
  };

  // The border's centre in the current album, so a clamped border does not drift from the pointer.
  const centreNow = (i: number): number | null => {
    const want = borders[i].ref;
    const now = gutters(store.album.value.spreads[spreadIndex].layout, store.album.value.settings).find(
      (x) => x.ref.side === want.side && x.ref.index === want.index && x.ref.path.join() === want.path.join(),
    );
    if (!now) return null;
    return now.orientation === 'v' ? now.rect.x + now.rect.w / 2 : now.rect.y + now.rect.h / 2;
  };

  const onBorderDown = (i: number, e: PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const at = pointerMm(e, borders[i].orientation === 'v');
    const centre = centreNow(i);
    if (at === null || centre === null) return;
    // One drag is one undo step, so each drag gets its own coalesce key.
    drag.current = { id: e.pointerId, key: `gutter:${e.timeStamp}`, offsetMm: at - centre };
  };

  const onBorderMove = (i: number, e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const at = pointerMm(e, borders[i].orientation === 'v');
    const centre = centreNow(i);
    if (at === null || centre === null) return;
    const delta = at - d.offsetMm - centre;
    if (Math.abs(delta) < 0.01) return;
    const ref0 = borders[i].ref;
    store.dispatch((a) => moveGutterOp(a, spread.id, ref0, delta), { coalesce: d.key });
  };

  const onBorderUp = (e: PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  return (
    <div class="spread-host" ref={ref}>
      <div
        class="stage"
        data-testid="spread-view"
        style={{ width: `${canvas.w * scale}px`, height: `${canvas.h * scale}px`, background: s.background }}
        onClick={() => {
          onSelect(null);
          onCrop(null);
        }}
      >
        {rects.map((r, i) => {
          const cell = spread.cells[i];
          if (!cell) return null;
          const cellRef = { spreadId: spread.id, cellIndex: i };
          const meta = cell.photoId ? metas.get(cell.photoId) : undefined;
          const printed = !spread.isCover && cellSides(r, s.bleedMm).some((side) => !unprinted.includes(side));
          return (
            <CellBox
              key={i}
              store={store}
              spreadIndex={spreadIndex}
              cellRef={cellRef}
              rect={r}
              cell={cell}
              meta={meta}
              missing={meta !== undefined && missing.has(meta.id)}
              scale={scale}
              printed={printed}
              selected={sameRef(selected, cellRef)}
              cropping={sameRef(cropping, cellRef)}
              onSelect={onSelect}
              onCrop={onCrop}
              onFindPhoto={onFindPhoto}
            />
          );
        })}

        {unprinted.map((side) => (
          <div
            key={side}
            class="not-printed"
            data-testid={`not-printed-${side}`}
            style={box(side === 'left' ? { x: 0, y: 0, w: fold, h: canvas.h } : { x: fold, y: 0, w: canvas.w - fold, h: canvas.h }, scale)}
          >
            <span>{strings.notPrinted}</span>
          </div>
        ))}

        {s.showGuides && (
          <>
            <div
              class="guide-bleed"
              data-testid="guide-bleed"
              style={{ width: `${g.trim.w * scale}px`, height: `${g.trim.h * scale}px`, borderWidth: `${s.bleedMm * scale}px` }}
            />
            <div class="guide-safe" data-testid="guide-safe" style={box(g.safeLeft, scale)} />
            <div class="guide-safe" data-testid="guide-safe" style={box(g.safeRight, scale)} />
            <div class="guide-fold" data-testid="guide-fold" style={{ left: `${g.foldX * scale}px` }} />
          </>
        )}

        {cropping === null &&
          borders.map((b, i) => {
            const vertical = b.orientation === 'v';
            const len = vertical ? b.rect.w : b.rect.h;
            const hit = Math.max(MIN_HIT_PX, len * scale);
            const centre = (vertical ? b.rect.x + b.rect.w / 2 : b.rect.y + b.rect.h / 2) * scale;
            return (
              <div
                key={`${b.ref.side}:${b.ref.path.join('.')}:${b.ref.index}`}
                class={`gutter ${vertical ? 'v' : 'h'}`}
                data-testid={`gutter-${i}`}
                style={
                  vertical
                    ? { left: `${centre - hit / 2}px`, width: `${hit}px`, top: `${b.rect.y * scale}px`, height: `${b.rect.h * scale}px` }
                    : { top: `${centre - hit / 2}px`, height: `${hit}px`, left: `${b.rect.x * scale}px`, width: `${b.rect.w * scale}px` }
                }
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => onBorderDown(i, e)}
                onPointerMove={(e) => onBorderMove(i, e)}
                onPointerUp={onBorderUp}
                onPointerCancel={onBorderUp}
              />
            );
          })}
      </div>
    </div>
  );
}
