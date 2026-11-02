// The album archive (.album.zip): the layout and the original photos in one standard ZIP.
// fflate keeps all data in memory, and 1.5 GB does not fit on a phone. So this module writes and
// reads the ZIP structures itself. A write makes a Blob that refers to the files. A read uses
// Blob.slice. No code here keeps a whole photo in memory.
import { photoUsage } from '../model/album';
import type { Album, PhotoMeta } from '../model/types';
import { downloadBlob, parseLayout, safeBaseName, serializeLayout, type PickerWindow, type WritableFile } from './layoutFile';

const EXTENSION = '.album.zip';
const LAYOUT_ENTRY = 'album.json';
const PHOTOS_FOLDER = 'photos/';
const SLICE_BYTES = 1024 * 1024;
// The browser can ask the person about a download first, so the link stays valid for a long time.
// The Blob refers to the files, so it keeps almost nothing in memory.
const LINK_LIFETIME_MS = 10 * 60_000;

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_RECORD_BYTES = 22;

// The fields from the version to the name length have one form in the local and the central header.
// These positions start at the version field.
const SHARED_FLAGS_AT = 2;
const SHARED_METHOD_AT = 4;
const SHARED_TIME_AT = 6;
const SHARED_DATE_AT = 8;
const SHARED_CRC_AT = 10;
const SHARED_PACKED_AT = 14;
const SHARED_SIZE_AT = 18;
const SHARED_NAME_BYTES_AT = 22;

const LOCAL_SHARED_AT = 4;
const LOCAL_NAME_BYTES_AT = LOCAL_SHARED_AT + SHARED_NAME_BYTES_AT;
const LOCAL_EXTRA_BYTES_AT = LOCAL_NAME_BYTES_AT + 2;

const CENTRAL_MADE_BY_AT = 4;
const CENTRAL_SHARED_AT = 6;
const CENTRAL_FLAGS_AT = CENTRAL_SHARED_AT + SHARED_FLAGS_AT;
const CENTRAL_METHOD_AT = CENTRAL_SHARED_AT + SHARED_METHOD_AT;
const CENTRAL_CRC_AT = CENTRAL_SHARED_AT + SHARED_CRC_AT;
const CENTRAL_PACKED_AT = CENTRAL_SHARED_AT + SHARED_PACKED_AT;
const CENTRAL_SIZE_AT = CENTRAL_SHARED_AT + SHARED_SIZE_AT;
const CENTRAL_NAME_BYTES_AT = CENTRAL_SHARED_AT + SHARED_NAME_BYTES_AT;
const CENTRAL_EXTRA_BYTES_AT = CENTRAL_NAME_BYTES_AT + 2;
const CENTRAL_COMMENT_BYTES_AT = CENTRAL_EXTRA_BYTES_AT + 2;
const CENTRAL_OFFSET_AT = 42;

const MAX_COMMENT_BYTES = 0xffff;
const ZIP_VERSION = 20;
const ENCRYPTED_FLAG = 0x0001;
const UTF8_NAME_FLAG = 0x0800;
const METHOD_STORED = 0;

// ZIP without ZIP64. The value 0xffffffff in a size or offset field is the ZIP64 marker.
const MAX_ENTRIES = 0xffff;
const MAX_ZIP_BYTES = 0xffffffff;
// The two headers of an entry and its name, written twice. A file name has at most 765 UTF-8 bytes.
const ENTRY_MARGIN_BYTES = 2048;

const PHOTO_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export type ArchiveErrorReason = 'zip' | 'content' | 'damaged' | 'too-large';

/** `reason` lets the interface show its own message for each case. */
export class ArchiveError extends Error {
  constructor(readonly reason: ArchiveErrorReason) {
    super(`archive error: ${reason}`);
    this.name = 'ArchiveError';
  }
}

/** A photo file that could not be read during the build. */
export class UnreadablePhotoError extends Error {
  constructor(readonly photoId: string) {
    super(`The app cannot read the original file of photo ${photoId}`);
    this.name = 'UnreadablePhotoError';
  }
}

type Progress = (done: number, total: number) => void;

export interface OpenedArchive {
  album: Album;
  /** One file per photo, named as the photo. Each one refers to a part of the archive. */
  originals: Map<string, File>;
  /** The CRC-32 of each photo, by photo id, from the directory of the ZIP. */
  expectedCrc: Map<string, number>;
  /**
   * Compares the CRC-32 of each photo. Throws ArchiveError('damaged'). A failed read of the file
   * rejects with the browser's DOMException. `done` and `total` count bytes.
   */
  verify(onProgress: Progress): Promise<void>;
}

/** Two names with one key are one name, because a file system can ignore case. */
export function nameKey(name: string): string {
  return name.toLowerCase();
}

/**
 * Returns `name` when it is free. Else it adds `-2`, `-3` and so on before the extension. The result
 * goes into `taken`.
 */
export function freeName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  let free = name;
  for (let n = 2; taken.has(nameKey(free)); n++) free = `${stem}-${n}${extension}`;
  taken.add(nameKey(free));
  return free;
}

/** A name that stays in its folder: it is not empty, not `.` or `..`, and it holds no slash or backslash. */
export function isPlainName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[\\/]/.test(name);
}

/**
 * A plain name, which readArchive accepts. A file system can still refuse it, for example `a:b.jpg`
 * on Windows. The open handles that case when it writes to the folder.
 */
function safePhotoName(name: string): string {
  const safe = name.replace(/[\\/]/g, '_');
  return isPlainName(safe) ? safe : '_';
}

/** The photos that the archive holds: each photo in a cell, also on a cover or on an unprinted half. */
export function archivablePhotos(a: Album): PhotoMeta[] {
  const usage = photoUsage(a);
  return a.photos.filter((p) => usage.has(p.id));
}

/**
 * The album as an archive holds it: only used photos, each photo with a unique file name, and
 * `lastFileSaveAt` set to `savedAt`. In a name, `_` replaces each slash and each backslash. `_` also
 * replaces a whole name of `.` or `..`, and an empty name.
 */
export function archivableAlbum(a: Album, savedAt: number): Album {
  const used = archivablePhotos(a).map((p) => ({ ...p, name: safePhotoName(p.name) }));
  // Each existing name stays reserved, so that a new name never takes the name of a later photo.
  const taken = new Set(used.map((p) => nameKey(p.name)));
  const seen = new Set<string>();
  const photos = used.map((p): PhotoMeta => {
    const key = nameKey(p.name);
    if (!seen.has(key)) {
      seen.add(key);
      return p;
    }
    return { ...p, name: freeName(p.name, taken) };
  });
  return { ...a, photos, lastFileSaveAt: savedAt };
}

export function archiveFileName(a: Album): string {
  return `${safeBaseName(a.name)}${EXTENSION}`;
}

/**
 * `sizes` holds the content size of each entry, and the layout is one of these entries.
 * Throws ArchiveError('too-large') when the sizes, the headers and the entry count do not fit in a ZIP without ZIP64.
 */
export function assertFitsArchive(sizes: number[]): void {
  let bytes = END_RECORD_BYTES;
  for (const size of sizes) bytes += size + ENTRY_MARGIN_BYTES;
  if (sizes.length > MAX_ENTRIES || bytes >= MAX_ZIP_BYTES) throw new ArchiveError('too-large');
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** Reads the blob in slices. `onBytes` gets the count of bytes that the function read until now. */
export async function crc32OfBlob(blob: Blob, onBytes?: (n: number) => void): Promise<number> {
  let crc = 0xffffffff;
  for (let start = 0; start < blob.size; start += SLICE_BYTES) {
    const bytes = new Uint8Array(await blob.slice(start, start + SLICE_BYTES).arrayBuffer());
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    onBytes?.(start + bytes.length);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Gives `onCrc` the CRC-32 of each file, in order. `done` and `total` count the bytes of all files. */
async function crcOfEachFile(files: File[], onProgress: Progress, onCrc: (crc: number, index: number) => void): Promise<void> {
  const total = files.reduce((sum, f) => sum + f.size, 0);
  let done = 0;
  onProgress(0, total);
  for (const [i, file] of files.entries()) {
    onCrc(await crc32OfBlob(file, (n) => onProgress(done + n, total)), i);
    done += file.size;
  }
}

/** The ZIP time and date fields, in local time. A ZIP cannot hold a year out of 1980 to 2107. */
function dosStamp(ms: number): { time: number; date: number } {
  const d = new Date(ms);
  const year = d.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };
  if (year > 2107) return { time: (23 << 11) | (59 << 5) | 29, date: (127 << 9) | (12 << 5) | 31 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

interface WrittenEntry { name: Uint8Array<ArrayBuffer>; crc: number; size: number; modified: number; offset: number }

function writeSharedFields(v: DataView, at: number, e: WrittenEntry): void {
  const { time, date } = dosStamp(e.modified);
  v.setUint16(at, ZIP_VERSION, true);
  v.setUint16(at + SHARED_FLAGS_AT, UTF8_NAME_FLAG, true);
  v.setUint16(at + SHARED_METHOD_AT, METHOD_STORED, true);
  v.setUint16(at + SHARED_TIME_AT, time, true);
  v.setUint16(at + SHARED_DATE_AT, date, true);
  v.setUint32(at + SHARED_CRC_AT, e.crc, true);
  v.setUint32(at + SHARED_PACKED_AT, e.size, true);
  v.setUint32(at + SHARED_SIZE_AT, e.size, true);
  v.setUint16(at + SHARED_NAME_BYTES_AT, e.name.length, true);
}

function localHeader(e: WrittenEntry): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(LOCAL_HEADER_BYTES + e.name.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, LOCAL_SIGNATURE, true);
  writeSharedFields(v, LOCAL_SHARED_AT, e);
  out.set(e.name, LOCAL_HEADER_BYTES);
  return out;
}

function centralHeader(e: WrittenEntry): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(CENTRAL_HEADER_BYTES + e.name.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, CENTRAL_SIGNATURE, true);
  v.setUint16(CENTRAL_MADE_BY_AT, ZIP_VERSION, true);
  writeSharedFields(v, CENTRAL_SHARED_AT, e);
  v.setUint32(CENTRAL_OFFSET_AT, e.offset, true);
  out.set(e.name, CENTRAL_HEADER_BYTES);
  return out;
}

function endRecord(entries: number, directoryBytes: number, directoryStart: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(END_RECORD_BYTES);
  const v = new DataView(out.buffer);
  v.setUint32(0, END_SIGNATURE, true);
  v.setUint16(8, entries, true);
  v.setUint16(10, entries, true);
  v.setUint32(12, directoryBytes, true);
  v.setUint32(16, directoryStart, true);
  return out;
}

/**
 * `a` comes from archivableAlbum. `originals` maps a photo id to its file. `album.json` gets each
 * photo `size` from its file. The Blob refers to the files. `done` and `total` count bytes of the
 * photos. Throws UnreadablePhotoError or ArchiveError('too-large').
 */
export async function buildArchive(
  a: Album,
  originals: Map<string, File>,
  onProgress: Progress,
): Promise<Blob> {
  const files = a.photos.map((p) => {
    const file = originals.get(p.id);
    if (!file) throw new UnreadablePhotoError(p.id);
    return file;
  });
  const encoder = new TextEncoder();
  const layout = encoder.encode(serializeLayout({ ...a, photos: a.photos.map((p, i) => ({ ...p, size: files[i].size })) }));
  assertFitsArchive([layout.length, ...files.map((f) => f.size)]);

  const crcs: number[] = [];
  try {
    await crcOfEachFile(files, onProgress, (crc) => crcs.push(crc));
  } catch (e) {
    // A failed read is a DOMException. `crcs` has one value for each file before the failed file.
    if (e instanceof DOMException) throw new UnreadablePhotoError(a.photos[crcs.length].id);
    throw e;
  }

  const parts: BlobPart[] = [];
  const entries: WrittenEntry[] = [];
  let offset = 0;
  const addEntry = (name: string, content: BlobPart, size: number, crc: number, modified: number) => {
    const entry: WrittenEntry = { name: encoder.encode(name), crc, size, modified, offset };
    const header = localHeader(entry);
    parts.push(header, content);
    entries.push(entry);
    offset += header.length + size;
  };
  // archivableAlbum always sets the save time. Only the type of Album allows null here.
  const savedAt = a.lastFileSaveAt ?? a.updatedAt;
  addEntry(LAYOUT_ENTRY, layout, layout.length, await crc32OfBlob(new Blob([layout])), savedAt);
  a.photos.forEach((p, i) => addEntry(PHOTOS_FOLDER + p.name, files[i], files[i].size, crcs[i], files[i].lastModified));

  let directoryBytes = 0;
  for (const entry of entries) {
    const header = centralHeader(entry);
    parts.push(header);
    directoryBytes += header.length;
  }
  parts.push(endRecord(entries.length, directoryBytes, offset));
  return new Blob(parts, { type: 'application/zip' });
}

/** True when the file starts with the signature of a ZIP entry or of the end record of an empty ZIP. */
export async function isZip(file: Blob): Promise<boolean> {
  const head = new DataView(await file.slice(0, 4).arrayBuffer());
  if (head.byteLength < 4) return false;
  const signature = head.getUint32(0, true);
  return signature === LOCAL_SIGNATURE || signature === END_SIGNATURE;
}

interface ReadEntry { crc: number; size: number; offset: number }

/** The position of the end record in `tail`, the last part of the file. The ZIP comment must reach the end of the file. */
function findEndRecord(tail: DataView): number {
  const reachesEndOfFile = (at: number) => at + END_RECORD_BYTES + tail.getUint16(at + 20, true) === tail.byteLength;
  for (let at = tail.byteLength - END_RECORD_BYTES; at >= 0; at--) {
    if (tail.getUint32(at, true) === END_SIGNATURE && reachesEndOfFile(at)) return at;
  }
  throw new ArchiveError('zip');
}

async function readDirectory(file: Blob): Promise<{ entries: Map<string, ReadEntry>; directoryStart: number }> {
  const tailStart = Math.max(0, file.size - END_RECORD_BYTES - MAX_COMMENT_BYTES);
  const tail = new DataView(await file.slice(tailStart).arrayBuffer());
  const end = findEndRecord(tail);
  if (tail.getUint16(end + 4, true) !== 0 || tail.getUint16(end + 6, true) !== 0) throw new ArchiveError('zip');
  const count = tail.getUint16(end + 10, true);
  const directoryBytes = tail.getUint32(end + 12, true);
  const directoryStart = tail.getUint32(end + 16, true);
  if (directoryStart + directoryBytes > tailStart + end) throw new ArchiveError('zip');

  const directory = new DataView(await file.slice(directoryStart, directoryStart + directoryBytes).arrayBuffer());
  const decoder = new TextDecoder();
  const entries = new Map<string, ReadEntry>();
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + CENTRAL_HEADER_BYTES > directory.byteLength || directory.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new ArchiveError('zip');
    }
    const flags = directory.getUint16(at + CENTRAL_FLAGS_AT, true);
    const method = directory.getUint16(at + CENTRAL_METHOD_AT, true);
    const packed = directory.getUint32(at + CENTRAL_PACKED_AT, true);
    const size = directory.getUint32(at + CENTRAL_SIZE_AT, true);
    if (flags & ENCRYPTED_FLAG || method !== METHOD_STORED || packed !== size) throw new ArchiveError('zip');
    const nameBytes = directory.getUint16(at + CENTRAL_NAME_BYTES_AT, true);
    const next =
      at +
      CENTRAL_HEADER_BYTES +
      nameBytes +
      directory.getUint16(at + CENTRAL_EXTRA_BYTES_AT, true) +
      directory.getUint16(at + CENTRAL_COMMENT_BYTES_AT, true);
    if (next > directory.byteLength) throw new ArchiveError('zip');
    const name = decoder.decode(new Uint8Array(directory.buffer, at + CENTRAL_HEADER_BYTES, nameBytes));
    entries.set(name, { crc: directory.getUint32(at + CENTRAL_CRC_AT, true), size, offset: directory.getUint32(at + CENTRAL_OFFSET_AT, true) });
    at = next;
  }
  return { entries, directoryStart };
}

/** The content of an entry, as a part of the file. The local header gives the start of the content. */
async function entryContent(file: Blob, entry: ReadEntry, directoryStart: number, type = ''): Promise<Blob> {
  const header = new DataView(await file.slice(entry.offset, entry.offset + LOCAL_HEADER_BYTES).arrayBuffer());
  if (header.byteLength < LOCAL_HEADER_BYTES || header.getUint32(0, true) !== LOCAL_SIGNATURE) throw new ArchiveError('zip');
  const start = entry.offset + LOCAL_HEADER_BYTES + header.getUint16(LOCAL_NAME_BYTES_AT, true) + header.getUint16(LOCAL_EXTRA_BYTES_AT, true);
  if (start + entry.size > directoryStart) throw new ArchiveError('zip');
  return file.slice(start, start + entry.size, type);
}

const photoType = (name: string) => PHOTO_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? '';

/**
 * Reads the directory and the layout only. Throws ArchiveError or LayoutFileError. A failed read of
 * the file rejects with the browser's DOMException. The app finds a photo only by its `meta.name`,
 * and it never uses an entry path as a path to write.
 */
export async function readArchive(file: Blob): Promise<OpenedArchive> {
  const { entries, directoryStart } = await readDirectory(file);
  const layoutEntry = entries.get(LAYOUT_ENTRY);
  if (!layoutEntry) throw new ArchiveError('content');
  const layout = await entryContent(file, layoutEntry, directoryStart);
  if ((await crc32OfBlob(layout)) !== layoutEntry.crc) throw new ArchiveError('damaged');
  const album = parseLayout(await layout.text());
  if (!Array.isArray(album.photos)) throw new ArchiveError('content');

  const originals = new Map<string, File>();
  const crcs = new Map<string, number>();
  for (const p of album.photos) {
    if (typeof p?.name !== 'string' || /[\\/]/.test(p.name)) throw new ArchiveError('content');
    const entry = entries.get(PHOTOS_FOLDER + p.name);
    if (!entry || entry.size !== p.size) throw new ArchiveError('content');
    const type = photoType(p.name);
    const content = await entryContent(file, entry, directoryStart, type);
    originals.set(p.id, new File([content], p.name, { type, lastModified: p.lastModified }));
    crcs.set(p.id, entry.crc);
  }

  return {
    album,
    originals,
    expectedCrc: crcs,
    async verify(onProgress) {
      const photos = [...originals];
      await crcOfEachFile(photos.map(([, original]) => original), onProgress, (crc, i) => {
        if (crc !== crcs.get(photos[i][0])) throw new ArchiveError('damaged');
      });
    },
  };
}

/**
 * Writes in 1 MiB slices. `onBytes` gets the count of bytes that the function wrote until now. A
 * failure calls abort() and rejects with the first error.
 */
export async function writeInSlices(handle: WritableFile, blob: Blob, onBytes: (done: number) => void): Promise<void> {
  const writable = await handle.createWritable();
  try {
    for (let at = 0; at < blob.size; at += SLICE_BYTES) {
      await writable.write(blob.slice(at, at + SLICE_BYTES));
      onBytes(Math.min(at + SLICE_BYTES, blob.size));
    }
    await writable.close();
  } catch (e) {
    // The abort keeps the partial data out of the file. The first failure is the one to show.
    try {
      await writable.abort();
    } catch {
      // The failed write can already have closed the stream.
    }
    throw e;
  }
}

/**
 * Calls the save picker, or starts a download when no picker exists. An AbortError from the picker
 * propagates. The write starts only after the picker resolves, and `onBytes(0)` marks that moment.
 * A browser gives the page no event when a download ends, so that route gives `received`.
 */
export async function saveArchiveBlob(blob: Blob, name: string, onBytes: (done: number) => void): Promise<'saved' | 'received'> {
  const { showSaveFilePicker } = window as unknown as PickerWindow;
  if (!showSaveFilePicker) {
    downloadBlob(blob, name, LINK_LIFETIME_MS);
    return 'received';
  }
  const handle = await showSaveFilePicker({
    suggestedName: name,
    types: [{ accept: { 'application/zip': ['.zip'] } }],
  });
  onBytes(0);
  await writeInSlices(handle, blob, onBytes);
  return 'saved';
}
