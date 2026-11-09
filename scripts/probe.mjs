// Exercises the real Jellyfin/Navidrome clients against a live server and prints what works.
//   node scripts/probe.mjs <jellyfin|navidrome> <url> <username> <password>
// For self-signed certificates run with NODE_TLS_REJECT_UNAUTHORIZED=0 (probe only; the app has a per-server toggle).
import { createSource } from '../dist/core.mjs';

const [kind, url, username, password] = process.argv.slice(2);
if (!kind || !url || !username) {
  console.error('usage: node scripts/probe.mjs <jellyfin|navidrome> <url> <username> <password>');
  process.exit(2);
}

const http = async (u, req = {}) => {
  const res = await fetch(u, { method: req.method ?? 'GET', headers: req.headers, body: req.body, signal: AbortSignal.timeout(20000) });
  return { status: res.status, text: await res.text() };
};

let failed = 0;
const step = async (name, fn) => {
  try {
    const out = await fn();
    console.log(`PASS  ${name}${out ? '  ' + out : ''}`);
    return out === undefined ? true : true;
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}  ${e.code ?? ''} ${e.message}`);
    return false;
  }
};

const src = createSource({ id: 'probe', kind, name: 'probe', url, username }, http);
let artists = [], albums = [], tracks = [];
if (!(await step('connect', async () => { await src.connect(password ?? ''); return `signed in as ${username}`; }))) process.exit(1);
await step('ping', () => src.ping());
await step('getArtists', async () => { artists = await src.getArtists(); return `${artists.length} artists`; });
await step('getAlbums(name)', async () => { albums = await src.getAlbums('name', { limit: 50 }); return `${albums.length} albums`; });
await step('getAlbums(recent)', async () => `${(await src.getAlbums('recent', { limit: 5 })).length} albums`);
await step('getNewestAlbums', async () => `${(await src.getNewestAlbums(5)).length} albums`);
await step('getTracks (songs tab)', async () => { tracks = await src.getTracks({ limit: 50 }); return `${tracks.length} tracks`; });
if (albums[0]) await step('getAlbum', async () => { const r = await src.getAlbum(albums[0].id); tracks = r.tracks.length ? r.tracks : tracks; return `"${r.album.title}" ${r.tracks.length} tracks, first ${r.tracks[0]?.durationSec ?? '?'}s`; });
if (artists[0]) {
  await step('getArtist', async () => { const r = await src.getArtist(artists[0].id); return `"${r.artist.name}" ${r.albums.length} albums`; });
  await step('getSimilarArtists', async () => `${(await src.getSimilarArtists(artists[0].id, 6)).length} similar (0 is normal without a recommender)`);
  await step('getTopTracks', async () => `${(await src.getTopTracks(artists[0], 5)).length} tracks`);
  await step('getMix(artist)', async () => `${(await src.getMix({ kind: 'artist', src: 'probe', id: artists[0].id, title: artists[0].name }, 10)).length} tracks`);
}
await step('getRandomTracks', async () => `${(await src.getRandomTracks(5)).length} tracks`);
await step('search', async () => { const q = (artists[0]?.name ?? 'a').split(' ')[0]; const r = await src.search(q); return `"${q}": ${r.artists.length} artists, ${r.albums.length} albums, ${r.tracks.length} tracks`; });
if (tracks[0]) {
  await step('stream URL is playable (HTTP 200/206, audio content-type)', async () => {
    const u = src.streamUrl(tracks[0]);
    const res = await fetch(u, { headers: { Range: 'bytes=0-1023' } });
    const type = res.headers.get('content-type') ?? '';
    await res.arrayBuffer();
    if (![200, 206].includes(res.status) || !/audio|octet/.test(type)) throw new Error(`status ${res.status}, content-type ${type}`);
    return `${res.status} ${type}`;
  });
}
const artId = tracks[0]?.imageId ?? albums[0]?.imageId;
if (artId) await step('cover art URL returns an image', async () => {
  const res = await fetch(src.imageUrl(artId, 200));
  const type = res.headers.get('content-type') ?? '';
  await res.arrayBuffer();
  if (res.status !== 200 || !/image/.test(type)) throw new Error(`status ${res.status}, content-type ${type}`);
  return `${res.status} ${type}`;
});
console.log(failed ? `\n${failed} step(s) failed` : '\nall steps passed');
process.exit(failed ? 1 : 0);
