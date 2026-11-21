import { emptyQuickplay, loadQuickplay, type QuickplayState } from './quickplay';
<<<<<<< HEAD
import { emptyTaste, loadTaste, type Taste } from './taste';
import type { SourceConfig } from './types';
=======
import type { AlbumSort, SourceConfig, TrackSort, TrackSortKey } from './types';

export const COLLECTION_TABS = ['artists', 'albums', 'playlists', 'songs'] as const;
export type CollectionTab = (typeof COLLECTION_TABS)[number];

const ALBUM_SORTS: readonly AlbumSort[] = ['name', 'artist', 'recent'];
export const PLAYLIST_SORTS = ['name', 'size', 'recent'] as const;
export type PlaylistSort = (typeof PLAYLIST_SORTS)[number];
const TRACK_SORT_KEYS: readonly TrackSortKey[] = ['title', 'artist', 'album', 'time'];

/** Sort chosen on each collection tab, remembered across restarts. */
export interface CollectionSort {
  albums: AlbumSort;
  playlists: PlaylistSort;
  songs: TrackSort;
}
>>>>>>> dc4ba907d986eb94865bbd462a8ee080a330a2b7

export type Theme = 'dark' | 'light' | 'system';
/** `custom` is the Metro tile layout; `classic` shows artists, albums and songs side by side. */
export type Layout = 'custom' | 'classic';

/** Locally replaced cover art (`src:imageId` -> JPEG data URL). Kept small: it lives in settings.json. */
export const MAX_COVERS = 60;
export const MAX_COVER_CHARS = 150_000;
const COVER_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

export interface Settings {
  version: 1;
  sources: SourceConfig[];
  activeSourceId?: string;
  quickplay: QuickplayState;
  accent: string;
  volume: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
<<<<<<< HEAD
  theme: Theme;
  layout: Layout;
  covers: Record<string, string>;
  taste: Taste;
=======
  /** Collection tab the user was last on; the "collection" pivot reopens it. */
  collectionTab: CollectionTab;
  collectionSort: CollectionSort;
>>>>>>> dc4ba907d986eb94865bbd462a8ee080a330a2b7
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  sources: [],
  quickplay: emptyQuickplay(),
  accent: '#D80073',
  volume: 0.8,
  shuffle: false,
  repeat: 'off',
<<<<<<< HEAD
  theme: 'dark',
  layout: 'custom',
  covers: {},
  taste: emptyTaste(),
=======
  collectionTab: 'artists',
  collectionSort: { albums: 'name', playlists: 'name', songs: { by: 'title' } },
>>>>>>> dc4ba907d986eb94865bbd462a8ee080a330a2b7
};

/** Validate persisted JSON; never trust the file shape. */
export function sanitizeSettings(raw: unknown): Settings {
<<<<<<< HEAD
  const s: Settings = { ...DEFAULT_SETTINGS, quickplay: emptyQuickplay(), sources: [], covers: {}, taste: emptyTaste() };
=======
  const s: Settings = { ...DEFAULT_SETTINGS, quickplay: emptyQuickplay(), sources: [], collectionSort: loadCollectionSort(undefined) };
>>>>>>> dc4ba907d986eb94865bbd462a8ee080a330a2b7
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
<<<<<<< HEAD
  if (r.theme === 'dark' || r.theme === 'light' || r.theme === 'system') s.theme = r.theme;
  if (r.layout === 'custom' || r.layout === 'classic') s.layout = r.layout;
  s.covers = loadCovers(r.covers);
  s.taste = loadTaste(r.taste);
  return s;
}

function loadCovers(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_COVERS) break;
    if (k.length <= 600 && typeof v === 'string' && v.length <= MAX_COVER_CHARS && COVER_RE.test(v)) out[k] = v;
  }
  return out;
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
=======
  if ((COLLECTION_TABS as readonly unknown[]).includes(r.collectionTab)) s.collectionTab = r.collectionTab as CollectionTab;
  s.collectionSort = loadCollectionSort(r.collectionSort);
  return s;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => ((list as readonly unknown[]).includes(v) ? (v as T) : fallback);

function loadCollectionSort(raw: unknown): CollectionSort {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const songs = (r.songs && typeof r.songs === 'object' ? r.songs : {}) as Record<string, unknown>;
  const out: CollectionSort = {
    albums: oneOf(ALBUM_SORTS, r.albums, 'name'),
    playlists: oneOf(PLAYLIST_SORTS, r.playlists, 'name'),
    songs: { by: oneOf(TRACK_SORT_KEYS, songs.by, 'title') },
  };
  if (songs.desc === true) out.songs.desc = true;
>>>>>>> dc4ba907d986eb94865bbd462a8ee080a330a2b7
  return out;
}
