import { emptyQuickplay, loadQuickplay, type QuickplayState } from './quickplay';
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

export interface Settings {
  version: 1;
  sources: SourceConfig[];
  activeSourceId?: string;
  quickplay: QuickplayState;
  accent: string;
  volume: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  /** Collection tab the user was last on; the "collection" pivot reopens it. */
  collectionTab: CollectionTab;
  collectionSort: CollectionSort;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  sources: [],
  quickplay: emptyQuickplay(),
  accent: '#D80073',
  volume: 0.8,
  shuffle: false,
  repeat: 'off',
  collectionTab: 'artists',
  collectionSort: { albums: 'name', playlists: 'name', songs: { by: 'title' } },
};

/** Validate persisted JSON; never trust the file shape. */
export function sanitizeSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, quickplay: emptyQuickplay(), sources: [], collectionSort: loadCollectionSort(undefined) };
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
  return out;
}
