import { SourceError, type Http, type HttpRequest } from './types';

export function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export type Params = Record<string, string | number | boolean | undefined>;

export function buildUrl(base: string, path: string, params: Params = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const q = qs.toString();
  return `${trimUrl(base)}${path}${q ? `?${q}` : ''}`;
}

/** Fetch + parse JSON with uniform error mapping. */
export async function requestJson<T>(http: Http, url: string, req?: HttpRequest): Promise<T> {
  let res;
  try {
    res = await http(url, req);
  } catch (e) {
    throw new SourceError(`Cannot reach server: ${(e as Error).message}`, 'network');
  }
  if (res.status === 401 || res.status === 403) {
    throw new SourceError('Authentication failed', 'auth', res.status);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new SourceError(`Server returned HTTP ${res.status}`, 'server', res.status);
  }
  try {
    return JSON.parse(res.text) as T;
  } catch {
    throw new SourceError('Server returned a response that is not JSON (wrong URL?)', 'protocol', res.status);
  }
}

export const arr = <T>(v: T[] | T | undefined | null): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

export function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = key(it);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(it);
    }
  }
  return out;
}

export function shuffled<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Deterministic PRNG (mulberry32) for tests and the demo library. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
