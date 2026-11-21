import { describe, expect, it } from 'vitest';
import { DemoSource } from '../src/core/demo';
import { JellyfinSource } from '../src/core/jellyfin';
import { SubsonicSource } from '../src/core/subsonic';
import { jfConfig, mockHttp, ndConfig } from './helpers';

describe('liking tracks', () => {
  it('Jellyfin: POST likes and DELETE unlikes via /UserFavoriteItems with the user id', async () => {
    const { http, calls } = mockHttp({
      'POST /UserFavoriteItems/t1': {},
      'DELETE /UserFavoriteItems/t1': {},
    });
    const src = new JellyfinSource(jfConfig(), http);
    await src.setFavorite('t1', true);
    await src.setFavorite('t1', false);
    expect(calls.map((c) => `${c.req?.method} ${c.url.pathname}`)).toEqual(['POST /UserFavoriteItems/t1', 'DELETE /UserFavoriteItems/t1']);
    expect(calls[0]!.url.searchParams.get('userId')).toBe('USER');
    expect(calls[0]!.req!.headers!['X-Emby-Token']).toBe('TOKEN');
  });

  it('Jellyfin: falls back to the per-user route on servers older than 10.9', async () => {
    const { http, calls } = mockHttp({ 'POST /Users/USER/FavoriteItems/t1': {} });
    const src = new JellyfinSource(jfConfig(), http);
    await src.setFavorite('t1', true);
    expect(calls.map((c) => c.url.pathname)).toEqual(['/UserFavoriteItems/t1', '/Users/USER/FavoriteItems/t1']);
  });

  it('Jellyfin: surfaces auth and server errors, and treats an empty 204 body as success', async () => {
    const denied = new JellyfinSource(jfConfig(), async () => ({ status: 401, text: '' }));
    await expect(denied.setFavorite('t1', true)).rejects.toMatchObject({ code: 'auth' });

    const broken = new JellyfinSource(jfConfig(), async () => ({ status: 500, text: '' }));
    await expect(broken.setFavorite('t1', true)).rejects.toMatchObject({ code: 'server' });

    const empty = new JellyfinSource(jfConfig(), async () => ({ status: 204, text: '' }));
    await expect(empty.setFavorite('t1', true)).resolves.toBeUndefined();

    const signedOut = new JellyfinSource(jfConfig({ token: undefined, userId: undefined }), async () => ({ status: 204, text: '' }));
    await expect(signedOut.setFavorite('t1', true)).rejects.toMatchObject({ code: 'auth' });
  });

  it('Jellyfin: reads the favourite flag from UserData', async () => {
    const { http } = mockHttp({
      'GET /Items': { Items: [{ Id: 'a', Name: 'Liked', UserData: { IsFavorite: true } }, { Id: 'b', Name: 'Plain' }] },
    });
    const tracks = await new JellyfinSource(jfConfig(), http).getTracks();
    expect(tracks.map((t) => t.liked)).toEqual([true, undefined]);
  });

  it('Navidrome: uses star / unstar and maps the starred flag', async () => {
    const ok = { 'subsonic-response': { status: 'ok', version: '1.16.1' } };
    const { http, calls } = mockHttp({ 'GET /rest/star': ok, 'GET /rest/unstar': ok });
    const src = new SubsonicSource(ndConfig({ salt: 's', subsonicToken: 't' }), http);
    await src.setFavorite('song1', true);
    await src.setFavorite('song1', false);
    expect(calls.map((c) => c.url.pathname)).toEqual(['/rest/star', '/rest/unstar']);
    expect(calls[0]!.url.searchParams.get('id')).toBe('song1');
  });

  it('Demo: remembers likes on the track objects it hands out', async () => {
    const demo = new DemoSource();
    const { tracks } = await demo.getAlbum((await demo.getAlbums('name'))[0]!.id);
    await demo.setFavorite(tracks[0]!.id, true);
    expect((await demo.getAlbum(tracks[0]!.albumId!)).tracks[0]!.liked).toBe(true);
    await demo.setFavorite(tracks[0]!.id, false);
    expect((await demo.getAlbum(tracks[0]!.albumId!)).tracks[0]!.liked).toBe(false);
  });
});
