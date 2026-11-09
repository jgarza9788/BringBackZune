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
    s.sources = r.sources.filter(
      (x): x is SourceConfig =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as SourceConfig).id === 'string' &&
        typeof (x as SourceConfig).url === 'string' &&
        ['jellyfin', 'navidrome', 'demo'].includes((x as SourceConfig).kind),
    );
  }
  if (typeof r.activeSourceId === 'string') s.activeSourceId = r.activeSourceId;
  s.quickplay = loadQuickplay(r.quickplay);
  if (typeof r.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.accent)) s.accent = r.accent;
  if (typeof r.volume === 'number' && r.volume >= 0 && r.volume <= 1) s.volume = r.volume;
  if (typeof r.shuffle === 'boolean') s.shuffle = r.shuffle;
  if (r.repeat === 'off' || r.repeat === 'all' || r.repeat === 'one') s.repeat = r.repeat;
  return s;
}
