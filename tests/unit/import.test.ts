import { expect, test } from 'vitest';
import { isAccepted, mapLimit } from '../../src/photos/import';

test('isAccepted takes jpg, jpeg, png and webp in any case', () => {
  expect(isAccepted('A.JPG')).toBe(true);
  expect(isAccepted('b.jpeg')).toBe(true);
  expect(isAccepted('c.Png')).toBe(true);
  expect(isAccepted('d.webp')).toBe(true);
});

test('isAccepted skips other files', () => {
  expect(isAccepted('notes.txt')).toBe(false);
  expect(isAccepted('x.heic')).toBe(false);
  expect(isAccepted('jpg')).toBe(false);
});

test('mapLimit never runs more than 2 at the same time and keeps the input order', async () => {
  let running = 0;
  let peak = 0;
  const items = Array.from({ length: 10 }, (_, i) => i);
  const out = await mapLimit(items, 2, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, (10 - n) % 3));
    running--;
    return n * 10;
  });
  expect(peak).toBe(2);
  expect(out).toEqual(items.map((n) => n * 10));
});

test('mapLimit with no items returns an empty list', async () => {
  expect(await mapLimit([], 2, async (n: number) => n)).toEqual([]);
});
