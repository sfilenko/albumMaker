// A test page for the end-to-end import test. main.tsx loads it only in development
// builds, at ?harness=import.
import { importFiles } from './photos/import';
import { getPreview, type PreviewKind } from './storage/db';

declare global {
  interface Window {
    __importFiles?: typeof importFiles;
    __previewSize?: (photoId: string, kind: PreviewKind) => Promise<number | null>;
    __importResult?: Awaited<ReturnType<typeof importFiles>>;
  }
}

export function mountImportHarness(root: HTMLElement): void {
  window.__importFiles = importFiles;
  window.__previewSize = async (photoId, kind) => (await getPreview(photoId, kind))?.size ?? null;

  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.dataset.testid = 'harness-input';
  input.addEventListener('change', async () => {
    window.__importResult = await importFiles(Array.from(input.files ?? []), () => {});
    root.dataset.state = 'done';
  });
  root.replaceChildren(input);
  root.dataset.state = 'ready';
}
