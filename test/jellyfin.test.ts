import { describe, expect, it } from 'vitest';
import { JellyfinSource } from '../src/core/jellyfin';
import { SourceError } from '../src/core/types';
import { jfConfig, mockHttp } from './helpers';

describe('JellyfinSource', () => {
  it('authenticates by name and stores token + user id (never the password)', async () => {
    const { http, calls } = mockHttp({
      'POST /Users/AuthenticateByName': { AccessToken: 'abc', User: { Id: 'u1' } },
    });
    const src = new JellyfinSource(jfConfig({ token: undefined, userId: undefined }), http);
    const cfg = await src.connect('hunter2');
    expect(cfg.token).toBe('abc');
    expect(cfg.userId).toBe('u1');
    expect(JSON.stringify(cfg)).not.toContain('hunter2');
    const call = calls[0]!;
    expect(call.url.origin + call.url.pathname).toBe('https://jf.example.com/Users/AuthenticateByName');
    expect(JSON.parse(call.req!.body!)).toEqual({ Username: 'justin', Pw: 'hunter2' });
    expect(call.req!.headers!.Authorization).toMatch(/^MediaBrowser Client="Bring Back Zune"/);
    expect(call.req!.headers!.Authorization).not.toContain('Token=');
  });

  it('maps auth failures', async () => {
    const { http } = mockHttp({ 'POST /Users/AuthenticateByName': { __status: 401 } });
    const src = new JellyfinSource(jfConfig({ token: undefined }), http);
    await expect(src.connect('bad')).rejects.toMatchObject({ name: 'SourceError', code: 'auth' });
  });

  it('maps unreachable servers and non-JSON responses', async () => {
    const down = new JellyfinSource(jfConfig(), async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(down.ping()).rejects.toMatchObject({ code: 'network' });

    const html = new JellyfinSource(jfConfig(), async () => ({ status: 200, text: '<html>' }));
    await expect(html.ping()).rejects.toMatchObject({ code: 'protocol' });
  });

  it('refuses to query when not signed in', async () => {
    const { http } = mockHttp({});
    const src = new JellyfinSource(jfConfig({ token: undefined, userId: undefined }), http);
    await expect(src.getArtists()).rejects.toBeInstanceOf(SourceError);
  });

  it('lists album artists with paging and maps images', async () => {
    const { http, calls } = mockHttp({
      'GET /Artists/AlbumArtists': (u) => {
        const start = Number(u.searchParams.get('StartIndex'));
        return start === 0
          ? { Items: Array.from({ length: 500 }, (_, i) => ({ Id: `a${i}`, Name: `Artist ${i}`, ImageTags: { Primary: 'x' } })) }
          : { Items: [{ Id: 'last', Name: 'Zed' }] };
      },
    });
    const src = new JellyfinSource(jfConfig(), http);
    const artists = await src.getArtists();
    expect(artists).toHaveLength(501);
    expect(artists[0]).toMatchObject({ src: 'jf1', id: 'a0', imageId: 'a0' });
    expect(artists[500]).toMatchObject({ id: 'last', imageId: undefined });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.searchParams.get('UserId')).toBe('USER');
    expect(calls[0]!.req!.headers!['X-Emby-Token']).toBe('TOKEN');
  });

  it('maps albums and tracks (ticks -> seconds, album art fallback)', async () => {
    const { http, calls } = mockHttp({
      'GET /Items': (u) =>
        u.searchParams.get('Ids') === 'alb1'
          ? { Items: [{ Id: 'alb1', Name: 'Neon Harbor', AlbumArtist: 'Aurora Lane', AlbumArtists: [{ Id: 'ar1', Name: 'Aurora Lane' }], ProductionYear: 2019, ChildCount: 2, ImageTags: { Primary: 'p' } }] }
          : {
              Items: [
                { Id: 't1', Name: 'Intro', Artists: ['Aurora Lane'], ArtistItems: [{ Id: 'ar1', Name: 'Aurora Lane' }], Album: 'Neon Harbor', AlbumId: 'alb1', AlbumPrimaryImageTag: 'p', IndexNumber: 1, ParentIndexNumber: 1, RunTimeTicks: 1_830_000_000, Container: 'FLAC' },
              ],
            },
    });
    const src = new JellyfinSource(jfConfig(), http);
    const { album, tracks } = await src.getAlbum('alb1');
    expect(album).toMatchObject({ title: 'Neon Harbor', artist: 'Aurora Lane', artistId: 'ar1', year: 2019, imageId: 'alb1' });
    expect(tracks[0]).toMatchObject({ title: 'Intro', durationSec: 183, imageId: 'alb1', container: 'flac', trackNo: 1 });
    const trackCall = calls.find((c) => c.url.searchParams.get('ParentId') === 'alb1')!;
    expect(trackCall.url.searchParams.get('IncludeItemTypes')).toBe('Audio');
  });

  it('builds stream URLs: direct for native containers, MP3 transcode otherwise', () => {
    const src = new JellyfinSource(jfConfig(), mockHttp({}).http);
    const base = { src: 'jf1', id: 't 1', title: '', artist: '', album: '', durationSec: 1 };
    const direct = new URL(src.streamUrl({ ...base, container: 'flac' }));
    expect(direct.pathname).toBe('/Audio/t%201/stream');
    expect(direct.searchParams.get('static')).toBe('true');
    expect(direct.searchParams.get('api_key')).toBe('TOKEN');
    const tc = new URL(src.streamUrl({ ...base, container: 'wma' }));
    expect(tc.pathname).toBe('/Audio/t%201/stream.mp3');
    expect(tc.searchParams.get('audioCodec')).toBe('mp3');
  });

  it('builds image URLs (primary + backdrop) and tolerates missing ids', () => {
    const src = new JellyfinSource(jfConfig(), mockHttp({}).http);
    expect(src.imageUrl(undefined, 300)).toBeUndefined();
    const u = new URL(src.imageUrl('abc', 300)!);
    expect(u.pathname).toBe('/Items/abc/Images/Primary');
    expect(u.searchParams.get('maxHeight')).toBe('300');
    expect(new URL(src.imageUrl('abc', 720, 'backdrop')!).pathname).toBe('/Items/abc/Images/Backdrop');
  });

  it('uses InstantMix for mixes and /Similar for related artists', async () => {
    const { http, calls } = mockHttp({
      'GET /Items/seed1/InstantMix': { Items: [{ Id: 'a', Name: 'A' }, { Id: 'a', Name: 'A' }, { Id: 'b', Name: 'B' }] },
      'GET /Artists/ar1/Similar': { Items: [{ Id: 'ar2', Name: 'Similar' }] },
    });
    const src = new JellyfinSource(jfConfig(), http);
    const mix = await src.getMix({ kind: 'artist', src: 'jf1', id: 'seed1', title: 's' }, 20);
    expect(mix.map((t) => t.id)).toEqual(['a', 'b']);
    const sim = await src.getSimilarArtists('ar1', 6);
    expect(sim[0]).toMatchObject({ id: 'ar2', name: 'Similar' });
    expect(calls.at(-1)!.url.searchParams.get('Limit')).toBe('6');
  });

  it('returns empty search results for blank queries without hitting the network', async () => {
    const { http, calls } = mockHttp({});
    const src = new JellyfinSource(jfConfig(), http);
    expect(await src.search('   ')).toEqual({ artists: [], albums: [], tracks: [] });
    expect(calls).toHaveLength(0);
  });
});
