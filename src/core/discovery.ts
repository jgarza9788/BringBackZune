import type { MusicSource, Seed, Track } from './types';
import { rankByTaste, type Taste } from './taste';
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
  /** What the listener tends to skip: those artists sink to the end of the mix (or drop out). */
  taste?: Taste;
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
  // Seed track (if any) leads the mix; everything else is shuffled for variety, then ordered by taste.
  return [...lead, ...rankByTaste(shuffled(mix, rng), opts.taste)].slice(0, limit);
}

/**
 * Smart DJ from the listener's likes: some liked songs, plus the server's recommendations seeded from a few of them.
 * `liked` is whatever `getLikedTracks` returned.
 */
export async function buildLikesMix(source: MusicSource, liked: Track[], opts: SmartMixOptions = {}): Promise<Track[]> {
  const limit = opts.limit ?? 40;
  const rng = opts.rng ?? Math.random;
  const seeds = shuffled(liked, rng).slice(0, 4);
  const similar = await Promise.all(
    seeds.map((t) =>
      source.getMix({ kind: 'track', src: t.src, id: t.id, title: t.title }, 15).catch(() => [] as Track[]),
    ),
  );
  const mix = dedupeBy([...shuffled(liked, rng).slice(0, 12), ...similar.flat()], (t) => t.id);
  return rankByTaste(shuffled(mix, rng), opts.taste).slice(0, limit);
}

async function seedArtistId(source: MusicSource, seed: Seed): Promise<string | undefined> {
  if (seed.kind === 'artist') return seed.id;
  if (seed.kind === 'album') return (await source.getAlbum(seed.id)).album.artistId;
  return undefined;
}
