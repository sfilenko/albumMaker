// Banners above the spread that protect against data loss: a storage error, the Home Screen
// hint on iPhone and the reminder to save the layout to a file. A short print warnings summary
// shows apart from them, where it takes no room from the spread on a phone.
import { useEffect, useState } from 'preact/hooks';
import { printWarnings } from '../model/pages';
import type { Album } from '../model/types';
import { strings } from './strings';

const BACKUP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const CLOCK_TICK_MS = 60 * 1000;
const IOS_HINT_CLOSED_KEY = 'iosInstallHintClosed';

function isIos(): boolean {
  // iPadOS reports a Mac, but a Mac has no touch screen.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function iosHintClosed(): boolean {
  try {
    return localStorage.getItem(IOS_HINT_CLOSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** The time now, again each minute, so a banner that depends on the clock shows without an edit. */
function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** An album that was never saved to a file counts from its creation. */
function needsBackup(a: Album, now: number): boolean {
  const since = a.lastFileSaveAt ?? a.createdAt;
  return now - since > BACKUP_AFTER_MS && a.updatedAt > since;
}

function printSummary(a: Album, missing: ReadonlySet<string>): string | null {
  const available = new Set(a.photos.filter((p) => !missing.has(p.id)).map((p) => p.id));
  const warnings = printWarnings(a, available);
  const count = (kind: string) => warnings.filter((w) => w.kind === kind).length;
  const parts: string[] = [];
  for (const w of warnings) if (w.kind === 'min-pages') parts.push(strings.summaryMinPages(w.pages));
  if (count('low-dpi') > 0) parts.push(strings.summaryLowDpi(count('low-dpi')));
  if (count('unprinted-photo') > 0) parts.push(strings.summaryUnprinted(count('unprinted-photo')));
  if (count('missing-photo') > 0) parts.push(strings.summaryMissing(count('missing-photo')));
  return parts.length > 0 ? strings.printSummary(parts) : null;
}

/** The print warnings in one line: page count, low quality, unprinted and missing photos. */
export function PrintSummary({ album, missing }: { album: Album; missing: ReadonlySet<string> }) {
  const summary = printSummary(album, missing);
  if (summary === null) return null;
  return (
    <div class="banner info" data-testid="banner-print-warnings">
      <span>{summary}</span>
    </div>
  );
}

export function Banners({ album, storageError, onSaveFile }: { album: Album; storageError: boolean; onSaveFile: () => void }) {
  const now = useNow();
  const [iosHint, setIosHint] = useState(() => isIos() && !isStandalone() && !iosHintClosed());

  const closeIosHint = () => {
    setIosHint(false);
    try {
      localStorage.setItem(IOS_HINT_CLOSED_KEY, '1');
    } catch {
      // Storage is off: the hint shows again on the next start.
    }
  };

  const saveButton = (id: string) => (
    <button type="button" class="primary" data-testid={`${id}-save`} onClick={onSaveFile}>
      {strings.saveFile}
    </button>
  );

  return (
    <div class="banners">
      {storageError && (
        <div class="banner error" role="alert" data-testid="banner-storage-error">
          <span>{strings.storageError}</span>
          {saveButton('banner-storage-error')}
        </div>
      )}
      {iosHint && (
        <div class="banner" data-testid="banner-ios-install">
          <span>{strings.iosInstallHint}</span>
          <button type="button" aria-label={strings.close} data-testid="banner-ios-install-close" onClick={closeIosHint}>
            ×
          </button>
        </div>
      )}
      {!storageError && needsBackup(album, now) && (
        <div class="banner" data-testid="banner-backup">
          <span>{strings.backupReminder}</span>
          {saveButton('banner-backup')}
        </div>
      )}
    </div>
  );
}
