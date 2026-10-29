// Finds the files that the user adds for the photos of a layout from another device.
import type { PhotoMeta } from '../model/types';

export interface Candidate { name: string; size: number; width: number; height: number; takenAt: string | null }

const RATIO_TOLERANCE = 0.01;

const stem = (name: string) => name.replace(/\.[^.]*$/, '').toLowerCase();

function sameRatio(a: { width: number; height: number }, b: { width: number; height: number }): boolean {
  const ra = a.width / a.height;
  const rb = b.width / b.height;
  return Math.abs(ra - rb) / rb <= RATIO_TOLERANCE;
}

// The matching ladder of the plan's Decision Log, strictest level first.
const LEVELS: ((w: PhotoMeta, c: Candidate) => boolean)[] = [
  (w, c) => w.name === c.name && w.size === c.size,
  (w, c) => w.name === c.name && w.width === c.width && w.height === c.height,
  (w, c) =>
    stem(w.name) === stem(c.name) &&
    sameRatio(w, c) &&
    (w.takenAt === null || c.takenAt === null || w.takenAt === c.takenAt),
  (w, c) => w.takenAt !== null && w.takenAt === c.takenAt && sameRatio(w, c),
];

/**
 * `matched` maps a photo id to a candidate index. A level accepts only pairs that are unique
 * in both directions. A photo that has two or more candidates at the first level where it has
 * any, or that shares its only candidate with another photo, goes to `ambiguous` for a manual
 * choice. A photo with no candidate at any level is `missing`.
 */
export function matchPhotos(
  wanted: PhotoMeta[],
  candidates: Candidate[],
): { matched: Map<string, number>; missing: string[]; ambiguous: string[] } {
  const matched = new Map<string, number>();
  const ambiguous = new Set<string>();
  const used = new Set<number>();

  for (const fits of LEVELS) {
    const open = wanted.filter((w) => !matched.has(w.id) && !ambiguous.has(w.id));
    const options = new Map<string, number[]>();
    const claims = new Map<number, number>();
    for (const w of open) {
      const hits = candidates.flatMap((c, i) => (!used.has(i) && fits(w, c) ? [i] : []));
      if (hits.length === 0) continue;
      options.set(w.id, hits);
      for (const i of hits) claims.set(i, (claims.get(i) ?? 0) + 1);
    }
    for (const [id, hits] of options) {
      if (hits.length === 1 && claims.get(hits[0]) === 1) {
        matched.set(id, hits[0]);
        used.add(hits[0]);
      } else {
        ambiguous.add(id);
      }
    }
  }

  const missing = wanted.filter((w) => !matched.has(w.id) && !ambiguous.has(w.id)).map((w) => w.id);
  return { matched, missing, ambiguous: [...ambiguous] };
}
