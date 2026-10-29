// Full-screen preview: one spread at a time, trim area only, no guides. A side that does not
// print shows as blank paper.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { cellRects } from '../model/layout';
import { sideIsPrinted, type Side } from '../model/pages';
import { FOLD_X, TRIM_H, TRIM_W } from '../model/units';
import type { AlbumStore } from '../state/store';
import { CellPhoto } from './SpreadView';
import { strings } from './strings';

const SWIPE_PX = 50;
// Room for the bar with the arrow buttons and the close button.
const BAR_PX = 64;
const SIDE_PX = 16;

function useFitScale(): number {
  const fit = () => Math.min((window.innerWidth - 2 * SIDE_PX) / TRIM_W, (window.innerHeight - 2 * BAR_PX) / TRIM_H);
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const on = () => setScale(fit());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return scale;
}

export function PreviewMode({
  store,
  startIndex,
  onClose,
}: {
  store: AlbumStore;
  startIndex: number;
  onClose: (index: number) => void;
}) {
  const album = store.album.value;
  const last = album.spreads.length - 1;
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), last));
  const scale = useFitScale();
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const current = useRef(index);
  current.current = index;

  const go = (d: number) => setIndex((i) => Math.min(Math.max(i + d, 0), last));

  // Before the first paint: a key pressed as soon as the preview shows must not be lost.
  // The button that opened the preview is gone, so the keys need a focused element here.
  useLayoutEffect(() => {
    root.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') onClose(current.current);
      else return;
      // The editor's own keys (Escape ends crop mode) do not apply while the preview is open.
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [last, onClose]);

  const spread = album.spreads[index];
  if (!spread) return null;
  const s = album.settings;
  const b = s.bleedMm;
  const metas = new Map(album.photos.map((p) => [p.id, p]));
  const sides: Side[] = ['left', 'right'];
  const blank = spread.isCover ? [] : sides.filter((side) => !sideIsPrinted(album, spread.id, side));
  const px = (mm: number) => `${mm * scale}px`;

  return (
    <div
      ref={root}
      class="preview"
      data-testid="preview"
      tabIndex={-1}
      onPointerDown={(e) => {
        swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start || start.id !== e.pointerId) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
      }}
      onPointerCancel={() => (swipe.current = null)}
    >
      <div class="preview-bar">
        <span data-testid="preview-position">{index === 0 ? strings.cover : strings.spreadPosition(index, last)}</span>
        <button type="button" data-testid="preview-close" onClick={() => onClose(index)}>
          {strings.closePreview}
        </button>
      </div>

      <div
        class="preview-stage"
        data-testid="preview-spread"
        data-spread-index={index}
        style={{ width: px(TRIM_W), height: px(TRIM_H), background: s.background }}
      >
        {cellRects(spread.layout, s).map((r, i) => {
          const cell = spread.cells[i];
          const meta = cell?.photoId ? metas.get(cell.photoId) : undefined;
          if (!cell || !meta) return null;
          return (
            <div
              key={i}
              class="preview-cell"
              data-testid={`preview-cell-${i}`}
              style={{ left: px(r.x - b), top: px(r.y - b), width: px(r.w), height: px(r.h) }}
            >
              <CellPhoto meta={meta} rect={r} cell={cell} />
            </div>
          );
        })}
        {blank.map((side) => (
          <div
            key={side}
            class="preview-blank"
            data-testid={`preview-blank-${side}`}
            style={{ left: px(side === 'left' ? 0 : FOLD_X), width: px(TRIM_W - FOLD_X), background: s.background }}
          />
        ))}
      </div>

      <div class="preview-nav">
        <button type="button" data-testid="preview-prev" aria-label={strings.prevSpread} disabled={index === 0} onClick={() => go(-1)}>
          ‹
        </button>
        <button type="button" data-testid="preview-next" aria-label={strings.nextSpread} disabled={index === last} onClick={() => go(1)}>
          ›
        </button>
      </div>
    </div>
  );
}
