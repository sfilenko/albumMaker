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

// The File System Access pickers are not in every browser, nor in the DOM typings.
interface PickerWindow {
  showSaveFilePicker?: (o: {
    suggestedName: string;
    types: { accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> }>;
  showOpenFilePicker?: (o: { types: { accept: Record<string, string[]> }[] }) => Promise<{ getFile(): Promise<File> }[]>;
}

const pickers = () => window as unknown as PickerWindow;

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

const fileName = (a: Album) => `${a.name.replace(/[\\/:*?"<>|]/g, '_') || 'album'}${EXTENSION}`;

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
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName(a);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return Date.now();
}

function pickWithInput(): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) resolve(f);
      else reject(new DOMException('no file chosen', 'AbortError'));
    });
    input.addEventListener('cancel', () => reject(new DOMException('no file chosen', 'AbortError')));
    input.click();
  });
}

export async function openLayoutFile(): Promise<Album> {
  const { showOpenFilePicker } = pickers();
  const file = showOpenFilePicker
    ? await (await showOpenFilePicker({ types: [{ accept: { 'application/json': ['.json'] } }] }))[0].getFile()
    : await pickWithInput();
  return parseLayout(await file.text());
}
