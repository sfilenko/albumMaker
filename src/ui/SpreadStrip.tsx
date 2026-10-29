// The spread strip: miniatures of all spreads, select, reorder by drag, add and delete.
import { useEffect, useRef } from 'preact/hooks';
import { addSpread, moveSpread, removeSpread } from '../model/album';
import { cellRects } from '../model/layout';
import type { Spread } from '../model/types';
import { canvasSizeMm } from '../model/units';
import type { AlbumStore } from '../state/store';
import { registerDropTarget, startDrag } from './dnd';
import { usePreviewUrl } from './previews';
import { strings } from './strings';

function MiniPhoto({ photoId }: { photoId: string }) {
  const url = usePreviewUrl(photoId, 'thumb');
  return url ? <img src={url} alt="" draggable={false} /> : null;
}

function StripItem({
  store,
  spread,
  index,
  current,
  onSelect,
}: {
  store: AlbumStore;
  spread: Spread;
  index: number;
  current: boolean;
  onSelect: (i: number) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const s = store.album.value.settings;
  const canvas = canvasSizeMm(s.bleedMm);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  useEffect(() => {
    if (!ref.current) return;
    return registerDropTarget(
      ref.current,
      (p) => p.kind === 'spread' && p.index !== index,
      (p) => {
        if (p.kind !== 'spread') return;
        store.dispatch((a) => moveSpread(a, p.index, index));
        onSelect(Math.max(index, 1));
      },
    );
  }, [store, index]);

  return (
    <button
      type="button"
      ref={ref}
      class={`strip-item${current ? ' current' : ''}`}
      data-testid={`strip-${index}`}
      data-spread-id={spread.id}
      aria-current={current}
      onClick={() => onSelect(index)}
      onPointerDown={(e) => !spread.isCover && ref.current && startDrag(e, { kind: 'spread', index }, ref.current)}
    >
      <span class="mini" style={{ aspectRatio: `${canvas.w} / ${canvas.h}`, background: s.background }}>
        {cellRects(spread.layout, s).map((r, i) => {
          const photoId = spread.cells[i]?.photoId ?? null;
          return (
            <span
              key={i}
              class={`mini-cell${photoId ? ' filled' : ''}`}
              style={{ left: pct(r.x, canvas.w), top: pct(r.y, canvas.h), width: pct(r.w, canvas.w), height: pct(r.h, canvas.h) }}
            >
              {photoId && <MiniPhoto photoId={photoId} />}
            </span>
          );
        })}
      </span>
      <span class="strip-label">{spread.isCover ? strings.cover : index}</span>
    </button>
  );
}

export function SpreadStrip({
  store,
  spreadIndex,
  onSelect,
}: {
  store: AlbumStore;
  spreadIndex: number;
  onSelect: (i: number) => void;
}) {
  const album = store.album.value;
  const current = album.spreads[spreadIndex];

  const add = () => {
    store.dispatch((a) => addSpread(a, spreadIndex));
    onSelect(Math.max(spreadIndex + 1, 1));
  };

  const remove = () => {
    if (!current || current.isCover || !confirm(strings.confirmDeleteSpread(spreadIndex))) return;
    store.dispatch((a) => removeSpread(a, current.id));
    onSelect(Math.min(spreadIndex, album.spreads.length - 2));
  };

  return (
    <nav class="panel spread-strip" data-testid="spread-strip" aria-label={strings.tabSpreads}>
      <div class="strip-items">
        {album.spreads.map((sp, i) => (
          <StripItem key={sp.id} store={store} spread={sp} index={i} current={i === spreadIndex} onSelect={onSelect} />
        ))}
      </div>
      <div class="strip-actions">
        <button type="button" data-testid="strip-add" aria-label={strings.addSpread} title={strings.addSpread} onClick={add}>
          +
        </button>
        <button
          type="button"
          data-testid="strip-delete"
          disabled={!current || current.isCover}
          onClick={remove}
        >
          {strings.deleteSpread}
        </button>
      </div>
    </nav>
  );
}
