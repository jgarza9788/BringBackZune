import { describe, expect, it } from 'vitest';
import { buildLikesMix, buildSmartMix } from '../src/core/discovery';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/core/settings';
import { emptyTaste, loadTaste, MAX_TASTE_ENTRIES, rankByTaste, recordFinish, recordSkip, skipScore, SKIP_DROP_AT } from '../src/core/taste';
import type { MusicSource, Seed, Track } from '../src/core/types';
import { seededRng } from '../src/core/util';

const track = (id: string, artistId: string): Track => ({ src: 's', id, title: id, artist: artistId, artistId, album: 'A', durationSec: 100 });

describe('taste', () => {
  it('counts skips, forgives on a finished play, and forgets at zero', () => {
    const t = emptyTaste();
    const x = track('1', 'art');
    recordSkip(t, x);
    recordSkip(t, x);
    expect(skipScore(t, x)).toBe(2);
    recordFinish(t, x);
    expect(skipScore(t, x)).toBe(1);
    recordFinish(t, x);
    expect(t.skips).toEqual({});
    recordFinish(t, x); // never goes negative
    expect(t.skips).toEqual({});
  });

  it('keys by artist id, else by lower-cased artist name', () => {
    const t = emptyTaste();
    recordSkip(t, { ...track('1', 'a'), artistId: undefined, artist: 'The Band' });
    expect(Object.keys(t.skips)).toEqual(['s:the band']);
  });

  it('caps how many artists it remembers, keeping the most skipped', () => {
    const t = emptyTaste();
    for (let i = 0; i < MAX_TASTE_ENTRIES + 20; i++) recordSkip(t, track('x', `a${i}`));
    for (let i = 0; i < 5; i++) recordSkip(t, track('x', 'hated'));
    expect(Object.keys(t.skips).length).toBeLessThanOrEqual(MAX_TASTE_ENTRIES);
    expect(skipScore(t, track('x', 'hated'))).toBe(5);
  });

  it('loads defensively', () => {
    expect(loadTaste(null)).toEqual({ skips: {} });
    expect(loadTaste({ skips: { a: 2, b: 'x', c: -1, d: 0, e: 1e9, f: NaN } })).toEqual({ skips: { a: 2, e: 99 } });
  });

  it('puts skipped artists last and drops the heavily skipped when enough else remains', () => {
    const taste = emptyTaste();
    for (let i = 0; i < SKIP_DROP_AT; i++) recordSkip(taste, track('x', 'bad'));
    recordSkip(taste, track('x', 'meh'));
    const mix = [track('1', 'bad'), track('2', 'meh'), ...Array.from({ length: 12 }, (_, i) => track(`g${i}`, 'good'))];
    const ranked = rankByTaste(mix, taste);
    expect(ranked.some((t) => t.artistId === 'bad')).toBe(false);
    expect(ranked[ranked.length - 1]!.artistId).toBe('meh');
    // too little left to be picky: keep them all, but still last
    const small = rankByTaste([track('1', 'bad'), track('2', 'good')], taste);
    expect(small.map((t) => t.artistId)).toEqual(['good', 'bad']);
  });
});

describe('smart dj with taste', () => {
  const lib = Array.from({ length: 30 }, (_, i) => track(`t${i}`, i < 10 ? 'bad' : 'good'));
  const source = { getMix: async () => lib, getRandomTracks: async () => [] } as unknown as MusicSource;
  const seed: Seed = { kind: 'artist', src: 's', id: 'good', title: 'g' };

  it('leaves skipped artists out of the mix', async () => {
    const taste = emptyTaste();
    for (let i = 0; i < SKIP_DROP_AT; i++) recordSkip(taste, track('x', 'bad'));
    const mix = await buildSmartMix(source, seed, { limit: 40, rng: seededRng(1), taste });
    expect(mix).toHaveLength(20);
    expect(mix.every((t) => t.artistId === 'good')).toBe(true);
  });

  it('is unchanged without taste', async () => {
    expect(await buildSmartMix(source, seed, { limit: 40, rng: seededRng(1) })).toHaveLength(30);
  });
});

describe('likes mix', () => {
  it('blends liked songs with recommendations seeded from them, without duplicates', async () => {
    const liked = Array.from({ length: 6 }, (_, i) => track(`l${i}`, 'a'));
    const seeds: Seed[] = [];
    const source = {
      getMix: async (s: Seed) => {
        seeds.push(s);
        return [track('r1', 'b'), track('r2', 'c'), liked[0]!];
      },
    } as unknown as MusicSource;
    const mix = await buildLikesMix(source, liked, { limit: 40, rng: seededRng(3) });
    const ids = mix.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(['r1', 'r2']));
    expect(seeds.length).toBe(4);
    expect(seeds.every((s) => s.kind === 'track' && s.id.startsWith('l'))).toBe(true);
  });

  it('survives a server with no recommender', async () => {
    const liked = [track('l1', 'a'), track('l2', 'a')];
    const source = { getMix: async () => Promise.reject(new Error('nope')) } as unknown as MusicSource;
    expect((await buildLikesMix(source, liked)).map((t) => t.id).sort()).toEqual(['l1', 'l2']);
  });
});

describe('settings: theme, layout, covers, taste', () => {
  it('defaults to dark, custom layout, no covers', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ theme: 'dark', layout: 'custom', covers: {}, taste: { skips: {} } });
  });

  it('keeps valid choices and rejects bad ones', () => {
    expect(sanitizeSettings({ theme: 'light', layout: 'classic' })).toMatchObject({ theme: 'light', layout: 'classic' });
    expect(sanitizeSettings({ theme: 'system' }).theme).toBe('system');
    expect(sanitizeSettings({ theme: 'neon', layout: 'wide' })).toMatchObject({ theme: 'dark', layout: 'custom' });
  });

  it('only keeps small JPEG data-URL covers', () => {
    const good = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const s = sanitizeSettings({
      covers: {
        'a:1': good,
        'a:2': 'https://evil.example/x.jpg',
        'a:3': 'data:image/svg+xml;base64,PHN2Zz4=',
        'a:4': 'data:image/jpeg;base64,' + 'A'.repeat(260_000),
        'a:5': 5,
      },
    });
    expect(s.covers).toEqual({ 'a:1': good });
  });

  it('does not share mutable defaults between loads', () => {
    const a = sanitizeSettings(null);
    a.covers['k'] = 'v';
    a.taste.skips['k'] = 1;
    expect(sanitizeSettings(null).covers).toEqual({});
    expect(DEFAULT_SETTINGS.taste.skips).toEqual({});
  });
});
