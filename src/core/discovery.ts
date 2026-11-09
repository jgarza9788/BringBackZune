import type { Album, Artist, MusicSource, Seed, Track } from './types';
import { dedupeBy, shuffled } from './util';

/**
 * Smart DJ: build a mix from a seed. Tries the server's recommender first, then falls back
 * (top tracks of the artist, then random library tracks) so the slot always plays something.
 */
export interface SmartMixOptions {
  limit?: number;
  rng?: () => number;
  /** When the seed is a track, pass it so the mix always starts with it. */
  seedTrack?: Track;
}

export async function buildSmartMix(source: MusicSource, seed: Seed, opts: SmartMixOptions = {}): Promise<Track[]> {
  const limit = opts.limit ?? 40;
  const rng = opts.rng ?? Math.random;
  let tracks: Track[] = [];
  try {
    tracks = await source.getMix(seed, limit);
  } catch {
    /* recommender unavailable: fall through */
  }
  if (tracks.length < 8) {
    try {
      const artistId = await seedArtistId(source, seed);
      if (artistId) {
        const { artist } = await source.getArtist(artistId);
        tracks = tracks.concat(await source.getTopTracks(artist, limit));
      }
    } catch {
      /* ignore */
    }
  }
  if (tracks.length < 8) {
    try {
      tracks = tracks.concat(await source.getRandomTracks(limit));
    } catch {
      /* ignore */
    }
  }
  const lead = seed.kind === 'track' && opts.seedTrack ? [opts.seedTrack] : [];
  const mix = dedupeBy(tracks, (t) => t.id).filter((t) => !lead.some((l) => l.id === t.id));
  // Seed track (if any) leads the mix; everything else is shuffled for variety.
  return [...lead, ...shuffled(mix, rng)].slice(0, limit);
}

async function seedArtistId(source: MusicSource, seed: Seed): Promise<string | undefined> {
  if (seed.kind === 'artist') return seed.id;
  if (seed.kind === 'album') return (await source.getAlbum(seed.id)).album.artistId;
  return undefined;
}

export interface MixNode {
  kind: 'artist' | 'album';
  src: string;
  id: string;
  title: string;
  subtitle?: string;
  imageId?: string;
}

export interface MixViewData {
  center: MixNode;
  related: MixNode[];
}

const artistNode = (a: Artist): MixNode => ({
  kind: 'artist',
  src: a.src,
  id: a.id,
  title: a.name,
  subtitle: a.albumCount ? `${a.albumCount} album${a.albumCount === 1 ? '' : 's'}` : 'artist',
  imageId: a.imageId,
});
const albumNode = (a: Album): MixNode => ({
  kind: 'album',
  src: a.src,
  id: a.id,
  title: a.title,
  subtitle: a.artist,
  imageId: a.imageId,
});

/**
 * MixView: the focused item in the middle, related items around it.
 * Artist -> similar artists + own albums. Album -> sibling albums + similar artists.
 */
export async function buildMixView(
  source: MusicSource,
  focus: { kind: 'artist' | 'album'; id: string },
  max = 8,
): Promise<MixViewData> {
  if (focus.kind === 'artist') {
    const { artist, albums } = await source.getArtist(focus.id);
    let similar: Artist[] = [];
    try {
      similar = await source.getSimilarArtists(focus.id, max);
    } catch {
      /* server has no recommender */
    }
    const related: MixNode[] = [
      ...similar.filter((a) => a.id !== artist.id).slice(0, Math.ceil(max / 2)).map(artistNode),
      ...albums.slice(0, max).map(albumNode),
    ];
    const filled = related.length >= max ? related : related.concat(await fillWithNewest(source, max - related.length, related));
    return { center: artistNode(artist), related: filled.slice(0, max) };
  }

  const { album } = await source.getAlbum(focus.id);
  const related: MixNode[] = [];
  if (album.artistId) {
    const { artist, albums } = await source.getArtist(album.artistId);
    related.push(artistNode(artist));
    related.push(...albums.filter((a) => a.id !== album.id).slice(0, max).map(albumNode));
    try {
      related.push(...(await source.getSimilarArtists(album.artistId, max)).map(artistNode));
    } catch {
      /* ignore */
    }
  }
  const filled = related.length >= max ? related : related.concat(await fillWithNewest(source, max - related.length, related));
  return { center: albumNode(album), related: filled.slice(0, max) };
}

async function fillWithNewest(source: MusicSource, n: number, have: MixNode[]): Promise<MixNode[]> {
  try {
    const seen = new Set(have.map((h) => `${h.kind}:${h.id}`));
    return (await source.getNewestAlbums(n + have.length + 2))
      .map(albumNode)
      .filter((a) => !seen.has(`${a.kind}:${a.id}`))
      .slice(0, n);
  } catch {
    return [];
  }
}
