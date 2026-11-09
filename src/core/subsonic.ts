import { md5 } from './md5';
import {
  SourceError,
  type Album,
  type AlbumSort,
  type Artist,
  type Http,
  type MusicSource,
  type Page,
  type Playlist,
  type SearchResults,
  type Seed,
  type SourceConfig,
  type Track,
} from './types';
import { arr, buildUrl, dedupeBy, requestJson, trimUrl, type Params } from './util';

const API_VERSION = '1.16.1';
const CLIENT = 'BringBackZune';
const NATIVE = new Set(['mp3', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'wav', 'webm', 'mp4', 'm4b']);

interface SsArtist {
  id: string;
  name: string;
  coverArt?: string;
  albumCount?: number;
}
interface SsAlbum {
  id: string;
  name?: string;
  title?: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  year?: number;
  created?: string;
  song?: SsSong[];
}
interface SsSong {
  id: string;
  title: string;
  artist?: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  track?: number;
  discNumber?: number;
  duration?: number;
  coverArt?: string;
  suffix?: string;
}
interface SsPlaylist {
  id: string;
  name: string;
  songCount?: number;
  coverArt?: string;
  entry?: SsSong[];
}
interface SsEnvelope {
  'subsonic-response': {
    status: 'ok' | 'failed';
    error?: { code: number; message: string };
    [k: string]: unknown;
  };
}

/** Subsonic API client. Navidrome speaks this protocol (also works with other Subsonic servers). */
export class SubsonicSource implements MusicSource {
  readonly kind = 'navidrome' as const;
  config: SourceConfig;

  constructor(
    config: SourceConfig,
    private readonly http: Http,
    /** Injectable for deterministic tests. */
    private readonly makeSalt: () => string = defaultSalt,
  ) {
    this.config = { ...config, url: trimUrl(config.url) };
  }

  async connect(password: string): Promise<SourceConfig> {
    const salt = this.makeSalt();
    this.config = { ...this.config, salt, subsonicToken: md5(password + salt) };
    try {
      await this.ping();
    } catch (e) {
      this.config = { ...this.config, salt: undefined, subsonicToken: undefined };
      throw e;
    }
    return this.config;
  }

  async ping(): Promise<void> {
    await this.call('ping');
  }

  private authParams(): Params {
    return {
      u: this.config.username,
      t: this.config.subsonicToken,
      s: this.config.salt,
      v: API_VERSION,
      c: CLIENT,
      f: 'json',
    };
  }

  private async call<T = Record<string, unknown>>(method: string, params: Params = {}): Promise<T> {
    if (!this.config.subsonicToken || !this.config.salt) throw new SourceError('Not signed in', 'auth');
    const env = await requestJson<SsEnvelope>(
      this.http,
      buildUrl(this.config.url, `/rest/${method}`, { ...this.authParams(), ...params }),
    );
    const r = env['subsonic-response'];
    if (!r) throw new SourceError('Not a Subsonic/Navidrome server (unexpected response)', 'protocol');
    if (r.status !== 'ok') {
      const code = r.error?.code;
      const msg = r.error?.message ?? 'Unknown error';
      // 40 = wrong credentials, 41 = token auth unsupported, 44 = invalid token
      throw new SourceError(msg, code === 40 || code === 41 || code === 44 ? 'auth' : 'server');
    }
    return r as unknown as T;
  }

  // ---- mapping ----------------------------------------------------------

  private artist(a: SsArtist): Artist {
    return { src: this.config.id, id: a.id, name: a.name, imageId: a.coverArt ?? a.id, albumCount: a.albumCount };
  }

  private album(a: SsAlbum): Album {
    return {
      src: this.config.id,
      id: a.id,
      title: a.name ?? a.title ?? 'Unknown album',
      artist: a.artist ?? 'Unknown artist',
      artistId: a.artistId,
      year: a.year,
      trackCount: a.songCount,
      imageId: a.coverArt ?? a.id,
      addedAt: a.created,
    };
  }

  private track(s: SsSong): Track {
    return {
      src: this.config.id,
      id: s.id,
      title: s.title,
      artist: s.artist ?? 'Unknown artist',
      artistId: s.artistId,
      album: s.album ?? '',
      albumId: s.albumId,
      trackNo: s.track,
      discNo: s.discNumber,
      durationSec: s.duration ?? 0,
      imageId: s.coverArt ?? s.albumId,
      container: s.suffix?.toLowerCase(),
    };
  }

  // ---- library ----------------------------------------------------------

  async getArtists(): Promise<Artist[]> {
    const r = await this.call<{ artists?: { index?: { artist?: SsArtist[] }[] } }>('getArtists');
    const flat = arr(r.artists?.index).flatMap((ix) => arr(ix.artist));
    return flat.map((a) => this.artist(a));
  }

  async getArtist(id: string): Promise<{ artist: Artist; albums: Album[] }> {
    const r = await this.call<{ artist?: SsArtist & { album?: SsAlbum[] } }>('getArtist', { id });
    if (!r.artist) throw new SourceError('Artist not found', 'server', 404);
    const albums = arr(r.artist.album).map((a) => this.album({ ...a, artistId: a.artistId ?? id }));
    albums.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    return { artist: this.artist(r.artist), albums };
  }

  async getAlbums(sort: AlbumSort, page: Page = {}): Promise<Album[]> {
    const type = sort === 'recent' ? 'newest' : sort === 'artist' ? 'alphabeticalByArtist' : 'alphabeticalByName';
    const r = await this.call<{ albumList2?: { album?: SsAlbum[] } }>('getAlbumList2', {
      type,
      size: page.limit ?? 200,
      offset: page.offset ?? 0,
    });
    return arr(r.albumList2?.album).map((a) => this.album(a));
  }

  async getAlbum(id: string): Promise<{ album: Album; tracks: Track[] }> {
    const r = await this.call<{ album?: SsAlbum }>('getAlbum', { id });
    if (!r.album) throw new SourceError('Album not found', 'server', 404);
    const tracks = arr(r.album.song).map((s) => this.track({ ...s, albumId: s.albumId ?? id }));
    tracks.sort((a, b) => (a.discNo ?? 1) - (b.discNo ?? 1) || (a.trackNo ?? 0) - (b.trackNo ?? 0));
    return { album: this.album(r.album), tracks };
  }

  private playlist(p: SsPlaylist): Playlist {
    return { src: this.config.id, id: p.id, name: p.name, trackCount: p.songCount, imageId: p.coverArt ?? p.id };
  }

  async getPlaylists(): Promise<Playlist[]> {
    const r = await this.call<{ playlists?: { playlist?: SsPlaylist[] } }>('getPlaylists');
    return arr(r.playlists?.playlist).map((p) => this.playlist(p));
  }

  async getPlaylist(id: string): Promise<{ playlist: Playlist; tracks: Track[] }> {
    const r = await this.call<{ playlist?: SsPlaylist }>('getPlaylist', { id });
    if (!r.playlist) throw new SourceError('Playlist not found', 'server', 404);
    return { playlist: this.playlist(r.playlist), tracks: arr(r.playlist.entry).map((s) => this.track(s)) };
  }

  async getTracks(page: Page = {}): Promise<Track[]> {
    // Navidrome returns the whole library for an empty search3 query; page through it.
    const r = await this.call<{ searchResult3?: { song?: SsSong[] } }>('search3', {
      query: '""',
      artistCount: 0,
      albumCount: 0,
      songCount: page.limit ?? 200,
      songOffset: page.offset ?? 0,
    });
    return arr(r.searchResult3?.song).map((s) => this.track(s));
  }

  async search(query: string): Promise<SearchResults> {
    const q = query.trim();
    if (!q) return { artists: [], albums: [], tracks: [] };
    const r = await this.call<{ searchResult3?: { artist?: SsArtist[]; album?: SsAlbum[]; song?: SsSong[] } }>(
      'search3',
      { query: q, artistCount: 12, albumCount: 18, songCount: 30 },
    );
    const s = r.searchResult3;
    return {
      artists: arr(s?.artist).map((a) => this.artist(a)),
      albums: arr(s?.album).map((a) => this.album(a)),
      tracks: arr(s?.song).map((t) => this.track(t)),
    };
  }

  async getNewestAlbums(limit: number): Promise<Album[]> {
    return this.getAlbums('recent', { limit });
  }

  async getRandomTracks(limit: number): Promise<Track[]> {
    const r = await this.call<{ randomSongs?: { song?: SsSong[] } }>('getRandomSongs', { size: limit });
    return arr(r.randomSongs?.song).map((s) => this.track(s));
  }

  async getSimilarArtists(artistId: string, limit: number): Promise<Artist[]> {
    const r = await this.call<{ artistInfo2?: { similarArtist?: SsArtist[] } }>('getArtistInfo2', {
      id: artistId,
      count: limit,
      includeNotPresent: false,
    });
    return arr(r.artistInfo2?.similarArtist).map((a) => this.artist(a));
  }

  async getMix(seed: Seed, limit: number): Promise<Track[]> {
    const r = await this.call<{ similarSongs2?: { song?: SsSong[] } }>('getSimilarSongs2', {
      id: seed.id,
      count: limit,
    });
    return dedupeBy(arr(r.similarSongs2?.song).map((s) => this.track(s)), (t) => t.id);
  }

  async getTopTracks(artist: Artist, limit: number): Promise<Track[]> {
    const r = await this.call<{ topSongs?: { song?: SsSong[] } }>('getTopSongs', { artist: artist.name, count: limit });
    return arr(r.topSongs?.song).map((s) => this.track(s));
  }

  // ---- urls -------------------------------------------------------------

  streamUrl(track: Track): string {
    const extra: Params =
      track.container && !NATIVE.has(track.container) ? { format: 'mp3', maxBitRate: 320 } : { estimateContentLength: true };
    return buildUrl(this.config.url, '/rest/stream', { ...this.authParams(), id: track.id, ...extra });
  }

  imageUrl(imageId: string | undefined, size: number): string | undefined {
    if (!imageId) return undefined;
    return buildUrl(this.config.url, '/rest/getCoverArt', { ...this.authParams(), id: imageId, size });
  }
}

function defaultSalt(): string {
  const bytes = new Uint8Array(8);
  (globalThis.crypto ?? ({ getRandomValues: (b: Uint8Array) => b.map(() => Math.floor(Math.random() * 256)) })).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
