import { describe, expect, it } from 'vitest';
import { DemoSource } from '../src/core/demo';
import { JellyfinSource } from '../src/core/jellyfin';
import { SubsonicSource } from '../src/core/subsonic';
import { buildUrl } from '../src/core/util';
import { jfConfig, mockHttp, ndConfig } from './helpers';

const ok = (extra: object = {}) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...extra } });

describe('buildUrl', () => {
  it('repeats a parameter for list values', () => {
    expect(buildUrl('http://h', '/x', { id: ['a', 'b'], n: 1 })).toBe('http://h/x?id=a&id=b&n=1');
  });
});

describe('Jellyfin playlists and likes', () => {
  it('creates a playlist with a JSON body and reads the new id', async () => {
    const { http, calls } = mockHttp({ 'POST /Playlists': { Id: 'pl9' } });
    const made = await new JellyfinSource(jfConfig(), http).createPlaylist('Road trip', ['t1', 't2']);
    expect(made).toMatchObject({ id: 'pl9', name: 'Road trip', trackCount: 2, src: 'jf1' });
    const body = JSON.parse(calls[0]!.req!.body!);
    expect(body).toEqual({ Name: 'Road trip', Ids: ['t1', 't2'], UserId: 'USER', MediaType: 'Audio' });
    expect(calls[0]!.req!.headers!['Content-Type']).toBe('application/json');
  });

  it('fails clearly when the server does not return an id', async () => {
    const { http } = mockHttp({ 'POST /Playlists': {} });
    await expect(new JellyfinSource(jfConfig(), http).createPlaylist('x', [])).rejects.toMatchObject({ code: 'protocol' });
  });

  it('adds tracks with a comma-separated id list, accepting an empty 204', async () => {
    const calls: string[] = [];
    const src = new JellyfinSource(jfConfig(), async (url, req) => {
      calls.push(`${req?.method} ${url}`);
      return { status: 204, text: '' };
    });
    await src.addToPlaylist('pl 1', ['a', 'b']);
    expect(calls[0]).toContain('POST https://jf.example.com/Playlists/pl%201/Items');
    expect(calls[0]).toContain('ids=a%2Cb');
    expect(calls[0]).toContain('userId=USER');
    await src.addToPlaylist('pl 1', []);
    expect(calls).toHaveLength(1);
  });

  it('reports auth and server failures on writes', async () => {
    await expect(new JellyfinSource(jfConfig(), async () => ({ status: 403, text: '' })).addToPlaylist('p', ['a'])).rejects.toMatchObject({ code: 'auth' });
    await expect(new JellyfinSource(jfConfig(), async () => ({ status: 500, text: '' })).addToPlaylist('p', ['a'])).rejects.toMatchObject({ code: 'server' });
    await expect(new JellyfinSource(jfConfig({ token: undefined }), async () => ({ status: 204, text: '' })).addToPlaylist('p', ['a'])).rejects.toMatchObject({ code: 'auth' });
  });

  it('lists favourites with the IsFavorite filter and marks them liked', async () => {
    const { http, calls } = mockHttp({ 'GET /Items': { Items: [{ Id: 'a', Name: 'One' }] } });
    const tracks = await new JellyfinSource(jfConfig(), http).getLikedTracks(50);
    expect(calls[0]!.url.searchParams.get('Filters')).toBe('IsFavorite');
    expect(calls[0]!.url.searchParams.get('Limit')).toBe('50');
    expect(tracks[0]).toMatchObject({ id: 'a', liked: true });
  });
});

describe('Navidrome playlists and likes', () => {
  const cfg = ndConfig({ salt: 's', subsonicToken: 't' });

  it('creates a playlist, sending one songId per track', async () => {
    const { http, calls } = mockHttp({ 'GET /rest/createPlaylist': ok({ playlist: { id: 'p1', name: 'Mix', songCount: 2 } }) });
    const made = await new SubsonicSource(cfg, http).createPlaylist('Mix', ['s1', 's2']);
    expect(made).toMatchObject({ id: 'p1', name: 'Mix', trackCount: 2 });
    expect(calls[0]!.url.searchParams.getAll('songId')).toEqual(['s1', 's2']);
    expect(calls[0]!.url.searchParams.get('name')).toBe('Mix');
  });

  it('finds the playlist by name when an older server returns no body for it', async () => {
    const { http } = mockHttp({
      'GET /rest/createPlaylist': ok(),
      'GET /rest/getPlaylists': ok({ playlists: { playlist: [{ id: 'p7', name: 'Mix', songCount: 1 }] } }),
    });
    expect(await new SubsonicSource(cfg, http).createPlaylist('Mix', ['s1'])).toMatchObject({ id: 'p7' });
  });

  it('appends with updatePlaylist / songIdToAdd', async () => {
    const { http, calls } = mockHttp({ 'GET /rest/updatePlaylist': ok() });
    const src = new SubsonicSource(cfg, http);
    await src.addToPlaylist('p1', ['a', 'b']);
    expect(calls[0]!.url.searchParams.get('playlistId')).toBe('p1');
    expect(calls[0]!.url.searchParams.getAll('songIdToAdd')).toEqual(['a', 'b']);
    await src.addToPlaylist('p1', []);
    expect(calls).toHaveLength(1);
  });

  it('reads starred songs', async () => {
    const { http } = mockHttp({ 'GET /rest/getStarred2': ok({ starred2: { song: [{ id: 's1', title: 'A' }, { id: 's2', title: 'B' }] } }) });
    const tracks = await new SubsonicSource(cfg, http).getLikedTracks(1);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ id: 's1', liked: true });
  });
});

describe('Demo playlists and likes', () => {
  it('makes a playlist, lists it and lets it grow', async () => {
    const demo = new DemoSource();
    const tracks = await demo.getTracks({ limit: 5 });
    const made = await demo.createPlaylist('Mine', tracks.slice(0, 2).map((t) => t.id));
    expect((await demo.getPlaylists()).some((p) => p.id === made.id)).toBe(true);
    await demo.addToPlaylist(made.id, [tracks[3]!.id]);
    const { tracks: inside, playlist } = await demo.getPlaylist(made.id);
    expect(inside.map((t) => t.id)).toEqual([tracks[0]!.id, tracks[1]!.id, tracks[3]!.id]);
    expect(playlist.trackCount).toBe(3);
    await expect(demo.addToPlaylist('pl-road-trip', ['x'])).rejects.toMatchObject({ code: 'server' });
  });

  it('returns only liked tracks', async () => {
    const demo = new DemoSource();
    const [a, b] = await demo.getTracks({ limit: 2 });
    await demo.setFavorite(a!.id, true);
    const liked = await demo.getLikedTracks(10);
    expect(liked.map((t) => t.id)).toEqual([a!.id]);
    expect(liked.some((t) => t.id === b!.id)).toBe(false);
  });
});
