import { signal, computed } from '@preact/signals';
import {
  buildSmartMix,
  createSource,
  DEFAULT_SETTINGS,
  newId,
  PlaybackQueue,
  pushHistory,
  setSmartDjSlot,
  togglePin,
  trimUrl,
  type Album,
  type Artist,
  type MusicSource,
  type PinRef,
  type Playlist,
  type RepeatMode,
  type Seed,
  type Settings,
  type SourceConfig,
  type Track,
} from '../core';
import { DEMO_CONFIG, getBridge, isElectron } from './bridge';
import { Engine, type Levels } from './engine';
import { hashFor, parseHash, type Route } from './route';

const bridge = getBridge();

/* ------------------------------------------------------------------ routing */

export { hashFor, parseHash, type Route };

export const route = signal<Route>(parseHash(location.hash));
window.addEventListener('hashchange', () => (route.value = parseHash(location.hash)));
export const go = (r: Route): void => {
  location.hash = hashFor(r);
};

/* ------------------------------------------------------------------ settings */

export const ready = signal(false);
export const settings = signal<Settings>(DEFAULT_SETTINGS);
export const toast = signal<{ msg: string; kind: 'info' | 'error' } | null>(null);
/** Now Playing "art only" mode: chrome hidden, cover centred over the mosaic. Esc leaves it. */
export const npFull = signal(false);
let toastTimer: number | undefined;

export function notify(msg: string, kind: 'info' | 'error' = 'info'): void {
  toast.value = { msg, kind };
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = null), kind === 'error' ? 6000 : 3000);
}

let saveTimer: number | undefined;
function persist(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void bridge.saveSettings(settings.peek()).catch((e: Error) => notify(`Could not save settings: ${e.message}`, 'error'));
  }, 400);
}

export function update(fn: (s: Settings) => void): void {
  const s = structuredClone(settings.peek());
  fn(s);
  settings.value = s;
  persist();
}

export const accent = computed(() => settings.value.accent);
export const ACCENTS = [
  { name: 'magenta', hex: '#D80073' },
  { name: 'orange', hex: '#FA6800' },
  { name: 'cyan', hex: '#1BA1E2' },
  { name: 'green', hex: '#60A917' },
  { name: 'violet', hex: '#AA00FF' },
  { name: 'crimson', hex: '#E51400' },
  { name: 'teal', hex: '#00ABA9' },
  { name: 'amber', hex: '#F0A30A' },
];

/* ------------------------------------------------------------------ sources */

const instances = new Map<string, MusicSource>();
const cache = new Map<string, Promise<unknown>>();

export const getSource = (id: string): MusicSource | undefined => instances.get(id);
export const activeConfig = computed<SourceConfig | undefined>(() => {
  const s = settings.value;
  return s.sources.find((x) => x.id === s.activeSourceId) ?? s.sources[0];
});

/** Memoize an expensive library query per source. */
export function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

function buildInstances(): void {
  for (const cfg of settings.peek().sources) {
    if (!instances.has(cfg.id)) instances.set(cfg.id, createSource(cfg, bridge.http));
  }
}

/** Optimistic like state keyed by `src:id`; overrides `Track.liked` (which only reflects when the track was fetched). */
export const likes = signal<Record<string, boolean>>({});
const likeKey = (t: Pick<Track, 'src' | 'id'>): string => `${t.src}:${t.id}`;
export const isLiked = (t: Track): boolean => likes.value[likeKey(t)] ?? t.liked ?? false;

export async function toggleLike(t: Track): Promise<void> {
  const next = !isLiked(t);
  const k = likeKey(t);
  likes.value = { ...likes.value, [k]: next };
  try {
    await requireSource(t.src).setFavorite(t.id, next);
  } catch (e) {
    likes.value = { ...likes.value, [k]: !next };
    notify(`Could not ${next ? 'like' : 'unlike'} "${t.title}": ${(e as Error).message}`, 'error');
  }
}

export function requireSource(id: string): MusicSource {
  const s = instances.get(id);
  if (!s) throw new Error('That server is no longer configured');
  return s;
}

export function artUrl(srcId: string, imageId: string | undefined, size: number, kind: 'primary' | 'backdrop' = 'primary'): string | undefined {
  return instances.get(srcId)?.imageUrl(imageId, size, kind);
}

export interface NewSourceInput {
  kind: 'jellyfin' | 'navidrome';
  name: string;
  url: string;
  username: string;
  password: string;
  allowSelfSigned: boolean;
}

export async function addSource(input: NewSourceInput): Promise<void> {
  let url = input.url.trim();
  if (!url) throw new Error('Enter the server address');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  url = trimUrl(url);
  try {
    new URL(url);
  } catch {
    throw new Error('That does not look like a valid server address');
  }
  if (!input.username.trim()) throw new Error('Enter a username');
  const host = new URL(url).host;
  const config: SourceConfig = {
    id: newId(),
    kind: input.kind,
    name: input.name.trim() || `${input.kind === 'jellyfin' ? 'Jellyfin' : 'Navidrome'} (${host})`,
    url,
    username: input.username.trim(),
    allowSelfSigned: input.allowSelfSigned,
  };
  // Save first: the main process only trusts self-signed certs for hosts present in saved settings.
  const previous = settings.peek();
  await bridge.saveSettings({ ...previous, sources: [...previous.sources, config] });
  try {
    const inst = createSource(config, bridge.http);
    const signedIn = await inst.connect(input.password);
    instances.set(signedIn.id, inst);
    update((s) => {
      s.sources.push(signedIn);
      s.activeSourceId = s.activeSourceId ?? signedIn.id;
    });
    cache.clear();
  } catch (e) {
    await bridge.saveSettings(previous);
    throw e;
  }
}

export async function reconnectSource(id: string, password: string): Promise<void> {
  const cfg = settings.peek().sources.find((s) => s.id === id);
  if (!cfg) return;
  const inst = createSource(cfg, bridge.http);
  const signedIn = await inst.connect(password);
  instances.set(id, inst);
  update((s) => {
    const i = s.sources.findIndex((x) => x.id === id);
    if (i >= 0) s.sources[i] = signedIn;
  });
  cache.clear();
}

export function addDemoSource(): void {
  if (settings.peek().sources.some((s) => s.kind === 'demo')) return;
  update((s) => {
    s.sources.push(DEMO_CONFIG);
    s.activeSourceId = s.activeSourceId ?? DEMO_CONFIG.id;
  });
  buildInstances();
}

export function removeSource(id: string): void {
  instances.delete(id);
  cache.clear();
  update((s) => {
    s.sources = s.sources.filter((x) => x.id !== id);
    s.quickplay.pins = s.quickplay.pins.filter((p) => p.src !== id);
    s.quickplay.history = s.quickplay.history.filter((p) => p.src !== id);
    s.quickplay.smartDj = s.quickplay.smartDj.map((x) => (x && x.src === id ? null : x));
    if (s.activeSourceId === id) s.activeSourceId = s.sources[0]?.id;
  });
}

export function setActiveSource(id: string): void {
  update((s) => (s.activeSourceId = id));
}

/* ------------------------------------------------------------------ player */

export const player = {
  track: signal<Track | undefined>(undefined),
  playing: signal(false),
  position: signal(0),
  duration: signal(0),
  queue: signal<Track[]>([]),
  index: signal(-1),
  shuffle: signal(false),
  repeat: signal<RepeatMode>('off'),
  volume: signal(0.8),
  mini: signal(false),
  loading: signal(false),
};

const queue = new PlaybackQueue();
let errorSkips = 0;

/** Live band energy (0..1) for the now-playing visualizer. */
export const audioLevels = (): Levels => engine.levels();
/** Spectrum bars (0..1, low to high frequency) for the control-bar visualizer. */
export const audioPlaying = (): boolean => engine.isPlaying();
export const audioSpectrum = (count: number): number[] => engine.spectrum(count);

const engine = new Engine({
  time: (p, d) => {
    player.position.value = p;
    player.duration.value = d;
    if (p > 0) {
      player.loading.value = false;
      errorSkips = 0;
    }
  },
  state: (playing) => (player.playing.value = playing),
  ended: () => {
    const t = queue.next(true);
    syncQueue();
    if (t) startTrack(t);
    else {
      player.playing.value = false;
      player.position.value = 0;
    }
  },
  error: (msg) => {
    player.loading.value = false;
    const t = player.track.peek();
    notify(`${t ? `"${t.title}": ` : ''}${msg}`, 'error');
    // Skip unplayable tracks, but give up after a few in a row so a dead server doesn't spin.
    if (++errorSkips <= 3 && queue.next(false)) {
      syncQueue();
      const n = queue.current;
      if (n) window.setTimeout(() => startTrack(n), 800);
    } else player.playing.value = false;
  },
});

function syncQueue(): void {
  player.queue.value = queue.tracks.slice();
  player.index.value = queue.currentIndex;
}

function historyPin(t: Track): PinRef | undefined {
  if (t.albumId) return { kind: 'album', src: t.src, id: t.albumId, title: t.album, subtitle: t.artist, imageId: t.imageId };
  if (t.artistId) return { kind: 'artist', src: t.src, id: t.artistId, title: t.artist };
  return undefined;
}

function startTrack(t: Track): void {
  const source = instances.get(t.src);
  player.track.value = t;
  player.position.value = 0;
  player.duration.value = t.durationSec;
  player.loading.value = true;
  try {
    if (!source) throw new Error('Server not available');
    engine.load(source.streamUrl(t), t.durationSec);
  } catch (e) {
    notify((e as Error).message, 'error');
    player.loading.value = false;
  }
  const pin = historyPin(t);
  if (pin) update((s) => pushHistory(s.quickplay, pin));
  updateMediaSession(t);
}

export function playTracks(tracks: Track[], start = 0, opts: { shuffle?: boolean } = {}): void {
  if (tracks.length === 0) {
    notify('Nothing to play', 'error');
    return;
  }
  if (opts.shuffle !== undefined && opts.shuffle !== queue.shuffle) {
    queue.setShuffle(opts.shuffle);
    player.shuffle.value = opts.shuffle;
    update((s) => (s.shuffle = opts.shuffle as boolean));
  }
  const first = queue.set(tracks, start);
  syncQueue();
  if (first) startTrack(first);
}

export function enqueue(tracks: Track[], next = false): void {
  if (tracks.length === 0) return;
  const wasEmpty = queue.length === 0;
  if (next) queue.playNext(tracks);
  else queue.enqueue(tracks);
  syncQueue();
  if (wasEmpty && queue.current) startTrack(queue.current);
  notify(next ? 'Playing next' : `Added ${tracks.length === 1 ? 'song' : `${tracks.length} songs`} to now playing`);
}

export function jumpTo(i: number): void {
  const t = queue.jump(i);
  syncQueue();
  if (t) startTrack(t);
}

export function removeFromQueue(i: number): void {
  queue.remove(i);
  syncQueue();
}

export function togglePlay(): void {
  if (!player.track.peek()) {
    const q = queue.current;
    if (q) startTrack(q);
    return;
  }
  if (player.playing.peek()) engine.pause();
  else engine.play();
}

export function nextTrack(): void {
  const t = queue.next(false);
  syncQueue();
  if (t) startTrack(t);
}

export function prevTrack(): void {
  if (player.position.peek() > 3) {
    engine.seek(0);
    return;
  }
  const t = queue.previous();
  syncQueue();
  if (t) startTrack(t);
}

export function seek(sec: number): void {
  engine.seek(sec);
  player.position.value = sec;
}

export function setVolume(v: number): void {
  engine.setVolume(v);
  player.volume.value = v;
  update((s) => (s.volume = v));
}

export function toggleShuffle(): void {
  queue.setShuffle(!queue.shuffle);
  player.shuffle.value = queue.shuffle;
  syncQueue();
  update((s) => (s.shuffle = queue.shuffle));
}

export function cycleRepeat(): void {
  player.repeat.value = queue.cycleRepeat();
  update((s) => (s.repeat = queue.repeat));
}

export async function setMini(on: boolean): Promise<void> {
  player.mini.value = on;
  await bridge.setMini(on).catch(() => undefined);
}

function updateMediaSession(t: Track): void {
  if (!('mediaSession' in navigator)) return;
  const art = artUrl(t.src, t.imageId, 512);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork: art && /^https?:/.test(art) ? [{ src: art, sizes: '512x512' }] : [],
  });
}

function initMediaSession(): void {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => engine.play());
  ms.setActionHandler('pause', () => engine.pause());
  ms.setActionHandler('previoustrack', prevTrack);
  ms.setActionHandler('nexttrack', nextTrack);
  ms.setActionHandler('seekto', (d) => d.seekTime !== undefined && seek(d.seekTime));
}

/* ------------------------------------------------------------------ play helpers */

export async function playAlbum(src: string, id: string, opts: { shuffle?: boolean } = {}): Promise<void> {
  try {
    const { tracks } = await requireSource(src).getAlbum(id);
    playTracks(tracks, 0, opts);
  } catch (e) {
    notify((e as Error).message, 'error');
  }
}

export async function playArtist(src: string, id: string, opts: { shuffle?: boolean } = {}): Promise<void> {
  try {
    const s = requireSource(src);
    const { artist, albums } = await s.getArtist(id);
    let tracks: Track[] = [];
    try {
      tracks = await s.getTopTracks(artist, 50);
    } catch {
      /* fall back to albums */
    }
    if (tracks.length < 5) {
      const parts = await Promise.all(albums.slice(0, 6).map((a) => s.getAlbum(a.id).then((r) => r.tracks)));
      tracks = parts.flat();
    }
    playTracks(tracks, 0, { shuffle: opts.shuffle ?? false });
  } catch (e) {
    notify((e as Error).message, 'error');
  }
}

export async function playPlaylist(src: string, id: string, opts: { shuffle?: boolean } = {}): Promise<void> {
  try {
    const { tracks } = await requireSource(src).getPlaylist(id);
    playTracks(tracks, 0, { shuffle: opts.shuffle ?? false });
  } catch (e) {
    notify((e as Error).message, 'error');
  }
}

/** Play a pinned song: from its position in its album, so the music keeps going afterwards. */
async function playPinnedTrack(p: PinRef): Promise<void> {
  try {
    if (!p.albumId) return notify('This pinned song has no album to play from. Unpin and pin it again.', 'error');
    const { tracks } = await requireSource(p.src).getAlbum(p.albumId);
    const at = tracks.findIndex((t) => t.id === p.id);
    if (at < 0) return notify('That song is no longer in its album', 'error');
    playTracks(tracks, at, { shuffle: false });
  } catch (e) {
    notify((e as Error).message, 'error');
  }
}

export function playPin(p: PinRef): Promise<void> {
  switch (p.kind) {
    case 'artist':
      return playArtist(p.src, p.id);
    case 'playlist':
      return playPlaylist(p.src, p.id);
    case 'track':
      return playPinnedTrack(p);
    default:
      return playAlbum(p.src, p.id);
  }
}

export function openPin(p: PinRef): void {
  switch (p.kind) {
    case 'artist':
      return go({ name: 'artist', src: p.src, id: p.id });
    case 'playlist':
      return go({ name: 'playlist', src: p.src, id: p.id });
    case 'track':
      // A song has no page of its own: open its album, or just play it when we don't know the album.
      return p.albumId ? go({ name: 'album', src: p.src, id: p.albumId }) : void playPin(p);
    default:
      return go({ name: 'album', src: p.src, id: p.id });
  }
}

export const artistPin = (a: Artist): PinRef => ({ kind: 'artist', src: a.src, id: a.id, title: a.name, imageId: a.imageId });
export const playlistPin = (p: Playlist): PinRef => ({ kind: 'playlist', src: p.src, id: p.id, title: p.name, subtitle: p.trackCount != null ? `${p.trackCount} songs` : 'playlist', imageId: p.imageId });
export const albumPin = (a: Album): PinRef => ({ kind: 'album', src: a.src, id: a.id, title: a.title, subtitle: a.artist, imageId: a.imageId });

export function togglePinned(p: PinRef): void {
  let full = false;
  update((s) => {
    full = !togglePin(s.quickplay, p);
  });
  if (full) notify('Quickplay is full: unpin something first (6 pins max)', 'error');
}

/* ------------------------------------------------------------------ smart dj */

export async function playSmartDj(seed: Seed, seedTrack?: Track): Promise<void> {
  try {
    notify(`Building a mix from ${seed.title}…`);
    const tracks = await buildSmartMix(requireSource(seed.src), seed, { limit: 40, seedTrack });
    if (tracks.length === 0) return notify('This server returned no tracks for that mix', 'error');
    playTracks(tracks, 0);
  } catch (e) {
    notify((e as Error).message, 'error');
  }
}

export function assignSmartDj(seed: Seed): void {
  let slot = -1;
  update((s) => {
    slot = s.quickplay.smartDj.findIndex((x) => x === null);
    if (slot < 0) slot = s.quickplay.smartDj.length - 1;
    setSmartDjSlot(s.quickplay, slot, seed);
  });
  notify(`"${seed.title}" added to smart dj slot ${slot + 1}`);
}

export function clearSmartDj(slot: number): void {
  update((s) => setSmartDjSlot(s.quickplay, slot, null));
}

/* ------------------------------------------------------------------ init */

function applyAccent(hex: string): void {
  document.documentElement.style.setProperty('--accent', hex);
}

export function setAccent(hex: string): void {
  update((s) => (s.accent = hex));
  applyAccent(hex);
}

/** Pre-populated Quickplay for the offline/browser preview so the UI isn't empty. */
async function seedPreview(): Promise<void> {
  const s = instances.get('demo');
  if (!s) return;
  const [albums, artists] = await Promise.all([s.getAlbums('name'), s.getArtists()]);
  update((st) => {
    albums.slice(0, 4).forEach((a) => togglePin(st.quickplay, albumPin(a)));
    albums.slice(8, 15).forEach((a) => pushHistory(st.quickplay, albumPin(a)));
    const a0 = artists[1];
    const a1 = artists[4];
    if (a0) setSmartDjSlot(st.quickplay, 0, { kind: 'artist', src: 'demo', id: a0.id, title: a0.name, imageId: a0.imageId });
    if (a1) setSmartDjSlot(st.quickplay, 1, { kind: 'artist', src: 'demo', id: a1.id, title: a1.name, imageId: a1.imageId });
  });
}

export async function init(): Promise<void> {
  initMediaSession();
  const loaded = await bridge.loadSettings();
  settings.value = loaded;
  buildInstances();
  applyAccent(loaded.accent);
  engine.setVolume(loaded.volume);
  player.volume.value = loaded.volume;
  queue.shuffle = loaded.shuffle;
  queue.repeat = loaded.repeat;
  player.shuffle.value = loaded.shuffle;
  player.repeat.value = loaded.repeat;

  if (!isElectron) {
    const q = new URLSearchParams(location.search);
    const accentParam = q.get('accent');
    if (accentParam && /^[0-9a-f]{6}$/i.test(accentParam)) setAccent(`#${accentParam}`);
    await seedPreview();
    const playAlbumId = q.get('play');
    if (playAlbumId) {
      const { tracks } = await requireSource('demo').getAlbum(playAlbumId);
      playTracks(tracks, 2);
      engine.seek(Number(q.get('seek') ?? 74));
      if (q.get('paused') === '1') engine.pause();
    }
    if (q.get('mini') === '1') player.mini.value = true;
    if (q.get('full') === '1') npFull.value = true; // preview only (screenshots)
  }
  ready.value = true;
}
