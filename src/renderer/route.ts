/** Hash routing: pure functions (no DOM access) so they can be unit-tested. */

export type Route =
  | { name: 'quickplay' }
  | { name: 'collection'; tab: 'artists' | 'albums' | 'playlists' | 'songs' }
  | { name: 'artist'; src: string; id: string }
  | { name: 'playlist'; src: string; id: string }
  | { name: 'album'; src: string; id: string }
  | { name: 'nowplaying' }
  | { name: 'search'; q: string }
  | { name: 'sources' };

const enc = encodeURIComponent;

export function hashFor(r: Route): string {
  switch (r.name) {
    case 'quickplay':
    case 'nowplaying':
    case 'sources':
      return `#/${r.name}`;
    case 'collection':
      return `#/collection/${r.tab}`;
    case 'artist':
    case 'album':
    case 'playlist':
      return `#/${r.name}/${enc(r.src)}/${enc(r.id)}`;
    case 'search':
      return `#/search/${enc(r.q)}`;
  }
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [a, b, c] = parts;
  switch (a) {
    case 'collection':
      return { name: 'collection', tab: b === 'albums' || b === 'playlists' || b === 'songs' ? b : 'artists' };
    case 'artist':
    case 'album':
    case 'playlist':
      return b && c ? { name: a, src: b, id: c } : { name: 'quickplay' };
    case 'search':
      return { name: 'search', q: b ?? '' };
    case 'nowplaying':
    case 'sources':
      return { name: a };
    default:
      return { name: 'quickplay' };
  }
}

