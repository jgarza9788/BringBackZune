import { emptyQuickplay, loadQuickplay, type QuickplayState } from './quickplay';
import type { SourceConfig } from './types';

export interface Settings {
  version: 1;
  sources: SourceConfig[];
  activeSourceId?: string;
  quickplay: QuickplayState;
  accent: string;
  volume: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  sources: [],
  quickplay: emptyQuickplay(),
  accent: '#D80073',
  volume: 0.8,
  shuffle: false,
  repeat: 'off',
};

/** Validate persisted JSON; never trust the file shape. */
export function sanitizeSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, quickplay: emptyQuickplay(), sources: [] };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.sources)) {
    s.sources = r.sources.map(sanitizeSource).filter((x): x is SourceConfig => x !== null);
  }
  if (typeof r.activeSourceId === 'string') s.activeSourceId = r.activeSourceId;
  s.quickplay = loadQuickplay(r.quickplay);
  if (typeof r.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.accent)) s.accent = r.accent;
  if (typeof r.volume === 'number' && r.volume >= 0 && r.volume <= 1) s.volume = r.volume;
  if (typeof r.shuffle === 'boolean') s.shuffle = r.shuffle;
  if (r.repeat === 'off' || r.repeat === 'all' || r.repeat === 'one') s.repeat = r.repeat;
  return s;
}

const str = (v: unknown, max = 512): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined);

/** Keep only known fields with the right types; the URL must be http(s) (or the offline demo). */
function sanitizeSource(x: unknown): SourceConfig | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const kind = r.kind;
  if (kind !== 'jellyfin' && kind !== 'navidrome' && kind !== 'demo') return null;
  const id = str(r.id, 128);
  const url = str(r.url, 2048);
  if (!id || !url) return null;
  if (kind === 'demo' ? url !== 'demo://local' : !/^https?:\/\/[^\s/]+/i.test(url)) return null;
  const out: SourceConfig = { id, kind, url, name: str(r.name, 200) ?? '', username: str(r.username, 200) ?? '' };
  if (r.allowSelfSigned === true) out.allowSelfSigned = true;
  for (const k of ['token', 'userId', 'salt', 'subsonicToken'] as const) {
    const v = str(r[k], 1024);
    if (v) out[k] = v;
  }
  return out;
}
