import { describe, expect, it } from 'vitest';
import { DemoSource } from '../src/core/demo';
import { JellyfinSource } from '../src/core/jellyfin';
import { SubsonicSource } from '../src/core/subsonic';
import { sortTracks } from '../src/core/util';
import { jfConfig, mockHttp, ndConfig } from './helpers';

const t = (title: string, artist: string, album: string, durationSec: number, trackNo = 1) => ({ title, artist, album, durationSec, trackNo });

describe('sortTracks', () => {
  const list = [t('Zebra', 'The Band', 'LP2', 200), t('apple', 'Ann', 'LP1', 100, 2), t('Mango', 'Ann', 'LP1', 300, 1), t('The Anthem', 'Zed', 'LP3', 50)];

  it('sorts by title ignoring case and leading articles', () => {
    expect(sortTracks(list, { by: 'title' }).map((x) => x.title)).toEqual(['The Anthem', 'apple', 'Mango', 'Zebra']);
  });

  it('sorts by artist, then album order, and reverses on demand', () => {
    expect(sortTracks(list, { by: 'artist' }).map((x) => x.title)).toEqual(['Mango', 'apple', 'Zebra', 'The Anthem']);
    expect(sortTracks(list, { by: 'artist', desc: true }).map((x) => x.title)).toEqual(['The Anthem', 'Zebra', 'apple', 'Mango']);
  });

  it('sorts by album and by length without mutating the input', () => {
    const before = list.map((x) => x.title);
    expect(sortTracks(list, { by: 'album' }).map((x) => x.album)).toEqual(['LP1', 'LP1', 'LP2', 'LP3']);
    expect(sortTracks(list, { by: 'time' }).map((x) => x.durationSec)).toEqual([50, 100, 200, 300]);
    expect(list.map((x) => x.title)).toEqual(before);
  });
});

describe('server-side track sorting', () => {
  it('Jellyfin asks the server to sort, including direction', async () => {
    const { http, calls } = mockHttp({ 'GET /Items': { Items: [] } });
    const jf = new JellyfinSource(jfConfig(), http);
    await jf.getTracks({ sort: { by: 'artist', desc: true } });
    await jf.getTracks({ sort: { by: 'time' } });
    await jf.getTracks();
    const q = (i: number) => calls[i]!.url.searchParams;
    expect(q(0).get('SortBy')).toMatch(/^Artist,/);
    expect(q(0).get('SortOrder')).toBe('Descending');
    expect(q(1).get('SortBy')).toMatch(/^Runtime/);
    expect(q(1).get('SortOrder')).toBe('Ascending');
    expect(q(2).get('SortBy')).toBe('SortName');
    expect(jf.sortsTracksOnServer).toBe(true);
  });

  it('Navidrome cannot sort on the server, so the UI sorts what it has', () => {
    expect(new SubsonicSource(ndConfig(), async () => ({ status: 200, text: '{}' })).sortsTracksOnServer).toBe(false);
  });

  it('the demo library sorts across the whole library, not just one page', async () => {
    const demo = new DemoSource();
    const asc = await demo.getTracks({ limit: 10, sort: { by: 'time' } });
    const desc = await demo.getTracks({ limit: 10, sort: { by: 'time', desc: true } });
    expect(asc[0]!.durationSec).toBeLessThanOrEqual(asc[9]!.durationSec);
    expect(desc[0]!.durationSec).toBeGreaterThanOrEqual(desc[9]!.durationSec);
    expect(desc[0]!.durationSec).toBeGreaterThanOrEqual(asc[9]!.durationSec);
  });
});

describe('playlist dates', () => {
  it('Jellyfin and Navidrome report when a playlist was created', async () => {
    const jf = mockHttp({ 'GET /Items': { Items: [{ Id: 'p1', Name: 'Mix', DateCreated: '2024-05-01T00:00:00Z' }] } });
    expect((await new JellyfinSource(jfConfig(), jf.http).getPlaylists())[0]!.addedAt).toBe('2024-05-01T00:00:00Z');
    expect(jf.calls[0]!.url.searchParams.get('Fields')).toContain('DateCreated');

    const nd = mockHttp({
      'GET /rest/getPlaylists': { 'subsonic-response': { status: 'ok', version: '1.16.1', playlists: { playlist: [{ id: 'x', name: 'Mix', songCount: 3, created: '2023-01-02T00:00:00Z' }] } } },
    });
    const src = new SubsonicSource(ndConfig({ salt: 's', subsonicToken: 't' }), nd.http);
    expect((await src.getPlaylists())[0]!.addedAt).toBe('2023-01-02T00:00:00Z');
  });
});
