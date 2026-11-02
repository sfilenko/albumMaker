// The layout file (.album.json): the album without the photos.
import type { Album } from '../model/types';

const FORMAT = 'album-builder';
const VERSION = 1;
const EXTENSION = '.album.json';

/** `reason` lets the interface show its own message for each case. */
export class LayoutFileError extends Error {
  constructor(readonly reason: 'json' | 'format' | 'version' | 'album') {
    super(`invalid layout file: ${reason}`);
    this.name = 'LayoutFileError';
  }
}

/** The part of a file handle that a write uses. `FileSystemFileHandle` fits this type. */
export interface WritableFile {
  createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}

// The File System Access pickers are not in every browser, nor in the DOM typings.
export interface PickerWindow {
  showSaveFilePicker?: (o: {
    suggestedName: string;
    types: { accept: Record<string, string[]> }[];
  }) => Promise<WritableFile>;
  showOpenFilePicker?: (o: { types: { accept: Record<string, string[]> }[] }) => Promise<{ getFile(): Promise<File> }[]>;
  showDirectoryPicker?: (o: { mode: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

const pickers = () => window as unknown as PickerWindow;

/** The folder picker of this browser. A browser with no folder picker gives `undefined`. */
export const folderPicker = () => pickers().showDirectoryPicker;

export function serializeLayout(a: Album): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, album: a });
}

export function parseLayout(text: string): Album {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new LayoutFileError('json');
  }
  const file = data as { format?: unknown; version?: unknown; album?: unknown } | null;
  if (typeof file !== 'object' || file === null || file.format !== FORMAT) throw new LayoutFileError('format');
  if (file.version !== VERSION) throw new LayoutFileError('version');
  const album = file.album as Partial<Album> | null | undefined;
  if (typeof album !== 'object' || album === null || typeof album.id !== 'string' || !Array.isArray(album.spreads)) {
    throw new LayoutFileError('album');
  }
  return album as Album;
}

/** The album name for a file name: `_` replaces each mark that a file name cannot hold. No name gives `album`. */
export function safeBaseName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_') || 'album';
}

const fileName = (a: Album) => `${safeBaseName(a.name)}${EXTENSION}`;

/** Starts a download. The object URL stays valid for `lifetimeMs`. */
export function downloadBlob(blob: Blob, name: string, lifetimeMs: number): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), lifetimeMs);
}

/** Writes the layout file and returns the save time. */
export async function saveLayoutFile(a: Album): Promise<number> {
  const blob = new Blob([serializeLayout(a)], { type: 'application/json' });
  const { showSaveFilePicker } = pickers();
  if (showSaveFilePicker) {
    const handle = await showSaveFilePicker({
      suggestedName: fileName(a),
      types: [{ accept: { 'application/json': [EXTENSION] } }],
    });
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
  } else {
    downloadBlob(blob, fileName(a), 0);
  }
  return Date.now();
}

function pickWithInput(): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json,.zip,application/zip';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) resolve(f);
      else reject(new DOMException('no file chosen', 'AbortError'));
    });
    input.addEventListener('cancel', () => reject(new DOMException('no file chosen', 'AbortError')));
    input.click();
  });
}

// The wait of the running picker. A browser rejects a second picker call while a picker is open.
let runningPicker: Promise<File> | null = null;

async function pickWithPicker(show: NonNullable<PickerWindow['showOpenFilePicker']>): Promise<File> {
  const [handle] = await show({
    types: [{ accept: { 'application/json': ['.json'], 'application/zip': ['.zip'] } }],
  });
  return handle.getFile();
}

/**
 * A layout file or an album archive, which the person chooses. A cancel rejects with an `AbortError`.
 * A call while a picker is open gets the promise of that picker, so each caller gets the same file or
 * the same error. The file input has no kept promise: a browser with no cancel event never ends its wait.
 */
export function pickAlbumFile(): Promise<File> {
  const { showOpenFilePicker } = pickers();
  if (!showOpenFilePicker) return pickWithInput();
  runningPicker ??= pickWithPicker(showOpenFilePicker).finally(() => {
    runningPicker = null;
  });
  return runningPicker;
}
