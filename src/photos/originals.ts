// Access to the original photo files, which only the export needs.
import type { PhotoMeta } from '../model/types';
import { getDirHandle } from '../storage/db';

// The permission members of the File System Access API, not in the DOM typings.
interface ReadableDir extends FileSystemDirectoryHandle {
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' }): Promise<PermissionState>;
}

// Photo id → original file, for this session only.
const memory = new Map<string, File>();

export function registerOriginals(files: Map<string, File>): void {
  for (const [id, file] of files) memory.set(id, file);
}

async function canRead(dir: ReadableDir): Promise<boolean> {
  if ((await dir.queryPermission?.({ mode: 'read' })) === 'granted') return true;
  try {
    return (await dir.requestPermission?.({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}

/** The original from this session, else from the album's stored folder, matched by name and size. */
export async function getOriginal(albumId: string, meta: PhotoMeta): Promise<File | null> {
  const known = memory.get(meta.id);
  if (known) return known;
  const dir = (await getDirHandle(albumId)) as ReadableDir | undefined;
  if (!dir || !(await canRead(dir))) return null;
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || entry.name !== meta.name) continue;
    const file = await (entry as FileSystemFileHandle).getFile();
    if (file.size === meta.size) {
      memory.set(meta.id, file);
      return file;
    }
  }
  return null;
}
