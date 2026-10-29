// The album settings. Each change applies at once to every spread.
import { useEffect } from 'preact/hooks';
import { updateSettings } from '../model/album';
import type { AlbumSettings, BookStart, PageExport } from '../model/types';
import { mmToPx, PAGE_W } from '../model/units';
import type { AlbumStore } from '../state/store';
import { strings } from './strings';

type NumberField = 'gapMm' | 'marginMm' | 'bleedMm' | 'safeMm';

const NUMBER_FIELDS: { field: NumberField; id: string; label: string; max: number }[] = [
  { field: 'gapMm', id: 'gap', label: strings.settingGap, max: 20 },
  { field: 'marginMm', id: 'margin', label: strings.settingMargin, max: 30 },
  { field: 'bleedMm', id: 'bleed', label: strings.settingBleed, max: 5 },
  { field: 'safeMm', id: 'safe', label: strings.settingSafe, max: 20 },
];

const BACKGROUNDS: { id: string; colour: string; label: string }[] = [
  { id: 'ivory', colour: '#f4efe6', label: strings.bgIvory },
  { id: 'white', colour: '#ffffff', label: strings.bgWhite },
  { id: 'black', colour: '#1d1d1d', label: strings.bgBlack },
];

const BOOK_STARTS: { value: BookStart; label: string }[] = [
  { value: 'full-spread', label: strings.bookStartFullSpread },
  { value: 'single-right', label: strings.bookStartSingleRight },
];

export function SettingsDialog({ store, onClose }: { store: AlbumStore; onClose: () => void }) {
  const s = store.album.value.settings;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A run of changes to one field is one undo step.
  const set = <K extends keyof AlbumSettings>(field: K, value: AlbumSettings[K]) =>
    store.dispatch((a) => updateSettings(a, { [field]: value }), { coalesce: `settings:${field}` });

  const setNumber = (field: NumberField, max: number, raw: string) => {
    if (raw.trim() === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    set(field, Math.min(Math.max(n, 0), max));
  };

  const exportOptions: { value: PageExport; label: string }[] = [
    { value: 'bleed', label: strings.exportWithBleed(mmToPx(PAGE_W + 2 * s.bleedMm)) },
    { value: 'trim', label: strings.exportTrim(mmToPx(PAGE_W)) },
  ];

  return (
    <div class="settings-dialog" role="dialog" aria-label={strings.settingsTitle} data-testid="settings-dialog">
      <div class="settings-head">
        <h2>{strings.settingsTitle}</h2>
        <button type="button" data-testid="settings-close" onClick={onClose}>
          {strings.close}
        </button>
      </div>

      {NUMBER_FIELDS.map(({ field, id, label, max }) => (
        <label key={field} class="setting">
          <span>{label}</span>
          <input
            type="number"
            data-testid={`setting-${id}`}
            min={0}
            max={max}
            step={1}
            value={s[field]}
            onInput={(e) => setNumber(field, max, (e.target as HTMLInputElement).value)}
          />
        </label>
      ))}

      <fieldset class="setting">
        <legend>{strings.settingBackground}</legend>
        {BACKGROUNDS.map((b) => (
          <label key={b.id} class="choice">
            <input
              type="radio"
              name="background"
              data-testid={`setting-bg-${b.id}`}
              checked={s.background === b.colour}
              onChange={() => set('background', b.colour)}
            />
            <span class="swatch" style={{ background: b.colour }} />
            {b.label}
          </label>
        ))}
      </fieldset>

      <label class="setting choice">
        <input
          type="checkbox"
          data-testid="setting-guides"
          checked={s.showGuides}
          onChange={(e) => set('showGuides', (e.target as HTMLInputElement).checked)}
        />
        {strings.settingShowGuides}
      </label>

      <fieldset class="setting">
        <legend>{strings.settingBookStart}</legend>
        {BOOK_STARTS.map((b) => (
          <label key={b.value} class="choice">
            <input
              type="radio"
              name="book-start"
              data-testid={`setting-book-${b.value}`}
              checked={s.bookStart === b.value}
              onChange={() => set('bookStart', b.value)}
            />
            {b.label}
          </label>
        ))}
      </fieldset>

      <fieldset class="setting">
        <legend>{strings.settingPageExport}</legend>
        {exportOptions.map((o) => (
          <label key={o.value} class="choice">
            <input
              type="radio"
              name="page-export"
              data-testid={`setting-export-${o.value}`}
              checked={s.pageExport === o.value}
              onChange={() => set('pageExport', o.value)}
            />
            {o.label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
