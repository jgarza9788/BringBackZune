// UI smoke test: drives the built renderer in headless Chrome over the DevTools protocol,
// clicks through real interactions against the offline demo library and fails on any console error.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const chrome = process.env.CHROME ?? 'google-chrome';
const port = 9333 + Math.floor(Math.random() * 500);
const page = pathToFileURL(path.resolve('dist/renderer/index.html')).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => proc.kill('SIGKILL');
process.on('exit', cleanup);

let target;
for (let i = 0; i < 50 && !target; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {
    /* chrome still starting */
  }
  if (!target) await sleep(200);
}
if (!target) {
  console.error('Could not reach Chrome DevTools');
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const problems = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    problems.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    problems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result.result.value;
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

const failures = [];
let passed = 0;
const check = (name, cond, extra = '') => {
  if (cond) passed++;
  else failures.push(`${name} ${extra}`);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`);
};
const nav = async (hash) => {
  await ev(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(450);
};
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const click = (sel, i = 0) => ev(`(document.querySelectorAll(${JSON.stringify(sel)})[${i}])?.click() ?? 'missing'`);

await send('Page.navigate', { url: page + '#/quickplay' });
await sleep(1500);

check('app boots (shell rendered)', (await count('.shell')) === 1);
check('quickplay shows pre-seeded tiles', (await count('.tile')) > 8, `tiles=${await count('.tile')}`);
check('pins 4/6 and 5 smart dj slots', (await text('.count')) === '4/6' && (await count('.row-grid.five > *')) === 5);

// Play from a "new" tile, simulate progress.
const before = await text('.bar-title');
await ev(`document.querySelectorAll('.qp-wide .tile-play')[0].click()`);
await sleep(900);
const t1 = await text('.bar-title');
check('clicking a tile play button starts an album', !!t1 && t1 !== before, `title=${t1}`);
const pos1 = await ev(`document.querySelectorAll('.progress .time')[0].textContent`);
await sleep(1600);
const pos2 = await ev(`document.querySelectorAll('.progress .time')[0].textContent`);
check('playback position advances', pos1 !== pos2, `${pos1} -> ${pos2}`);

await click('.transport .ib:nth-child(3)');
await sleep(500);
const t2 = await text('.bar-title');
check('next track changes the track', t2 !== t1, `${t1} -> ${t2}`);
await click('.transport .ib:nth-child(1)');
await sleep(300);
check('previous (within 3s) goes back to track 1', (await text('.bar-title')) === t1);

await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true}))`);
await sleep(200);
check('space pauses (play icon shown)', (await ev(`document.querySelector('.ib.play').title`)) === 'Play');
await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true}))`);
await sleep(200);
check('space resumes', (await ev(`document.querySelector('.ib.play').title`)) === 'Pause');

const onBefore = await count('.bar-right .ib.on');
await click('.bar-right .ib[title="Shuffle"]');
await sleep(200);
check('shuffle toggles on', (await count('.bar-right .ib.on')) === onBefore + 1);
await click('.bar-right .ib[title^="Repeat"]');
await sleep(150);
check('repeat cycles to "all"', (await ev(`document.querySelector('.bar-right .ib[title^="Repeat"]').title`)) === 'Repeat: all');

// Library browsing
await nav('#/collection/songs');
check('songs tab lists tracks', (await count('.track')) > 20, `rows=${await count('.track')}`);
const rowTitle = await ev(`document.querySelectorAll('.track .track-title')[3].textContent`);
await ev(`document.querySelectorAll('.track')[3].dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
await sleep(500);
check('double-click row plays that song', (await text('.bar-title')) === rowTitle, `${await text('.bar-title')} vs ${rowTitle}`);

await nav('#/collection/albums');
check('albums grid renders', (await count('.grid .tile')) >= 20);
await nav('#/collection/artists');
check('artists grouped by letter', (await count('.letter-group')) >= 8);

await nav('#/artist/demo/ar0');
check('artist page: hero + albums', (await text('.hero-info h1')) === 'Aurora Lane' && (await count('.grid .tile')) === 3);
await nav('#/album/demo/al3-0');
check('album page lists numbered tracks', (await count('.track')) >= 8);
await click('.actions .btn:nth-child(6)'); // pin
await sleep(300);
check('pin button toggles to "pinned"', /pinned/.test((await text('.actions .btn:nth-child(6)')) ?? ''));
await click('.actions .btn:nth-child(5)'); // smart dj
await sleep(1200);
check('smart dj builds a queue and plays', (await count('.shell')) === 1 && !!(await text('.bar-title')));

await nav('#/quickplay');
check('quickplay now shows 5/6 pins', (await text('.count')) === '5/6');

await nav('#/nowplaying');
check('now playing: title + queue', !!(await text('.np-title')) && (await count('.np-queue li')) > 0);
await click('.np-queue li .q-main');
await sleep(400);
check('queue item jump works', !!(await text('.np-title')));

await nav('#/mixview/demo/artist/ar0');
check('mixview shows 8 related tiles', (await count('.mix-sat')) === 8);
const hashBefore = await ev('location.hash');
await click('.mix-sat', 2);
await sleep(500);
check('mixview re-centres on click', (await ev('location.hash')) !== hashBefore && (await count('.mix-sat')) === 8);

await nav('#/search/aurora');
check('search results (artists/albums/songs)', (await count('.search .section')) === 3);
await ev(`(() => { const i=document.querySelector('.search-box'); i.value='zzzz'; i.dispatchEvent(new Event('input',{bubbles:true})); })()`);
await sleep(900);
check('search with no matches shows empty state', /no results/.test((await text('.search .status')) ?? ''));

// Sources: bad server must surface an error, not crash.
await nav('#/sources');
await ev(`(() => {
  const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const inputs = document.querySelectorAll('.form input');
  set(inputs[1], '192.168.1.99:8096'); set(inputs[2], 'justin'); set(inputs[3], 'pw');
})()`);
await ev(`document.querySelector('.form').requestSubmit()`);
await sleep(700);
const err = await text('.form-error');
check('unreachable server shows a friendly error', /Cannot reach server/.test(err ?? ''), `error=${err}`);
check('failed add leaves server list unchanged', (await count('.source-list li')) === 1);

// Accent colour + mini player
await click('.swatch', 2);
await sleep(200);
check('accent colour applies', (await ev(`document.documentElement.style.getPropertyValue('--accent')`)).toUpperCase() === '#1BA1E2');
await nav('#/quickplay');
await click('.bar-right .ib[title="Mini player"]');
await sleep(400);
check('mini player replaces the shell', (await count('.mini')) === 1 && (await count('.shell')) === 0);
await click('.mini-x');
await sleep(400);
check('mini player can return to full window', (await count('.shell')) === 1);

check('no console errors or uncaught exceptions', problems.length === 0, problems.slice(0, 5).join(' | '));
ws.close();
cleanup();
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
