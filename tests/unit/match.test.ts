import { expect, test } from 'vitest';
import type { PhotoMeta } from '../../src/model/types';
import { matchPhotos, type Candidate } from '../../src/photos/match';

const meta = (id: string, p: Partial<PhotoMeta>): PhotoMeta => ({
  id,
  name: 'x.jpg',
  size: 1,
  width: 1800,
  height: 1200,
  takenAt: null,
  lastModified: 0,
  ...p,
});
const cand = (p: Partial<Candidate>): Candidate => ({ name: 'x.jpg', size: 1, width: 1800, height: 1200, takenAt: null, ...p });

test('an exact copy matches', () => {
  const r = matchPhotos([meta('a', { name: 'land-1.jpg', size: 500 })], [cand({ name: 'land-1.jpg', size: 500 })]);
  expect(r.matched.get('a')).toBe(0);
  expect(r.missing).toEqual([]);
});

test('IMG_1.HEIC 4032x3024 matches IMG_1.jpg 2016x1512', () => {
  const r = matchPhotos(
    [meta('a', { name: 'IMG_1.HEIC', size: 3_000_000, width: 4032, height: 3024 })],
    [cand({ name: 'IMG_1.jpg', size: 900_000, width: 2016, height: 1512 })],
  );
  expect(r.matched.get('a')).toBe(0);
});

test('a renamed file with the same capture date and ratio matches', () => {
  const r = matchPhotos(
    [meta('a', { name: 'IMG_0042.jpg', size: 10, takenAt: '2026-06-14T15:30:00' })],
    [
      cand({ name: 'other.jpg', size: 99, takenAt: '2026-06-14T16:00:00' }),
      cand({ name: 'photo-123.jpg', size: 20, width: 3600, height: 2400, takenAt: '2026-06-14T15:30:00' }),
    ],
  );
  expect(r.matched.get('a')).toBe(1);
});

test('two IMG_0001.jpg photos match the candidates of the same sizes, in either order', () => {
  const wanted = [meta('a', { name: 'IMG_0001.jpg', size: 100 }), meta('b', { name: 'IMG_0001.jpg', size: 200 })];
  const r = matchPhotos(wanted, [cand({ name: 'IMG_0001.jpg', size: 200 }), cand({ name: 'IMG_0001.jpg', size: 100 })]);
  expect(r.matched.get('a')).toBe(1);
  expect(r.matched.get('b')).toBe(0);
  const s = matchPhotos(wanted, [cand({ name: 'IMG_0001.jpg', size: 100 }), cand({ name: 'IMG_0001.jpg', size: 200 })]);
  expect(s.matched.get('a')).toBe(0);
  expect(s.matched.get('b')).toBe(1);
});

test('two equal candidates for one photo give ambiguous', () => {
  const r = matchPhotos(
    [meta('a', { name: 'IMG_0001.jpg', size: 100 })],
    [cand({ name: 'IMG_0001.jpg', size: 300 }), cand({ name: 'IMG_0001.jpg', size: 400 })],
  );
  expect(r.ambiguous).toEqual(['a']);
  expect(r.matched.size).toBe(0);
  expect(r.missing).toEqual([]);
});

test('a photo with no candidate is missing', () => {
  const r = matchPhotos([meta('a', { name: 'land-1.jpg' })], [cand({ name: 'port-1.jpg', width: 1200, height: 1800 })]);
  expect(r.missing).toEqual(['a']);
});
