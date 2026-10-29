// The template library: the 12 templates as miniatures at the album's current settings.
import { applyTemplate } from '../model/album';
import { cellRects } from '../model/layout';
import { templateLayout, TEMPLATES } from '../model/templates';
import { canvasSizeMm } from '../model/units';
import type { AlbumStore } from '../state/store';
import { strings } from './strings';

export function TemplatePanel({ store, spreadIndex }: { store: AlbumStore; spreadIndex: number }) {
  const album = store.album.value;
  const spread = album.spreads[spreadIndex];
  const s = album.settings;
  const canvas = canvasSizeMm(s.bleedMm);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <aside class="panel template-panel" data-testid="template-panel" aria-label={strings.tabTemplates}>
      <div class="templates">
        {TEMPLATES.map((t) => {
          const rects = cellRects(templateLayout(t.id), s);
          const current = spread?.templateId === t.id;
          return (
            <button
              key={t.id}
              type="button"
              class={`template${current ? ' current' : ''}`}
              data-testid={`template-${t.id}`}
              aria-pressed={current}
              title={t.note}
              disabled={!spread}
              onClick={() => spread && store.dispatch((a) => applyTemplate(a, spread.id, t.id))}
            >
              <span class="mini" style={{ aspectRatio: `${canvas.w} / ${canvas.h}`, background: s.background }}>
                {rects.map((r, i) => (
                  <span
                    key={i}
                    class="mini-cell"
                    style={{ left: pct(r.x, canvas.w), top: pct(r.y, canvas.h), width: pct(r.w, canvas.w), height: pct(r.h, canvas.h) }}
                  />
                ))}
                <span class="mini-fold" />
              </span>
              <span class="template-name">{t.name}</span>
              <span class="template-meta">
                {strings.cells(rects.length)}
                {t.mine && <span class="badge">{strings.yourExample}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
