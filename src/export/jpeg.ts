// Print resolution in the JPEG header. Canvas encoders write 72 or 96 dpi, or none.

const SOI = [0xff, 0xd8];
const APP0 = [0xff, 0xe0];
const JFIF = [0x4a, 0x46, 0x49, 0x46, 0x00];

// Byte offsets inside a file that starts with SOI and then the JFIF APP0 segment.
const UNITS_AT = 13;
const UNITS_DPI = 1;

const hasAt = (bytes: Uint8Array, at: number, want: number[]) => want.every((b, i) => bytes[at + i] === b);

/**
 * Sets the JFIF density to `dpi` in both directions. A file without a JFIF APP0 segment gets
 * one after SOI (18 bytes). The input is not changed.
 */
export function setJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array<ArrayBuffer> {
  if (!hasAt(bytes, 0, SOI)) throw new Error('Not a JPEG file');
  const hi = (dpi >> 8) & 0xff;
  const lo = dpi & 0xff;

  if (hasAt(bytes, 2, APP0) && hasAt(bytes, 6, JFIF)) {
    const out = bytes.slice();
    out.set([UNITS_DPI, hi, lo, hi, lo], UNITS_AT);
    return out;
  }

  // Length 16 counts itself; version 1.01; no thumbnail.
  const segment = [...APP0, 0x00, 0x10, ...JFIF, 0x01, 0x01, UNITS_DPI, hi, lo, hi, lo, 0x00, 0x00];
  const out = new Uint8Array(bytes.length + segment.length);
  out.set(SOI, 0);
  out.set(segment, 2);
  out.set(bytes.subarray(2), 2 + segment.length);
  return out;
}
