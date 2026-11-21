import type { Track } from './types';

/**
 * What the listener skips. Smart DJ keeps this per artist (a server has no audio features to match on, so
 * "learning" means: stop serving artists that keep getting skipped, and forgive them when a song plays through).
 */
export interface Taste {
  /** `src:artistKey` -> net skips (skips minus completed plays, never below 1 while stored). */
  skips: Record<string, number>;
}

/** Net skips at which an artist is left out of a mix (when there is enough else to play). */
export const SKIP_DROP_AT = 3;
export const MAX_TASTE_ENTRIES = 300;

export const emptyTaste = (): Taste => ({ skips: {} });

/** Artists are keyed by id when the server gives one, else by name. */
export const tasteKey = (t: Pick<Track, 'src' | 'artistId' | 'artist'>): string => `${t.src}:${t.artistId ?? t.artist.toLowerCase()}`;

/** Defensive load: tolerate missing / malformed persisted data. */
export function loadTaste(raw: unknown): Taste {
  const out = emptyTaste();
  const skips = raw && typeof raw === 'object' ? (raw as Partial<Taste>).skips : undefined;
  if (!skips || typeof skips !== 'object') return out;
  for (const [k, v] of Object.entries(skips)) {
    if (k.length <= 300 && typeof v === 'number' && Number.isFinite(v) && v >= 1) out.skips[k] = Math.min(99, Math.floor(v));
  }
  return trim(out);
}

function trim(t: Taste): Taste {
  const keys = Object.keys(t.skips);
  if (keys.length > MAX_TASTE_ENTRIES) {
    keys.sort((a, b) => (t.skips[a] ?? 0) - (t.skips[b] ?? 0));
    for (const k of keys.slice(0, keys.length - MAX_TASTE_ENTRIES)) delete t.skips[k];
  }
  return t;
}

/** The listener skipped this song early. */
export function recordSkip(taste: Taste, t: Track): void {
  const k = tasteKey(t);
  taste.skips[k] = Math.min(99, (taste.skips[k] ?? 0) + 1);
  trim(taste);
}

/** A song played to the end: forgive one skip. */
export function recordFinish(taste: Taste, t: Track): void {
  const k = tasteKey(t);
  const n = taste.skips[k];
  if (n === undefined) return;
  if (n <= 1) delete taste.skips[k];
  else taste.skips[k] = n - 1;
}

export const skipScore = (taste: Taste | undefined, t: Track): number => taste?.skips[tasteKey(t)] ?? 0;

/**
 * Order a shuffled mix by taste: songs by artists you skip go last, and (when enough else remains) the
 * most-skipped artists are dropped. Stable, so the shuffle still decides order within a group.
 */
export function rankByTaste(tracks: Track[], taste: Taste | undefined, minKept = 10): Track[] {
  if (!taste) return tracks;
  const kept = tracks.filter((t) => skipScore(taste, t) < SKIP_DROP_AT);
  const pool = kept.length >= minKept ? kept : tracks;
  return pool.slice().sort((a, b) => Math.min(skipScore(taste, a), SKIP_DROP_AT) - Math.min(skipScore(taste, b), SKIP_DROP_AT));
}
