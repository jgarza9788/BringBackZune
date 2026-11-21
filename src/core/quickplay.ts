import type { Seed, Track } from './types';

export const MAX_PINS = 6;
export const MAX_HISTORY = 24;
export const SMART_DJ_SLOTS = 5;

export interface PinRef {
  kind: 'artist' | 'album' | 'playlist' | 'track';
  src: string;
  id: string;
  title: string;
  subtitle?: string;
  imageId?: string;
  /** Tracks only: the album to open / start playback from. */
  albumId?: string;
}

export interface QuickplayState {
  pins: PinRef[];
  history: PinRef[];
  /** Five Smart DJ slots; null = empty. */
  smartDj: (Seed | null)[];
}

const key = (p: { kind: string; src: string; id: string }) => `${p.kind}:${p.src}:${p.id}`;

export function emptyQuickplay(): QuickplayState {
  return { pins: [], history: [], smartDj: Array.from({ length: SMART_DJ_SLOTS }, () => null) };
}

/** Defensive load: tolerate missing / malformed persisted data. */
export function loadQuickplay(raw: unknown): QuickplayState {
  const base = emptyQuickplay();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<QuickplayState>;
  const valid = (p: unknown): p is PinRef =>
    !!p && typeof p === 'object' && typeof (p as PinRef).id === 'string' && typeof (p as PinRef).src === 'string';
  base.pins = (Array.isArray(r.pins) ? r.pins.filter(valid) : []).slice(0, MAX_PINS);
  base.history = (Array.isArray(r.history) ? r.history.filter(valid) : []).slice(0, MAX_HISTORY);
  if (Array.isArray(r.smartDj)) {
    base.smartDj = Array.from({ length: SMART_DJ_SLOTS }, (_, i) => {
      const s = r.smartDj?.[i];
      return valid(s) ? (s as Seed) : null;
    });
  }
  return base;
}

export function isPinned(state: QuickplayState, p: PinRef): boolean {
  return state.pins.some((x) => key(x) === key(p));
}

/** Pin (or unpin when already pinned). Returns false when pins are full. */
export function togglePin(state: QuickplayState, p: PinRef): boolean {
  const i = state.pins.findIndex((x) => key(x) === key(p));
  if (i >= 0) {
    state.pins.splice(i, 1);
    return true;
  }
  if (state.pins.length >= MAX_PINS) return false;
  state.pins.push(p);
  return true;
}

/** Record something played; most recent first, de-duplicated. */
export function pushHistory(state: QuickplayState, p: PinRef): void {
  state.history = [p, ...state.history.filter((x) => key(x) !== key(p))].slice(0, MAX_HISTORY);
}

export function trackToPin(t: Track): PinRef {
  return { kind: 'track', src: t.src, id: t.id, title: t.title, subtitle: t.artist, imageId: t.imageId, albumId: t.albumId };
}

export function setSmartDjSlot(state: QuickplayState, slot: number, seed: Seed | null): void {
  if (slot < 0 || slot >= SMART_DJ_SLOTS) return;
  state.smartDj[slot] = seed;
}
