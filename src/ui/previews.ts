// Object URLs of the screen copies, shared by the whole app.
import { useEffect, useState } from 'preact/hooks';
import { getPreview, type PreviewKind } from '../storage/db';

const KINDS: PreviewKind[] = ['full', 'thumb'];

const urls = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();
// Mounted hooks, told to load again when a photo gets new screen copies.
const listeners = new Set<() => void>();

function load(photoId: string, kind: PreviewKind): Promise<string | null> {
  const key = `${photoId}:${kind}`;
  let p = pending.get(key);
  if (!p) {
    p = getPreview(photoId, kind).then(
      (blob) => {
        const url = blob ? URL.createObjectURL(blob) : null;
        // A forget during the read makes this result old.
        if (pending.get(key) === p) urls.set(key, url);
        return url;
      },
      () => {
        pending.delete(key);
        return null;
      },
    );
    pending.set(key, p);
  }
  return p;
}

/**
 * Drops what the cache holds for these photos, also "no screen copy". Call it after a relink
 * writes new screen copies under the same ids.
 */
export function forgetPreviews(photoIds: string[]): void {
  for (const id of photoIds) {
    for (const kind of KINDS) {
      const key = `${id}:${kind}`;
      const url = urls.get(key);
      if (url) URL.revokeObjectURL(url);
      urls.delete(key);
      pending.delete(key);
    }
  }
  for (const fn of listeners) fn();
}

/** The object URL of a screen copy, or null while it loads or when it does not exist. */
export function usePreviewUrl(photoId: string | null, kind: PreviewKind): string | null {
  const key = photoId === null ? null : `${photoId}:${kind}`;
  const [url, setUrl] = useState<string | null>(key === null ? null : (urls.get(key) ?? null));
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const on = () => setGeneration((g) => g + 1);
    listeners.add(on);
    return () => {
      listeners.delete(on);
    };
  }, []);
  useEffect(() => {
    if (photoId === null || key === null) {
      setUrl(null);
      return;
    }
    if (urls.has(key)) {
      setUrl(urls.get(key)!);
      return;
    }
    let live = true;
    void load(photoId, kind).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [key, generation]);
  return url;
}
