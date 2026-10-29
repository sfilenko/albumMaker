// The print export: warnings first, then the files to write, progress, and a request for the
// original photos when this session cannot read them.
import { useEffect, useState } from 'preact/hooks';
import { exportPlan, jobKind, MissingOriginalsError, runExport, type ExportKind } from '../export/export';
import { printWarnings, type PrintWarning } from '../model/pages';
import type { Album, CellRef } from '../model/types';
import { DECODE_LIMIT, describeFile, mapLimit, pickFiles } from '../photos/import';
import { matchPhotos } from '../photos/match';
import { registerOriginals } from '../photos/originals';
import type { AlbumStore } from '../state/store';
import { hasPreviews } from '../storage/db';
import { strings } from './strings';

type State =
  | { step: 'ready' }
  | { step: 'running'; done: number; total: number }
  | { step: 'originals'; photoIds: string[]; unmatched: string[] }
  | { step: 'matched' }
  | { step: 'done' }
  | { step: 'error'; message: string };

function where(a: Album, ref: CellRef): { spread: number; cell: number } {
  return { spread: a.spreads.findIndex((s) => s.id === ref.spreadId), cell: ref.cellIndex + 1 };
}

function warningText(a: Album, w: PrintWarning): string {
  switch (w.kind) {
    case 'min-pages':
      return strings.warnMinPages(w.pages);
    case 'low-dpi':
      return strings.warnLowDpi(where(a, w.ref), Math.round(w.dpi));
    case 'empty-cell':
      return strings.warnEmptyCell(where(a, w.ref));
    case 'unprinted-photo':
      return strings.warnUnprintedPhoto(where(a, w.ref));
    case 'missing-photo':
      return strings.warnMissingPhoto(a.photos.find((p) => p.id === w.photoId)?.name ?? w.photoId);
  }
}

export function ExportDialog({ store, mobile, onClose }: { store: AlbumStore; mobile: boolean; onClose: () => void }) {
  const album = store.album.value;
  const [available, setAvailable] = useState<Set<string> | null>(null);
  const [kinds, setKinds] = useState<ExportKind[]>(mobile ? ['pages'] : ['spreads', 'pages']);
  const [state, setState] = useState<State>({ step: 'ready' });

  useEffect(() => {
    let live = true;
    void hasPreviews(album.photos.map((p) => p.id)).then((ids) => live && setAvailable(ids));
    return () => {
      live = false;
    };
  }, [album]);

  const jobs = exportPlan(album);
  const count = (k: ExportKind) => jobs.filter((j) => jobKind(j) === k).length;
  const warnings = available ? printWarnings(album, available) : [];
  const busy = state.step === 'running';

  const start = async () => {
    setState({ step: 'running', done: 0, total: 0 });
    try {
      await runExport(store.album.value, (done, total) => setState({ step: 'running', done, total }), kinds);
      setState({ step: 'done' });
    } catch (e) {
      if (e instanceof MissingOriginalsError) setState({ step: 'originals', photoIds: e.photoIds, unmatched: [] });
      else if (e instanceof DOMException && e.name === 'AbortError') setState({ step: 'ready' });
      else setState({ step: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const chooseOriginals = async (photoIds: string[]) => {
    const files = await pickFiles();
    if (files.length === 0) return;
    const wanted = store.album.value.photos.filter((p) => photoIds.includes(p.id));
    // At most DECODE_LIMIT originals decode at the same time, as on import.
    const { matched } = matchPhotos(wanted, await mapLimit(files, DECODE_LIMIT, (f) => describeFile(f)));
    registerOriginals(new Map([...matched].map(([id, i]) => [id, files[i]] as const)));
    const unmatched = wanted.filter((p) => !matched.has(p.id)).map((p) => p.name);
    // The folder picker needs a fresh click: the file dialog and the decoding can take longer
    // than the few seconds a browser allows after the first one.
    setState(unmatched.length > 0 ? { step: 'originals', photoIds, unmatched } : { step: 'matched' });
  };

  const options: ExportKind[] = mobile ? ['pages'] : ['spreads', 'pages'];

  return (
    <div class="modal-backdrop">
      <div class="export-dialog" role="dialog" aria-label={strings.exportTitle} data-testid="export-dialog">
        <div class="settings-head">
          <h2>{strings.exportTitle}</h2>
          <button type="button" data-testid="export-close" disabled={busy} onClick={onClose}>
            {strings.close}
          </button>
        </div>

        {mobile && <p class="note" data-testid="export-phone-note">{strings.exportPhoneNote}</p>}

        <section data-testid="export-warnings">
          <h3>{strings.printWarnings}</h3>
          {available === null ? (
            <p class="muted">{strings.loading}</p>
          ) : warnings.length === 0 ? (
            <p class="muted" data-testid="export-no-warnings">{strings.noPrintWarnings}</p>
          ) : (
            <ul class="warnings">
              {warnings.map((w, i) => (
                <li key={i} data-testid={`warning-${w.kind}`}>
                  {warningText(album, w)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <fieldset class="setting">
          <legend>{strings.exportWhat}</legend>
          {options.map((k) => (
            <label key={k} class="choice">
              <input
                type="checkbox"
                data-testid={`export-kind-${k}`}
                checked={kinds.includes(k)}
                disabled={busy}
                onChange={(e) =>
                  setKinds((ks) => ((e.target as HTMLInputElement).checked ? [...ks, k] : ks.filter((x) => x !== k)))
                }
              />
              {k === 'spreads' ? strings.exportSpreads(count('spreads')) : strings.exportPages(count('pages'))}
            </label>
          ))}
        </fieldset>

        {state.step === 'running' && (
          <p class="progress" data-testid="export-progress">
            {strings.exportProgress(state.done, state.total)}
          </p>
        )}
        {state.step === 'originals' && (
          <div class="note" data-testid="export-need-originals">
            <p>{strings.exportNeedOriginals(state.photoIds.length)}</p>
            {state.unmatched.length > 0 && <p>{strings.exportUnmatched(state.unmatched)}</p>}
            <button type="button" class="primary" data-testid="export-choose-originals" onClick={() => void chooseOriginals(state.photoIds)}>
              {strings.exportChooseOriginals}
            </button>
          </div>
        )}
        {state.step === 'matched' && (
          <div class="note" data-testid="export-originals-found">
            <p>{strings.exportOriginalsFound}</p>
            <button type="button" class="primary" data-testid="export-continue" onClick={() => void start()}>
              {strings.exportContinue}
            </button>
          </div>
        )}
        {state.step === 'done' && <p class="note" data-testid="export-done">{strings.exportDone}</p>}
        {state.step === 'error' && <p class="note" data-testid="export-error">{strings.exportError(state.message)}</p>}

        <button
          type="button"
          class="primary"
          data-testid="export-start"
          disabled={busy || kinds.length === 0 || available === null || state.step === 'matched'}
          onClick={() => void start()}
        >
          {strings.exportStart}
        </button>
      </div>
    </div>
  );
}
