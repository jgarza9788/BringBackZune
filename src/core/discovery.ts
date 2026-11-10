import type { MusicSource, Seed, Track } from './types';
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
