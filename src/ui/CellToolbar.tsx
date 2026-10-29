// Tools for the selected filled cell: crop mode, zoom, and remove the photo.
import { useRef } from 'preact/hooks';
import { clearCell, setCrop } from '../model/album';
import { zoomCrop } from '../model/crop';
import { cellRects } from '../model/layout';
import type { CellRef } from '../model/types';
import type { AlbumStore } from '../state/store';
import { strings } from './strings';

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

export function CellToolbar({
  store,
  cellRef,
  cropping,
  onCropChange,
}: {
  store: AlbumStore;
  cellRef: CellRef;
  cropping: boolean;
  onCropChange: (on: boolean) => void;
}) {
  const album = store.album.value;
  const spread = album.spreads.find((s) => s.id === cellRef.spreadId);
  const cell = spread?.cells[cellRef.cellIndex];
  const meta = cell?.photoId ? album.photos.find((p) => p.id === cell.photoId) : undefined;
  // One slider movement is one undo step.
  const gesture = useRef<string | null>(null);
  if (!spread || !cell || !meta) return null;
  const rect = cellRects(spread.layout, album.settings)[cellRef.cellIndex];

  const zoomTo = (zoom: number) => {
    gesture.current ??= `crop:zoom:${performance.now()}`;
    store.dispatch(
      (a) => {
        const c = a.spreads.find((s) => s.id === cellRef.spreadId)?.cells[cellRef.cellIndex];
        return c ? setCrop(a, cellRef, zoomCrop(meta.width, meta.height, rect, c.crop, zoom)) : a;
      },
      { coalesce: gesture.current },
    );
  };

  return (
    <div class="cell-toolbar" data-testid="cell-toolbar">
      <button type="button" data-testid="crop-toggle" aria-pressed={cropping} onClick={() => onCropChange(!cropping)}>
        {cropping ? strings.cropDone : strings.crop}
      </button>
      <label class="zoom">
        <span>{strings.zoom}</span>
        <input
          type="range"
          data-testid="zoom-slider"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.1}
          value={cell.crop.zoom}
          onInput={(e) => zoomTo(Number((e.target as HTMLInputElement).value))}
          onChange={() => (gesture.current = null)}
        />
      </label>
      <button
        type="button"
        data-testid="remove-photo"
        onClick={() => {
          onCropChange(false);
          store.dispatch((a) => clearCell(a, cellRef));
        }}
      >
        {strings.removePhoto}
      </button>
    </div>
  );
}
