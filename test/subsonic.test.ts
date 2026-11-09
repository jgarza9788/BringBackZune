import { describe, expect, it } from 'vitest';
import { md5 } from '../src/core/md5';
import { SubsonicSource } from '../src/core/subsonic';
import { mockHttp, ndConfig } from './helpers';

const ok = (body: Record<string, unknown> = {}) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...body } });

describe('SubsonicSource (Navidrome)', () => {
  it('connects with salted-token auth and stores salt/token, not the password', async () => {
    const { http, calls } = mockHttp({ 'GET /rest/ping': ok() });
    const src = new SubsonicSource(ndConfig(), http, () => 'c19b2d');
    const cfg = await src.connect('sesame');
    expect(cfg.salt).toBe('c19b2d');
    expect(cfg.subsonicToken).toBe(md5('sesamec19b2d'));
    expect(JSON.stringify(cfg)).not.toContain('sesame"');
    const q = calls[0]!.url.searchParams;
    expect(q.get('u')).toBe('justin');
    expect(q.get('t')).toBe('26719a1196d2a940705a59634eb18eab');
    expect(q.get('s')).toBe('c19b2d');
    expect(q.get('v')).toBe('1.16.1');
    expect(q.get('f')).toBe('json');
    expect(q.has('p')).toBe(false);
  });

  it('maps Subsonic error code 40 to an auth error and clears partial credentials', async () => {
    const { http } = mockHttp({
      'GET /rest/ping': { 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong username or password' } } },
    });
    const src = new SubsonicSource(ndConfig(), http, () => 'salt');
    await expect(src.connect('nope')).rejects.toMatchObject({ code: 'auth', message: 'Wrong username or password' });
    expect(src.config.subsonicToken).toBeUndefined();
  });

  it('rejects non-Subsonic JSON', async () => {
    const { http } = mockHttp({ 'GET /rest/ping': { hello: 'world' } });
    const src = new SubsonicSource(ndConfig(), http, () => 's');
    await expect(src.connect('x')).rejects.toMatchObject({ code: 'protocol' });
  });

  const signed = ndConfig({ salt: 's', subsonicToken: 't' });

  it('flattens the artist index', async () => {
    const { http } = mockHttp({
      'GET /rest/getArtists': ok({
        artists: { index: [{ name: 'A', artist: [{ id: 'ar-1', name: 'Aurora', albumCount: 3 }] }, { name: 'T', artist: [{ id: 'ar-2', name: 'Tidewater', coverArt: 'ar-2-x' }] }] },
      }),
    });
    const artists = await new SubsonicSource(signed, http).getArtists();
    expect(artists.map((a) => a.name)).toEqual(['Aurora', 'Tidewater']);
    expect(artists[1]!.imageId).toBe('ar-2-x');
    expect(artists[0]!.imageId).toBe('ar-1');
  });

  it('loads an album with tracks sorted by disc then track', async () => {
    const { http } = mockHttp({
      'GET /rest/getAlbum': ok({
        album: {
          id: 'al-1', name: 'Neon Harbor', artist: 'Aurora', artistId: 'ar-1', year: 2019, coverArt: 'al-1',
          song: [
            { id: 's2', title: 'Two', track: 2, discNumber: 1, duration: 200, suffix: 'FLAC' },
            { id: 's1', title: 'One', track: 1, discNumber: 1, duration: 100 },
            { id: 's3', title: 'Disc2', track: 1, discNumber: 2, duration: 50 },
          ],
        },
      }),
    });
    const { album, tracks } = await new SubsonicSource(signed, http).getAlbum('al-1');
    expect(album).toMatchObject({ title: 'Neon Harbor', year: 2019, artistId: 'ar-1' });
    expect(tracks.map((t) => t.id)).toEqual(['s1', 's2', 's3']);
    expect(tracks[1]).toMatchObject({ container: 'flac', albumId: 'al-1', imageId: 'al-1' });
  });

  it('tolerates empty result sets (omitted arrays)', async () => {
    const { http } = mockHttp({
      'GET /rest/search3': ok({ searchResult3: {} }),
      'GET /rest/getRandomSongs': ok({}),
      'GET /rest/getArtistInfo2': ok({ artistInfo2: {} }),
    });
    const src = new SubsonicSource(signed, http);
    expect(await src.search('zzz')).toEqual({ artists: [], albums: [], tracks: [] });
    expect(await src.getRandomTracks(5)).toEqual([]);
    expect(await src.getSimilarArtists('ar-1', 5)).toEqual([]);
  });

  it('maps album list sort modes to Subsonic list types', async () => {
    const { http, calls } = mockHttp({ 'GET /rest/getAlbumList2': ok({ albumList2: { album: [] } }) });
    const src = new SubsonicSource(signed, http);
    await src.getAlbums('recent', { limit: 10 });
    await src.getAlbums('artist', { limit: 10, offset: 20 });
    await src.getAlbums('name');
    expect(calls.map((c) => c.url.searchParams.get('type'))).toEqual(['newest', 'alphabeticalByArtist', 'alphabeticalByName']);
    expect(calls[1]!.url.searchParams.get('offset')).toBe('20');
  });

  it('builds authenticated stream and cover-art URLs', () => {
    const src = new SubsonicSource(signed, mockHttp({}).http);
    const base = { src: 'nd1', id: 'song-9', title: '', artist: '', album: '', durationSec: 1 };
    const s = new URL(src.streamUrl({ ...base, container: 'flac' }));
    expect(s.pathname).toBe('/rest/stream');
    expect(s.searchParams.get('id')).toBe('song-9');
    expect(s.searchParams.get('t')).toBe('t');
    expect(s.searchParams.has('format')).toBe(false);
    const tc = new URL(src.streamUrl({ ...base, container: 'wma' }));
    expect(tc.searchParams.get('format')).toBe('mp3');
    const img = new URL(src.imageUrl('al-1', 300)!);
    expect(img.pathname).toBe('/rest/getCoverArt');
    expect(img.searchParams.get('size')).toBe('300');
    expect(src.imageUrl(undefined, 300)).toBeUndefined();
  });

  it('uses getSimilarSongs2 for mixes and getTopSongs by artist name', async () => {
    const { http, calls } = mockHttp({
      'GET /rest/getSimilarSongs2': ok({ similarSongs2: { song: [{ id: 'a', title: 'A' }, { id: 'a', title: 'A' }] } }),
      'GET /rest/getTopSongs': ok({ topSongs: { song: [{ id: 'z', title: 'Z' }] } }),
    });
    const src = new SubsonicSource(signed, http);
    expect(await src.getMix({ kind: 'track', src: 'nd1', id: 'x', title: 'x' }, 10)).toHaveLength(1);
    await src.getTopTracks({ src: 'nd1', id: 'ar', name: 'Aurora Lane' }, 5);
    expect(calls.at(-1)!.url.searchParams.get('artist')).toBe('Aurora Lane');
  });
});
