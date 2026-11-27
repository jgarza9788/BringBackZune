/**
 * Metro-style page transitions: turnstile out (the in-animation lives in CSS), slide in the direction of travel between
 * pivot tabs, and a "continuum" that carries the tapped cover into the next page via the View Transitions API.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { COLLECTION_TABS } from '../core/settings';
import type { Route } from './state';

const OUT_MS = 150;

/** Re-key only on view changes (not on search typing) so enter animations replay per page. */
export const routeKey = (r: Route): string =>
  r.name === 'collection' ? `collection-${r.tab}` : r.name === 'search' ? 'search' : JSON.stringify(r);

/** Position of a top-level page in the pivot, so we know which way to slide. Detail pages return -1 (turnstile instead). */
function rank(r: Route): number {
  switch (r.name) {
    case 'quickplay':
      return 0;
    case 'collection':
      return 10 + COLLECTION_TABS.indexOf(r.tab);
    case 'nowplaying':
      return 100;
    default:
      return -1;
  }
}

export type Direction = '' | 'fwd' | 'back';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The cover that was clicked; it gets a shared `view-transition-name` so it flies into the next page. */
let continuumEl: HTMLElement | null = null;

export function markContinuum(from: HTMLElement | null): void {
  const art = from?.querySelector<HTMLElement>('.art') ?? null;
  if (!art || !('startViewTransition' in document) || reducedMotion()) return;
  clearContinuum();
  continuumEl = art;
  art.style.setProperty('view-transition-name', 'cover');
  // a click that doesn't navigate must not leave the name behind for some later page change
  window.setTimeout(() => continuumEl === art && clearContinuum(), 1500);
}

function clearContinuum(): void {
  continuumEl?.style.removeProperty('view-transition-name');
  continuumEl = null;
}

const nextFrames = (): Promise<void> => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())));

export function useRouteTransition(target: Route): { shown: Route; leaving: boolean; dir: Direction; continuum: boolean } {
  const [shown, setShown] = useState(target);
  const [leaving, setLeaving] = useState(false);
  const [dir, setDir] = useState<Direction>('');
  const [continuum, setContinuum] = useState(false);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    const cur = shownRef.current;
    if (routeKey(cur) === routeKey(target)) {
      setShown(target); // same page (e.g. search text changed): no transition
      setLeaving(false);
      return;
    }
    const a = rank(cur);
    const b = rank(target);
    const direction: Direction = a >= 0 && b >= 0 ? (b > a ? 'fwd' : 'back') : '';
    const swap = (): void => {
      setShown(target);
      setLeaving(false);
    };
    if (continuumEl && 'startViewTransition' in document) {
      // old and new snapshots are taken around the swap, so the page must have rendered when the callback resolves
      setDir('');
      setContinuum(true);
      void (document as Document & { startViewTransition: (cb: () => Promise<void>) => { finished: Promise<void> } })
        .startViewTransition(async () => {
          swap();
          await nextFrames();
        })
        .finished.catch(() => undefined)
        .finally(() => {
          clearContinuum();
          setContinuum(false);
        });
      return;
    }
    clearContinuum();
    setContinuum(false);
    if (reducedMotion()) {
      setDir(direction);
      swap();
      return;
    }
    setDir(direction);
    setLeaving(true);
    const t = window.setTimeout(swap, OUT_MS);
    return () => window.clearTimeout(t);
  }, [routeKey(target)]);

  return { shown, leaving, dir, continuum };
}
