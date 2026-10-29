// Pointer-based drag and drop. HTML5 drag and drop does not work on touch screens.
// A mouse drag starts after 4 px of movement. A touch drag starts after a 250 ms press
// that moves less than 8 px, so the photo column can still scroll.
import { signal } from '@preact/signals';
import type { CellRef } from '../model/types';

export type DragPayload =
  | { kind: 'photo'; photoId: string }
  | { kind: 'cell'; ref: CellRef }
  | { kind: 'spread'; index: number };

/** Tap-to-place: a tapped photo waits here until the user taps a cell. */
export const armedPhoto = signal<string | null>(null);

const MOUSE_START_PX = 4;
const TOUCH_SLOP_PX = 8;
const LONG_PRESS_MS = 250;
const HOVER_CLASS = 'drop-hover';

interface Target { accepts: (p: DragPayload) => boolean; onDrop: (p: DragPayload) => void }
const targets = new Map<HTMLElement, Target>();

export function registerDropTarget(
  el: HTMLElement,
  accepts: (p: DragPayload) => boolean,
  onDrop: (p: DragPayload) => void,
): () => void {
  targets.set(el, { accepts, onDrop });
  return () => {
    targets.delete(el);
    el.classList.remove(HOVER_CLASS);
  };
}

/** The innermost registered target under the point that accepts the payload. */
function targetAt(x: number, y: number, p: DragPayload): [HTMLElement, Target] | null {
  for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
    const t = targets.get(el as HTMLElement);
    if (t?.accepts(p)) return [el as HTMLElement, t];
  }
  return null;
}

/** Swallows the click that the browser sends after a drag ends. */
function swallowNextClick(): void {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

/** Call from a pointerdown handler. `source` is copied as the image that follows the pointer. */
export function startDrag(e: PointerEvent, payload: DragPayload, source: HTMLElement): void {
  if (e.button !== 0) return;
  const touch = e.pointerType !== 'mouse';
  const x0 = e.clientX;
  const y0 = e.clientY;
  let active = false;
  let ghost: HTMLElement | null = null;
  let hover: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const setHover = (el: HTMLElement | null) => {
    if (hover === el) return;
    hover?.classList.remove(HOVER_CLASS);
    hover = el;
    hover?.classList.add(HOVER_CLASS);
  };

  const begin = () => {
    active = true;
    const r = source.getBoundingClientRect();
    ghost = source.cloneNode(true) as HTMLElement;
    ghost.classList.add('drag-ghost');
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${x0 - r.width / 2}px`,
      top: `${y0 - r.height / 2}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      pointerEvents: 'none',
      zIndex: '1000',
    });
    document.body.appendChild(ghost);
  };

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    const dist = Math.hypot(ev.clientX - x0, ev.clientY - y0);
    if (!active) {
      if (touch) {
        if (dist > TOUCH_SLOP_PX) end(); // the user scrolls
        return;
      }
      if (dist < MOUSE_START_PX) return;
      begin();
    }
    if (ghost) {
      ghost.style.left = `${ev.clientX - ghost.offsetWidth / 2}px`;
      ghost.style.top = `${ev.clientY - ghost.offsetHeight / 2}px`;
    }
    setHover(targetAt(ev.clientX, ev.clientY, payload)?.[0] ?? null);
  };

  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    if (active) {
      const hit = targetAt(ev.clientX, ev.clientY, payload);
      swallowNextClick();
      end();
      hit?.[1].onDrop(payload);
      return;
    }
    end();
  };

  // While a touch drag is active, the page must not scroll.
  const noScroll = (ev: TouchEvent) => {
    if (active) ev.preventDefault();
  };

  const end = () => {
    if (timer !== null) clearTimeout(timer);
    setHover(null);
    ghost?.remove();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', end);
    document.removeEventListener('touchmove', noScroll);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', end);
  document.addEventListener('touchmove', noScroll, { passive: false });
  if (touch) timer = setTimeout(begin, LONG_PRESS_MS);
}
