/** Shared domain types. Every entity carries `src` (the source id) so it can be resolved later. */

export type SourceKind = 'jellyfin' | 'navidrome' | 'demo';

export interface Artist {
  src: string;
  id: string;
  name: string;
  /** Id to pass to MusicSource.imageUrl(); undefined = no art. */
  imageId?: string;
  /** Id of a wide backdrop image (Jellyfin only). */
  backdropId?: string;
  albumCount?: number;
}

export interface Album {
  src: string;
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  year?: number;
  trackCount?: number;
  imageId?: string;
  /** ISO date the album was added to the library. */
  addedAt?: string;
}

export interface Playlist {
  src: string;
  id: string;
  name: string;
  trackCount?: number;
  imageId?: string;
  /** ISO date the playlist was created, when the server says. */
  addedAt?: string;
}

export interface Track {
  src: string;
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album: string;
  albumId?: string;
  trackNo?: number;
  discNo?: number;
  durationSec: number;
  imageId?: string;
  /** File container / suffix, lowercase (mp3, flac, m4a ...). Used to decide on transcoding. */
  container?: string;
  /** Favourite / starred on the server, as of when this track was fetched. */
  liked?: boolean;
}

export interface SearchResults {
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
}

export type AlbumSort = 'name' | 'recent' | 'artist';

export interface Page {
  limit?: number;
  offset?: number;
}

export type TrackSortKey = 'title' | 'artist' | 'album' | 'time';
export interface TrackSort {
  by: TrackSortKey;
  desc?: boolean;
}
export interface TrackPage extends Page {
  sort?: TrackSort;
}

export interface SourceConfig {
  id: string;
  kind: SourceKind;
  name: string;
  /** Server base URL, no trailing slash. */
  url: string;
  username: string;
  /** Accept self-signed / private-CA certificates (common on homelabs). */
  allowSelfSigned?: boolean;
  /** Jellyfin access token. */
  token?: string;
  /** Jellyfin user id. */
  userId?: string;
  /** Subsonic/Navidrome salt + md5(password+salt). The password itself is never stored. */
  salt?: string;
  subsonicToken?: string;
}

export type SeedKind = 'artist' | 'album' | 'track';

export interface Seed {
  kind: SeedKind;
  src: string;
  id: string;
  title: string;
  subtitle?: string;
  imageId?: string;
}

export interface MusicSource {
  readonly config: SourceConfig;
  /** Authenticate and return an updated config (with token / salt). Throws SourceError. */
  connect(password: string): Promise<SourceConfig>;
  ping(): Promise<void>;

  getArtists(): Promise<Artist[]>;
  getArtist(id: string): Promise<{ artist: Artist; albums: Album[] }>;
  getAlbums(sort: AlbumSort, page?: Page): Promise<Album[]>;
  getAlbum(id: string): Promise<{ album: Album; tracks: Track[] }>;
  getPlaylists(): Promise<Playlist[]>;
  getPlaylist(id: string): Promise<{ playlist: Playlist; tracks: Track[] }>;
  /** True when `getTracks` honours `page.sort` on the server (so paging stays correct); otherwise sort what is loaded. */
  readonly sortsTracksOnServer: boolean;
  getTracks(page?: TrackPage): Promise<Track[]>;
  search(query: string): Promise<SearchResults>;

  getNewestAlbums(limit: number): Promise<Album[]>;
  getRandomTracks(limit: number): Promise<Track[]>;
  getSimilarArtists(artistId: string, limit: number): Promise<Artist[]>;
  /** A "radio" of tracks related to the seed. May return [] when the server has no recommender. */
  getMix(seed: Seed, limit: number): Promise<Track[]>;
  getTopTracks(artist: Artist, limit: number): Promise<Track[]>;
  /** Like (favourite / star) or unlike a track on the server. Throws SourceError. */
  setFavorite(trackId: string, on: boolean): Promise<void>;

  streamUrl(track: Track): string;
  imageUrl(imageId: string | undefined, size: number, kind?: 'primary' | 'backdrop'): string | undefined;
}

export class SourceError extends Error {
  constructor(
    message: string,
    public readonly code: 'auth' | 'network' | 'server' | 'protocol',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

/** Minimal HTTP abstraction so sources run in Node, the renderer (via IPC bridge) and tests. */
export interface HttpRequest {
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
}
export interface HttpResponse {
  status: number;
  text: string;
}
export type Http = (url: string, req?: HttpRequest) => Promise<HttpResponse>;
