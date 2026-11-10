import { describe, expect, it } from 'vitest';
import { hashFor, parseHash, type Route } from '../src/renderer/route';

describe('routing', () => {
  const routes: Route[] = [
    { name: 'quickplay' },
    { name: 'nowplaying' },
    { name: 'sources' },
    { name: 'collection', tab: 'albums' },
    { name: 'collection', tab: 'playlists' },
    { name: 'playlist', src: 'nd1', id: 'pl 1' },
    { name: 'artist', src: 'jf 1', id: 'a/b?c' },
    { name: 'album', src: 'nd1', id: 'al-9' },
    { name: 'search', q: 'sigur rós & more' },
  ];

  it('round-trips every route, including ids with special characters', () => {
    for (const r of routes) expect(parseHash(hashFor(r))).toEqual(r);
  });

  it('falls back to quickplay on junk or incomplete hashes', () => {
    for (const h of ['', '#', '#/nope', '#/artist/onlysrc', '#/mixview/s/artist/id', '#/album']) {
      expect(parseHash(h)).toEqual({ name: 'quickplay' });
    }
    expect(parseHash('#/collection/zzz')).toEqual({ name: 'collection', tab: 'artists' });
    expect(parseHash('#/search')).toEqual({ name: 'search', q: '' });
  });
});
