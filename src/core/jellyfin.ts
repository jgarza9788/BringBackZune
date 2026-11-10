import {
  SourceError,
  type Album,
  type AlbumSort,
  type Artist,
  type Http,
  type MusicSource,
  type Page,
  type TrackPage,
  type Playlist,
  type SearchResults,
  type Seed,
  type SourceConfig,
  type Track,
} from './types';
import { buildUrl, dedupeBy, requestJson, trimUrl, type Params } from './util';

const CLIENT = 'Bring Back Zune';
const VERSION = '0.1.0';
const TICKS_PER_SEC = 10_000_000;
/** Containers Chromium (Electron) can play natively; anything else is transcoded server-side. */
const NATIVE = new Set(['mp3', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'wav', 'webm', 'mp4', 'm4b']);

interface JfItem {
  Id: string;
  Name?: string;
  Type?: string;
  AlbumArtist?: string;
  AlbumArtists?: { Id: string; Name: string }[];
  ArtistItems?: { Id: string; Name: string }[];
  Artists?: string[];
  Album?: string;
  AlbumId?: string;
  AlbumPrimaryImageTag?: string;
  ProductionYear?: number;
  ChildCount?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  RunTimeTicks?: number;
  DateCreated?: string;
  Container?: string;
  UserData?: { IsFavorite?: boolean };
  ImageTags?: { Primary?: string };
  BackdropImageTags?: string[];
}
interface JfList {
  Items?: JfItem[];
  TotalRecordCount?: number;
}

export class JellyfinSource implements MusicSource {
  readonly kind = 'jellyfin' as const;
  readonly sortsTracksOnServer = true;
  config: SourceConfig;

  constructor(
    config: SourceConfig,
    private readonly http: Http,
  ) {
    this.config = { ...config, url: trimUrl(config.url) };
  }

  // ---- auth -------------------------------------------------------------

  private authHeader(): string {
    const parts = [
      `Client="${CLIENT}"`,
      `Device="Desktop"`,
      `DeviceId="${this.config.id}"`,
      `Version="${VERSION}"`,
    ];
    if (this.config.token) parts.push(`Token="${this.config.token}"`);
    return `MediaBrowser ${parts.join(', ')}`;
  }

  async connect(password: string): Promise<SourceConfig> {
    const res = await requestJson<{ AccessToken?: string; User?: { Id: string } }>(
      this.http,
      buildUrl(this.config.url, '/Users/AuthenticateByName'),
      {
        method: 'POST',
        headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ Username: this.config.username, Pw: password }),
      },
    );
    if (!res.AccessToken || !res.User?.Id) throw new SourceError('Login failed: no token returned', 'auth');
    this.config = { ...this.config, token: res.AccessToken, userId: res.User.Id };
    return this.config;
  }

  async ping(): Promise<void> {
    await requestJson(this.http, buildUrl(this.config.url, '/System/Info/Public'));
  }

  private async get<T>(path: string, params: Params = {}): Promise<T> {
    if (!this.config.token || !this.config.userId) throw new SourceError('Not signed in', 'auth');
    return requestJson<T>(this.http, buildUrl(this.config.url, path, { UserId: this.config.userId, ...params }), {
      headers: { Authorization: this.authHeader(), 'X-Emby-Token': this.config.token },
    });
  }

  async setFavorite(trackId: string, on: boolean): Promise<void> {
    const { token, userId, url } = this.config;
    if (!token || !userId) throw new SourceError('Not signed in', 'auth');
    const method = on ? 'POST' : 'DELETE';
    const headers = { Authorization: this.authHeader(), 'X-Emby-Token': token };
    const send = async (path: string, params: Params): Promise<{ status: number }> => {
      try {
        return await this.http(buildUrl(url, path, params), { method, headers });
      } catch (e) {
        throw new SourceError(`Cannot reach server: ${(e as Error).message}`, 'network');
      }
    };
    // Jellyfin 10.9+ uses /UserFavoriteItems; older servers only have the per-user route.
    let res = await send(`/UserFavoriteItems/${encodeURIComponent(trackId)}`, { userId });
    if (res.status === 404 || res.status === 405) {
      res = await send(`/Users/${encodeURIComponent(userId)}/FavoriteItems/${encodeURIComponent(trackId)}`, {});
    }
    if (res.status === 401 || res.status === 403) throw new SourceError('Authentication failed', 'auth', res.status);
    if (res.status < 200 || res.status >= 300) throw new SourceError(`Server returned HTTP ${res.status}`, 'server', res.status);
  }

  private async items(params: Params): Promise<JfItem[]> {
    const res = await this.get<JfList>('/Items', { Recursive: true, ...params });
    return res.Items ?? [];
  }

  // ---- mapping ----------------------------------------------------------

  private artist(i: JfItem): Artist {
    return {
      src: this.config.id,
      id: i.Id,
      name: i.Name ?? 'Unknown artist',
      imageId: i.ImageTags?.Primary ? i.Id : undefined,
      backdropId: i.BackdropImageTags?.length ? i.Id : undefined,
      albumCount: i.ChildCount,
    };
  }

  private album(i: JfItem): Album {
    return {
      src: this.config.id,
      id: i.Id,
      title: i.Name ?? 'Unknown album',
      artist: i.AlbumArtist ?? i.AlbumArtists?.[0]?.Name ?? 'Unknown artist',
      artistId: i.AlbumArtists?.[0]?.Id,
      year: i.ProductionYear,
      trackCount: i.ChildCount,
      imageId: i.ImageTags?.Primary ? i.Id : undefined,
      addedAt: i.DateCreated,
    };
  }

  private track(i: JfItem): Track {
    return {
      src: this.config.id,
      id: i.Id,
      title: i.Name ?? 'Unknown track',
      artist: i.Artists?.join(', ') || i.AlbumArtist || 'Unknown artist',
      artistId: i.ArtistItems?.[0]?.Id ?? i.AlbumArtists?.[0]?.Id,
      album: i.Album ?? '',
      albumId: i.AlbumId,
      trackNo: i.IndexNumber,
      discNo: i.ParentIndexNumber,
      durationSec: (i.RunTimeTicks ?? 0) / TICKS_PER_SEC,
      imageId: i.ImageTags?.Primary ? i.Id : i.AlbumPrimaryImageTag ? i.AlbumId : undefined,
      container: i.Container?.toLowerCase(),
      liked: i.UserData?.IsFavorite,
    };
  }

  // ---- library ----------------------------------------------------------

  async getArtists(): Promise<Artist[]> {
    const out: JfItem[] = [];
    const limit = 500;
    for (let start = 0; start < 100_000; start += limit) {
      const res = await this.get<JfList>('/Artists/AlbumArtists', {
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        Limit: limit,
        StartIndex: start,
      });
      const page = res.Items ?? [];
      out.push(...page);
      if (page.length < limit) break;
    }
    return out.map((i) => this.artist(i));
  }

  async getArtist(id: string): Promise<{ artist: Artist; albums: Album[] }> {
    const [found, albums] = await Promise.all([
      this.items({ Ids: id, Recursive: false }),
      this.items({
        IncludeItemTypes: 'MusicAlbum',
        AlbumArtistIds: id,
        SortBy: 'ProductionYear,SortName',
        SortOrder: 'Descending',
      }),
    ]);
    const item = found[0];
    if (!item) throw new SourceError('Artist not found', 'server', 404);
    return { artist: this.artist(item), albums: albums.map((a) => this.album(a)) };
  }

  async getAlbums(sort: AlbumSort, page: Page = {}): Promise<Album[]> {
    const sortBy = sort === 'recent' ? 'DateCreated' : sort === 'artist' ? 'AlbumArtist,SortName' : 'SortName';
    const items = await this.items({
      IncludeItemTypes: 'MusicAlbum',
      SortBy: sortBy,
      SortOrder: sort === 'recent' ? 'Descending' : 'Ascending',
      Limit: page.limit ?? 200,
      StartIndex: page.offset ?? 0,
    });
    return items.map((a) => this.album(a));
  }

  async getAlbum(id: string): Promise<{ album: Album; tracks: Track[] }> {
    const [found, tracks] = await Promise.all([
      this.items({ Ids: id, Recursive: false }),
      this.items({
        ParentId: id,
        IncludeItemTypes: 'Audio',
        SortBy: 'ParentIndexNumber,IndexNumber,SortName',
        Fields: 'MediaSources',
      }),
    ]);
    const item = found[0];
    if (!item) throw new SourceError('Album not found', 'server', 404);
    return { album: this.album(item), tracks: tracks.map((t) => this.track(t)) };
  }

  private playlist(i: JfItem): Playlist {
    return {
      src: this.config.id,
      id: i.Id,
      name: i.Name ?? 'Untitled playlist',
      trackCount: i.ChildCount,
      imageId: i.ImageTags?.Primary ? i.Id : undefined,
      addedAt: i.DateCreated,
    };
  }

  async getPlaylists(): Promise<Playlist[]> {
    const items = await this.items({ IncludeItemTypes: 'Playlist', MediaTypes: 'Audio', SortBy: 'SortName', Fields: 'ChildCount,DateCreated' });
    return items.map((p) => this.playlist(p));
  }

  async getPlaylist(id: string): Promise<{ playlist: Playlist; tracks: Track[] }> {
    const [found, res] = await Promise.all([
      this.items({ Ids: id, Recursive: false, Fields: 'ChildCount' }),
      this.get<JfList>(`/Playlists/${encodeURIComponent(id)}/Items`, { Fields: 'MediaSources' }),
    ]);
    const item = found[0];
    if (!item) throw new SourceError('Playlist not found', 'server', 404);
    return { playlist: this.playlist(item), tracks: (res.Items ?? []).map((t) => this.track(t)) };
  }

  async getTracks(page: TrackPage = {}): Promise<Track[]> {
    const by = page.sort?.by ?? 'title';
    const items = await this.items({
      IncludeItemTypes: 'Audio',
      SortBy:
        by === 'artist' ? 'Artist,Album,ParentIndexNumber,IndexNumber,SortName' : by === 'album' ? 'Album,ParentIndexNumber,IndexNumber,SortName' : by === 'time' ? 'Runtime,SortName' : 'SortName',
      SortOrder: page.sort?.desc ? 'Descending' : 'Ascending',
      Limit: page.limit ?? 200,
      StartIndex: page.offset ?? 0,
    });
    return items.map((t) => this.track(t));
  }

  async search(query: string): Promise<SearchResults> {
    const q = query.trim();
    if (!q) return { artists: [], albums: [], tracks: [] };
    const [artists, albums, tracks] = await Promise.all([
      this.get<JfList>('/Artists', { searchTerm: q, Limit: 12 }),
      this.items({ searchTerm: q, IncludeItemTypes: 'MusicAlbum', Limit: 18 }),
      this.items({ searchTerm: q, IncludeItemTypes: 'Audio', Limit: 30 }),
    ]);
    return {
      artists: (artists.Items ?? []).map((a) => this.artist(a)),
      albums: albums.map((a) => this.album(a)),
      tracks: tracks.map((t) => this.track(t)),
    };
  }

  async getNewestAlbums(limit: number): Promise<Album[]> {
    const items = await this.items({
      IncludeItemTypes: 'MusicAlbum',
      SortBy: 'DateCreated',
      SortOrder: 'Descending',
      Limit: limit,
    });
    return items.map((a) => this.album(a));
  }

  async getRandomTracks(limit: number): Promise<Track[]> {
    const items = await this.items({ IncludeItemTypes: 'Audio', SortBy: 'Random', Limit: limit });
    return items.map((t) => this.track(t));
  }

  async getSimilarArtists(artistId: string, limit: number): Promise<Artist[]> {
    const res = await this.get<JfList>(`/Artists/${encodeURIComponent(artistId)}/Similar`, { Limit: limit });
    return (res.Items ?? []).map((a) => this.artist(a));
  }

  async getMix(seed: Seed, limit: number): Promise<Track[]> {
    const res = await this.get<JfList>(`/Items/${encodeURIComponent(seed.id)}/InstantMix`, { Limit: limit });
    return dedupeBy((res.Items ?? []).map((t) => this.track(t)), (t) => t.id);
  }

  async getTopTracks(artist: Artist, limit: number): Promise<Track[]> {
    const items = await this.items({
      IncludeItemTypes: 'Audio',
      ArtistIds: artist.id,
      SortBy: 'PlayCount,SortName',
      SortOrder: 'Descending',
      Limit: limit,
    });
    return items.map((t) => this.track(t));
  }

  // ---- urls -------------------------------------------------------------

  streamUrl(track: Track): string {
    const id = encodeURIComponent(track.id);
    if (track.container && !NATIVE.has(track.container)) {
      // Unsupported container (wma, ape ...): ask the server to transcode to MP3.
      return buildUrl(this.config.url, `/Audio/${id}/stream.mp3`, {
        audioCodec: 'mp3',
        audioBitRate: 320000,
        api_key: this.config.token,
      });
    }
    return buildUrl(this.config.url, `/Audio/${id}/stream`, { static: true, api_key: this.config.token });
  }

  imageUrl(imageId: string | undefined, size: number, kind: 'primary' | 'backdrop' = 'primary'): string | undefined {
    if (!imageId) return undefined;
    const type = kind === 'backdrop' ? 'Backdrop' : 'Primary';
    return buildUrl(this.config.url, `/Items/${encodeURIComponent(imageId)}/Images/${type}`, {
      maxHeight: size,
      quality: 90,
      api_key: this.config.token,
    });
  }
}
