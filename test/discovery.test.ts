import { describe, expect, it } from 'vitest';
import { buildMixView, buildSmartMix } from '../src/core/discovery';
import { DemoSource } from '../src/core/demo';
import { seededRng } from '../src/core/util';
import type { Seed } from '../src/core/types';

describe('Smart DJ', () => {
  it('builds a de-duplicated mix led by the seed track', async () => {
    const demo = new DemoSource();
    const track = (await demo.getTracks({ limit: 1 }))[0]!;
    const seed: Seed = { kind: 'track', src: 'demo', id: track.id, title: track.title };
    const mix = await buildSmartMix(demo, seed, { limit: 25, rng: seededRng(3), seedTrack: track });
    expect(mix.length).toBeGreaterThan(5);
    expect(mix.length).toBeLessThanOrEqual(25);
    expect(new Set(mix.map((t) => t.id)).size).toBe(mix.length);
    expect(mix[0]!.id).toBe(track.id);
  });

  it('falls back to top tracks / random when the recommender returns nothing or throws', async () => {
    const demo = new DemoSource();
    demo.getMix = async () => {
      throw new Error('no recommender');
    };
    const artist = (await demo.getArtists())[0]!;
    const mix = await buildSmartMix(demo, { kind: 'artist', src: 'demo', id: artist.id, title: artist.name }, { limit: 30, rng: seededRng(1) });
    expect(mix.length).toBeGreaterThan(8);
  });
});

describe('MixView', () => {
  it('artist focus: center + related artists and albums', async () => {
    const demo = new DemoSource();
    const artist = (await demo.getArtists())[0]!;
    const mv = await buildMixView(demo, { kind: 'artist', id: artist.id }, 8);
    expect(mv.center).toMatchObject({ kind: 'artist', id: artist.id });
    expect(mv.related).toHaveLength(8);
    expect(mv.related.some((n) => n.kind === 'artist')).toBe(true);
    expect(mv.related.some((n) => n.id === artist.id && n.kind === 'artist')).toBe(false);
  });

  it('album focus: center + sibling albums + artist', async () => {
    const demo = new DemoSource();
    const album = (await demo.getAlbums('name'))[0]!;
    const mv = await buildMixView(demo, { kind: 'album', id: album.id }, 8);
    expect(mv.center).toMatchObject({ kind: 'album', id: album.id });
    expect(mv.related.length).toBeGreaterThan(0);
    expect(mv.related.some((n) => n.kind === 'album' && n.id === album.id)).toBe(false);
  });

  it('survives servers without a recommender', async () => {
    const demo = new DemoSource();
    demo.getSimilarArtists = async () => {
      throw new Error('unsupported');
    };
    const artist = (await demo.getArtists())[2]!;
    const mv = await buildMixView(demo, { kind: 'artist', id: artist.id }, 6);
    expect(mv.related.length).toBeGreaterThan(0);
  });
});

describe('DemoSource', () => {
  it('serves art for artists, backdrops and albums', async () => {
    const demo = new DemoSource();
    const a = (await demo.getArtists())[0]!;
    expect(demo.imageUrl(a.imageId, 300)).toMatch(/^data:image\/svg\+xml/);
    expect(demo.imageUrl(a.backdropId, 720, 'backdrop')).toMatch(/^data:image\/svg\+xml/);
    expect(demo.imageUrl(undefined, 100)).toBeUndefined();
    expect(demo.imageUrl('nope', 100)).toBeUndefined();
  });

  it('searches across artists, albums and tracks', async () => {
    const demo = new DemoSource();
    const r = await demo.search('aurora');
    expect(r.artists.length).toBeGreaterThan(0);
    expect(r.albums.length).toBeGreaterThan(0);
    expect(r.tracks.length).toBeGreaterThan(0);
  });
});
