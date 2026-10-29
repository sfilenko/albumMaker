// The editor frame: four areas at 900 px and wider, the spread and three tabs below that.
// The banners show above the spread, the print warnings summary below it (on a phone, below
// the tabs).
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { CellRef } from '../model/types';
import type { AlbumStore } from '../state/store';
import { hasPreviews } from '../storage/db';
import { saveLayoutFile } from '../storage/layoutFile';
import { Banners, PrintSummary } from './Banners';
import { CellToolbar } from './CellToolbar';
import { ExportDialog } from './ExportDialog';
import { armedPhoto } from './dnd';
import { PhotoPanel } from './PhotoPanel';
import { forgetPreviews } from './previews';
import { PreviewMode } from './PreviewMode';
import { RelinkDialog } from './RelinkDialog';
import { SettingsDialog } from './SettingsDialog';
import { SpreadStrip } from './SpreadStrip';
import { SpreadView } from './SpreadView';
import { strings } from './strings';
import { TemplatePanel } from './TemplatePanel';

const DESKTOP_QUERY = '(min-width: 900px)';
const COARSE_POINTER_QUERY = '(pointer: coarse)';
type Tab = 'photos' | 'templates' | 'spreads';

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => setDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop;
}

function isTyping(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

export function Editor({
  store,
  storageError,
  onOpenFile,
  onClose,
}: {
  store: AlbumStore;
  storageError: boolean;
  onOpenFile: () => void;
  onClose: () => void;
}) {
  const album = store.album.value;
  const desktop = useDesktop();
  const [spreadIndex, setSpreadIndex] = useState(album.spreads.length > 1 ? 1 : 0);
  const [selected, setSelected] = useState<CellRef | null>(null);
  const [cropping, setCropping] = useState<CellRef | null>(null);
  const [tab, setTab] = useState<Tab>('photos');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Photos without screen copies on this device: a layout file from another device brings them.
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const [relinking, setRelinking] = useState<string[] | null>(null);

  useEffect(() => {
    let live = true;
    const ids = album.photos.map((p) => p.id);
    void hasPreviews(ids).then(
      (found) => live && setMissing(new Set(ids.filter((id) => !found.has(id)))),
      // Storage that cannot be read shows its own banner; it does not make every photo missing.
      () => {},
    );
    return () => {
      live = false;
    };
  }, [album.photos]);

  const index = Math.min(spreadIndex, album.spreads.length - 1);
  const total = album.spreads.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCropping(null);
        armedPhoto.value = null;
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) store.undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') store.redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  const select = (i: number) => {
    setSelected(null);
    setCropping(null);
    setSpreadIndex(Math.min(Math.max(i, 0), store.album.value.spreads.length - 1));
  };
  const go = (d: number) => select(index + d);
  const saveFile = async () => {
    // The file carries its own save time, so an album opened from it counts as saved then.
    const at = Date.now();
    try {
      await saveLayoutFile({ ...store.album.value, lastFileSaveAt: at });
      // The save time is not an edit: it gets no undo step.
      store.replace({ ...store.album.value, lastFileSaveAt: at });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      alert(strings.saveFileError(e instanceof Error ? e.message : String(e)));
    }
  };
  const relinked = useCallback((ids: string[]) => {
    forgetPreviews(ids);
    setMissing((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
  }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closePreview = useCallback((at: number) => {
    setPreviewing(false);
    select(at);
  }, []);

  if (previewing) return <PreviewMode store={store} startIndex={index} onClose={closePreview} />;

  const selectedCell = selected && album.spreads.find((s) => s.id === selected.spreadId)?.cells[selected.cellIndex];
  const spread = (
    <>
      <Banners album={album} storageError={storageError} onSaveFile={() => void saveFile()} />
      <SpreadView
        store={store}
        spreadIndex={index}
        selected={selected}
        onSelect={(ref) => {
          setSelected(ref);
          if (!ref || !cropping || ref.cellIndex !== cropping.cellIndex || ref.spreadId !== cropping.spreadId) setCropping(null);
        }}
        cropping={cropping}
        onCrop={(ref) => {
          setCropping(ref);
          if (ref) setSelected(ref);
        }}
        missing={missing}
        onFindPhoto={(id) => setRelinking([id])}
      />
      {selected && selectedCell?.photoId && (
        <CellToolbar
          store={store}
          cellRef={selected}
          cropping={cropping !== null}
          onCropChange={(on) => setCropping(on ? selected : null)}
        />
      )}
    </>
  );
  const printSummary = <PrintSummary album={album} missing={missing} />;
  const photoPanel = <PhotoPanel store={store} missing={missing} onFindPhotos={setRelinking} />;
  const templatePanel = <TemplatePanel store={store} spreadIndex={index} />;
  const spreadStrip = <SpreadStrip store={store} spreadIndex={index} onSelect={select} />;
  const settings = settingsOpen && <SettingsDialog store={store} onClose={closeSettings} />;
  // A phone is a touch screen in the narrow layout; a narrow window with a mouse exports spreads.
  const phone = !desktop && window.matchMedia(COARSE_POINTER_QUERY).matches;
  const exportDialog = exporting && <ExportDialog store={store} mobile={phone} onClose={() => setExporting(false)} />;
  const relinkDialog = relinking && (
    <RelinkDialog store={store} photoIds={relinking} onRelinked={relinked} onClose={() => setRelinking(null)} />
  );

  const topBar = (
    <header class="top-bar">
      <button type="button" onClick={onClose}>
        {strings.backToAlbums}
      </button>
      <h1 class="album-title" data-testid="album-title">
        {album.name}
      </h1>
      {!desktop && (
        <span class="spread-nav">
          <button type="button" aria-label={strings.prevSpread} disabled={index === 0} onClick={() => go(-1)}>
            ‹
          </button>
          <span data-testid="spread-position">{index === 0 ? strings.cover : strings.spreadPosition(index, total)}</span>
          <button type="button" aria-label={strings.nextSpread} disabled={index === total} onClick={() => go(1)}>
            ›
          </button>
        </span>
      )}
      <span class="history">
        <button type="button" data-testid="undo" disabled={!store.canUndo.value} onClick={() => store.undo()}>
          {strings.undo}
        </button>
        <button type="button" data-testid="redo" disabled={!store.canRedo.value} onClick={() => store.redo()}>
          {strings.redo}
        </button>
      </span>
      <span class="actions">
        <button
          type="button"
          data-testid="action-settings"
          aria-pressed={settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          {strings.settings}
        </button>
        <button
          type="button"
          data-testid="action-preview"
          onClick={() => {
            setSettingsOpen(false);
            setCropping(null);
            setPreviewing(true);
          }}
        >
          {strings.preview}
        </button>
        <button type="button" data-testid="action-save-file" onClick={() => void saveFile()}>
          {strings.saveFile}
        </button>
        <button type="button" data-testid="action-open-file" onClick={onOpenFile}>
          {strings.openFile}
        </button>
        <button
          type="button"
          data-testid="action-export"
          onClick={() => {
            setSettingsOpen(false);
            setExporting(true);
          }}
        >
          {strings.export}
        </button>
      </span>
    </header>
  );

  if (desktop) {
    return (
      <div class="editor desktop" data-testid="editor">
        {topBar}
        {photoPanel}
        <section class="spread-area">
          {spread}
          {printSummary}
        </section>
        {templatePanel}
        {spreadStrip}
        {settings}
        {exportDialog}
        {relinkDialog}
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'photos', label: strings.tabPhotos },
    { id: 'templates', label: strings.tabTemplates },
    { id: 'spreads', label: strings.tabSpreads },
  ];
  return (
    <div class="editor mobile" data-testid="editor">
      {topBar}
      <section class="spread-area">{spread}</section>
      <div class="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div class="tab-panel">
        {tab === 'photos' && photoPanel}
        {tab === 'templates' && templatePanel}
        {tab === 'spreads' && spreadStrip}
      </div>
      {printSummary}
      {settings}
      {exportDialog}
      {relinkDialog}
    </div>
  );
}
