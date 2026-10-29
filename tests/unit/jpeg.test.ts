import { expect, test } from 'vitest';
import { setJpegDpi } from '../../src/export/jpeg';

// SOI, then a JFIF APP0 segment at 72 dpi (units 1, density 0x0048), then the start of DQT.
const JFIF_72 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
  0xff, 0xdb,
]);
// SOI, then DQT at once: no APP0 segment.
const NO_APP0 = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);

test('setJpegDpi on a JFIF header sets bytes 13 to 17 to 01 01 2C 01 2C and keeps the length', () => {
  const out = setJpegDpi(JFIF_72, 300);
  expect([...out.subarray(13, 18)]).toEqual([0x01, 0x01, 0x2c, 0x01, 0x2c]);
  expect(out.length).toBe(JFIF_72.length);
  expect([...out.subarray(18)]).toEqual([...JFIF_72.subarray(18)]);
  // The input is not changed.
  expect(JFIF_72[15]).toBe(0x48);
});

test('setJpegDpi without APP0 inserts a JFIF segment after SOI, 18 bytes longer', () => {
  const out = setJpegDpi(NO_APP0, 300);
  expect(out.length).toBe(NO_APP0.length + 18);
  expect([...out.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  expect(new TextDecoder().decode(out.subarray(6, 10))).toBe('JFIF');
  expect([...out.subarray(13, 18)]).toEqual([0x01, 0x01, 0x2c, 0x01, 0x2c]);
  expect([...out.subarray(20)]).toEqual([...NO_APP0.subarray(2)]);
});

test('setJpegDpi refuses bytes that are not a JPEG file', () => {
  expect(() => setJpegDpi(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 300)).toThrow();
});
