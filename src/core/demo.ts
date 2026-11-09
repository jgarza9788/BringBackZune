import type {
  Album,
  AlbumSort,
  Artist,
  MusicSource,
  Page,
  Playlist,
  SearchResults,
  Seed,
  SourceConfig,
  Track,
} from './types';
import { SourceError } from './types';
import { seededRng, shuffled } from './util';

/** Offline sample library (fictional artists, generated typographic cover art, silent playback). */

const ARTISTS: { name: string; hue: number; albums: string[] }[] = [
  { name: 'Aurora Lane', hue: 330, albums: ['Neon Harbor', 'Glass Weather', 'Slow Signals'] },
  { name: 'The Paper Foxes', hue: 24, albums: ['Fieldwork', 'Small Fires'] },
  { name: 'Marlowe Quinn', hue: 205, albums: ['Night Bus', 'Blue Hour', 'Postcards'] },
  { name: 'Hollow Pines', hue: 130, albums: ['Evergreen', 'Last Light on Route 9'] },
  { name: 'Delta Kite', hue: 275, albums: ['Orbit Lines', 'Static Bloom', 'Ten Thousand Fathoms'] },
  { name: 'Sable & Ash', hue: 0, albums: ['Cinders', 'Velvet Hours'] },
  { name: 'Kestrel Moon', hue: 45, albums: ['Wing Count', 'Gold Leaf'] },
  { name: 'Orchid Theory', hue: 300, albums: ['Pressed Flowers', 'Greenhouse', 'Bloom Cycle'] },
  { name: 'Tidewater', hue: 180, albums: ['Low Tide Radio', 'Salt'] },
  { name: 'Ivo Brandt', hue: 90, albums: ['Machines in Color', 'Quiet Engines'] },
  { name: 'Lumen Choir', hue: 60, albums: ['Daybreak Hymns', 'Afterglow'] },
  { name: 'Rook & Rivet', hue: 15, albums: ['Iron Lungs', 'Scrapyard Waltz'] },
  { name: 'Zephyr Grove', hue: 160, albums: ['Windfall', 'Canopy'] },
  { name: 'Nova Kessler', hue: 345, albums: ['Pulse', 'Afterparty at the End of the World'] },
];

const WORDS = [
  'Echo', 'Parade', 'Lantern', 'Rivers', 'Hollow', 'Daylight', 'Satellite', 'Wildfire', 'Coastline', 'Mirror',
  'Open Window', 'Paper Moon', 'Slow Burn', 'Highways', 'Undertow', 'Cobalt', 'Tangerine', 'Weightless', 'Overture',
  'Golden Hour', 'Static', 'Carousel', 'Northbound', 'Embers', 'Velvet', 'Lighthouse', 'Skyline', 'Whisper', 'Gravity',
];

function svgDataUrl(title: string, _subtitle: string, hue: number, wide: boolean): string {
  const w = wide ? 1280 : 600;
  const h = wide ? 720 : 600;
  const bg1 = `hsl(${hue} 70% 38%)`;
  const bg2 = `hsl(${(hue + 40) % 360} 75% 18%)`;
  const initial = (title.trim().charAt(0) || '?').toUpperCase().replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // Decorative only (no title text) so the UI's own captions stay the single source of truth.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<circle cx="${w * 0.78}" cy="${h * 0.3}" r="${h * 0.34}" fill="hsl(${hue} 80% 70% / .18)"/>` +
    (wide ? `<circle cx="${w * 0.2}" cy="${h * 0.85}" r="${h * 0.4}" fill="hsl(${(hue + 60) % 360} 80% 60% / .12)"/>` : '') +
    `<text x="${w * 0.06}" y="${h * 0.86}" font-family="Inter, Segoe UI, sans-serif" font-weight="300" font-size="${h * 0.62}" fill="#fff" fill-opacity=".16">${initial}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface Built {
  artists: Artist[];
  albums: Album[];
  tracksByAlbum: Map<string, Track[]>;
  hueByArtist: Map<string, number>;
}

function build(src: string): Built {
  const rng = seededRng(20091);
  const artists: Artist[] = [];
  const albums: Album[] = [];
  const tracksByAlbum = new Map<string, Track[]>();
  const hueByArtist = new Map<string, number>();
  let n = 0;
  ARTISTS.forEach((a, ai) => {
    const artistId = `ar${ai}`;
    hueByArtist.set(artistId, a.hue);
    artists.push({ src, id: artistId, name: a.name, imageId: artistId, backdropId: artistId, albumCount: a.albums.length });
    a.albums.forEach((title, bi) => {
      const albumId = `al${ai}-${bi}`;
      const year = 2004 + ((ai * 3 + bi * 2) % 20);
      const count = 8 + Math.floor(rng() * 5);
      const tracks: Track[] = [];
      for (let t = 0; t < count; t++) {
        const w1 = WORDS[Math.floor(rng() * WORDS.length)] as string;
        const w2 = WORDS[Math.floor(rng() * WORDS.length)] as string;
        tracks.push({
          src,
          id: `t${n++}`,
          title: t % 3 === 0 ? w1 : `${w1} ${w2}`.slice(0, 28),
          artist: a.name,
          artistId,
          album: title,
          albumId,
          trackNo: t + 1,
          discNo: 1,
          durationSec: 150 + Math.floor(rng() * 160),
          imageId: albumId,
          container: 'flac',
        });
      }
      tracksByAlbum.set(albumId, tracks);
      albums.push({
        src,
        id: albumId,
        title,
        artist: a.name,
        artistId,
        year,
        trackCount: count,
        imageId: albumId,
        addedAt: new Date(Date.UTC(2024, 0, 1) + ((ai * 7 + bi) * 9 + n) * 86_400_000).toISOString(),
      });
    });
  });
  return { artists, albums, tracksByAlbum, hueByArtist };
}

export class DemoSource implements MusicSource {
  readonly kind = 'demo' as const;
  config: SourceConfig;
  private readonly data: Built;

  constructor(id = 'demo') {
    this.config = { id, kind: 'demo', name: 'Demo library', url: 'demo://local', username: 'demo' };
    this.data = build(id);
  }

  async connect(): Promise<SourceConfig> {
    return this.config;
  }
  async ping(): Promise<void> {}

  private allTracks(): Track[] {
    return [...this.data.tracksByAlbum.values()].flat();
  }

  async getArtists(): Promise<Artist[]> {
    return [...this.data.artists].sort((a, b) => a.name.localeCompare(b.name));
  }
  async getArtist(id: string) {
    const artist = this.data.artists.find((a) => a.id === id);
    if (!artist) throw new SourceError('Artist not found', 'server', 404);
    const albums = this.data.albums.filter((a) => a.artistId === id).sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    return { artist, albums };
  }
  async getAlbums(sort: AlbumSort, page: Page = {}): Promise<Album[]> {
    const list = [...this.data.albums];
    if (sort === 'name') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'artist') list.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    else list.sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));
    const off = page.offset ?? 0;
    return list.slice(off, off + (page.limit ?? 200));
  }
  async getAlbum(id: string) {
    const album = this.data.albums.find((a) => a.id === id);
    if (!album) throw new SourceError('Album not found', 'server', 404);
    return { album, tracks: this.data.tracksByAlbum.get(id) ?? [] };
  }
  /** Three fixed sample playlists, derived from the generated library. */
  private playlistDefs(): { playlist: Playlist; tracks: Track[] }[] {
    const all = this.allTracks();
    const defs: [string, Track[]][] = [
      ['Road Trip', all.filter((_, i) => i % 11 === 0)],
      ['Late Night', all.filter((_, i) => i % 13 === 2)],
      ['Favourites', all.filter((_, i) => i % 17 === 5)],
    ];
    return defs.map(([name, tracks]) => ({
      playlist: { src: this.config.id, id: `pl-${name.toLowerCase().replace(/\s+/g, '-')}`, name, trackCount: tracks.length, imageId: tracks[0]?.albumId },
      tracks,
    }));
  }
  async getPlaylists(): Promise<Playlist[]> {
    return this.playlistDefs().map((d) => d.playlist);
  }
  async getPlaylist(id: string) {
    const d = this.playlistDefs().find((x) => x.playlist.id === id);
    if (!d) throw new SourceError('Playlist not found', 'server', 404);
    return d;
  }
  async getTracks(page: Page = {}): Promise<Track[]> {
    const list = this.allTracks().sort((a, b) => a.title.localeCompare(b.title));
    const off = page.offset ?? 0;
    return list.slice(off, off + (page.limit ?? 200));
  }
  async search(query: string): Promise<SearchResults> {
    const q = query.trim().toLowerCase();
    if (!q) return { artists: [], albums: [], tracks: [] };
    return {
      artists: this.data.artists.filter((a) => a.name.toLowerCase().includes(q)),
      albums: this.data.albums.filter((a) => (a.title + ' ' + a.artist).toLowerCase().includes(q)),
      tracks: this.allTracks()
        .filter((t) => (t.title + ' ' + t.artist).toLowerCase().includes(q))
        .slice(0, 30),
    };
  }
  async getNewestAlbums(limit: number): Promise<Album[]> {
    return this.getAlbums('recent', { limit });
  }
  async getRandomTracks(limit: number): Promise<Track[]> {
    return shuffled(this.allTracks()).slice(0, limit);
  }
  async getSimilarArtists(artistId: string, limit: number): Promise<Artist[]> {
    const hue = this.data.hueByArtist.get(artistId) ?? 0;
    const dist = (h: number) => Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue));
    return this.data.artists
      .filter((a) => a.id !== artistId)
      .sort((a, b) => dist(this.data.hueByArtist.get(a.id) ?? 0) - dist(this.data.hueByArtist.get(b.id) ?? 0))
      .slice(0, limit);
  }
  async getMix(seed: Seed, limit: number): Promise<Track[]> {
    const artistId =
      seed.kind === 'artist'
        ? seed.id
        : seed.kind === 'album'
          ? this.data.albums.find((a) => a.id === seed.id)?.artistId
          : this.allTracks().find((t) => t.id === seed.id)?.artistId;
    if (!artistId) return [];
    const near = [artistId, ...(await this.getSimilarArtists(artistId, 3)).map((a) => a.id)];
    return shuffled(this.allTracks().filter((t) => t.artistId && near.includes(t.artistId))).slice(0, limit);
  }
  async getTopTracks(artist: Artist, limit: number): Promise<Track[]> {
    return this.allTracks().filter((t) => t.artistId === artist.id).slice(0, limit);
  }

  /** Demo tracks are silent; the app simulates playback progress. */
  streamUrl(): string {
    return '';
  }

  imageUrl(imageId: string | undefined, _size: number, kind: 'primary' | 'backdrop' = 'primary'): string | undefined {
    if (!imageId) return undefined;
    if (imageId.startsWith('ar')) {
      const artist = this.data.artists.find((a) => a.id === imageId);
      if (!artist) return undefined;
      return svgDataUrl(artist.name, `${artist.albumCount ?? 0} albums`, this.data.hueByArtist.get(imageId) ?? 0, kind === 'backdrop');
    }
    const album = this.data.albums.find((a) => a.id === imageId);
    if (!album) return undefined;
    return svgDataUrl(album.title, album.artist, this.data.hueByArtist.get(album.artistId ?? '') ?? 0, false);
  }
}
