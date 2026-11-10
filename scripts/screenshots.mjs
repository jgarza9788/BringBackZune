// Renders the UI (offline demo library) to PNGs with headless Chrome for visual review.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = process.env.CHROME ?? 'google-chrome';
const page = pathToFileURL(path.resolve('dist/renderer/index.html')).href;
const out = path.resolve('screenshots');
mkdirSync(out, { recursive: true });

const scenes = [
  ['quickplay', '?play=al1-0#/quickplay'],
  ['collection-artists', '#/collection/artists'],
  ['collection-albums', '#/collection/albums'],
  ['collection-songs', '#/collection/songs'],
  ['collection-playlists', '#/collection/playlists'],
  ['artist', '#/artist/demo/ar0'],
  ['album', '?play=al1-0#/album/demo/al0-0'],
  ['nowplaying', '?play=al0-0&accent=1BA1E2#/nowplaying'],
  ['search', '#/search/aurora'],
  ['sources', '#/sources'],
  ['mini', '?play=al0-0&mini=1#/quickplay', '500,470'],
];

for (const [name, suffix, size = '1280,800'] of scenes) {
  const file = path.join(out, `${name}.png`);
  try {
    execFileSync(
      chrome,
      [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
        `--window-size=${size}`, '--virtual-time-budget=5000', `--screenshot=${file}`,
        page.replace('index.html', 'index.html') + suffix,
      ],
      { stdio: 'pipe', timeout: 60000 },
    );
    console.log('ok  ', name);
  } catch (e) {
    console.log('FAIL', name, String(e.stderr ?? e.message).split('\n')[0]);
  }
}
