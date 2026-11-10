import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { formatTime } from '../core';
import {
  activeConfig,
  cycleRepeat,
  go,
  nextTrack,
  npFull,
  player,
  prevTrack,
  ready,
  route,
  seek,
  setActiveSource,
  setMini,
  setVolume,
  settings,
  toast,
  toggleShuffle,
  togglePlay,
  type Route,
} from './state';
import { getBridge } from './bridge';
import { Art, Icon, LikeButton } from './ui';
import { AlbumPage, ArtistPage, Collection, PlaylistPage, Quickplay } from './views-library';
import { Visualizer } from './visualizer';
import { NowPlaying, SearchView, SourcesView } from './views-play';

const PIVOT: { label: string; match: Route['name'][]; to: Route }[] = [
  { label: 'quickplay', match: ['quickplay'], to: { name: 'quickplay' } },
  { label: 'collection', match: ['collection', 'artist', 'album', 'playlist'], to: { name: 'collection', tab: 'artists' } },
  { label: 'now playing', match: ['nowplaying'], to: { name: 'nowplaying' } },
];

function View({ r }: { r: Route }): JSX.Element {
  switch (r.name) {
    case 'quickplay':
      return <Quickplay />;
    case 'collection':
      return <Collection tab={r.tab} />;
    case 'artist':
      return <ArtistPage src={r.src} id={r.id} />;
    case 'album':
      return <AlbumPage src={r.src} id={r.id} />;
    case 'playlist':
      return <PlaylistPage src={r.src} id={r.id} />;
    case 'nowplaying':
      return <NowPlaying />;
    case 'search':
      return <SearchView q={r.q} />;
    case 'sources':
      return <SourcesView />;
  }
}

export function App(): JSX.Element {
  useGlobalKeys();
  if (!ready.value) return <div class="boot" />;
  if (player.mini.value) return <Mini />;

  const r = route.value;
  const detail = r.name === 'artist' || r.name === 'album' || r.name === 'playlist';
  const sources = settings.value.sources;
  const active = activeConfig.value;

  return (
    <div class={`shell route-${r.name} ${r.name === 'nowplaying' && npFull.value ? 'np-full' : ''}`}>
      <header class="head">
        <span class="accent-bar" />
        <button class={`back ${detail || r.name === 'search' || r.name === 'sources' || r.name === 'nowplaying' ? '' : 'off'}`} title="Back" onClick={() => history.back()}>
          <Icon name="back" size={14} />
        </button>
        <nav class="pivot">
          {PIVOT.map((p) => (
            <a key={p.label} href={`#${hashOf(p.to)}`} class={p.match.includes(r.name) ? 'active' : ''}>
              {p.label}
            </a>
          ))}
        </nav>
        <WindowControls />
        <div class="head-right">
          <div class="head-top">
            <div class="head-links">
              <a href="#/sources">SETTINGS</a>
            </div>
            <div class="brand" title="Bring Back Zune">
              <Icon name="zmark" size={24} />
            </div>
          </div>
          <HeaderSearch q={r.name === 'search' ? r.q : ''} />
          {sources.length > 1 && (
            <select class="src-select" value={active?.id} onChange={(e) => setActiveSource((e.target as HTMLSelectElement).value)} title="Active server">
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>
      <main class="main" key={routeKey(r)}>
        <View r={r} />
      </main>
      <PlayerBar />
      {toast.value && <div class={`toast ${toast.value.kind}`}>{toast.value.msg}</div>}
    </div>
  );
}

function HeaderSearch({ q }: { q: string }): JSX.Element {
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  return (
    <form
      class="head-search"
      onSubmit={(e) => {
        e.preventDefault();
        location.hash = `#/search/${encodeURIComponent(text)}`;
      }}
    >
      <input type="search" placeholder="search" aria-label="Search" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
      <Icon name="search" size={14} />
    </form>
  );
}

const hashOf = (r: Route): string => {
  switch (r.name) {
    case 'collection':
      return `/collection/${r.tab}`;
    case 'search':
      return '/search/';
    default:
      return `/${r.name}`;
  }
};

/** Re-key only on view changes (not on search typing) so enter animations replay per page. */
const routeKey = (r: Route): string =>
  r.name === 'collection' ? `collection-${r.tab}` : r.name === 'search' ? 'search' : JSON.stringify(r);

/** Our own minimize / maximize / close, since the OS window frame is gone. */
function WindowControls({ mini = false }: { mini?: boolean }): JSX.Element {
  const win = getBridge();
  const [maxed, setMaxed] = useState(false);
  useEffect(() => {
    void win.isMaximized().then(setMaxed);
    win.onMaximized(setMaxed);
  }, []);
  return (
    <div class="winctl">
      <button title="Minimize" aria-label="Minimize" onClick={() => void win.minimize()}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 9h8" stroke="currentColor" stroke-width="1.4" fill="none" />
        </svg>
      </button>
      {mini ? (
        <button title="Back to full window" aria-label="Back to full window" onClick={() => void setMini(false)}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 2.5h7v7h-7zM2.5 5h7" stroke="currentColor" stroke-width="1.2" fill="none" />
          </svg>
        </button>
      ) : (
        <button title={maxed ? 'Restore' : 'Maximize'} aria-label={maxed ? 'Restore' : 'Maximize'} onClick={() => void win.toggleMaximize().then(setMaxed)}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            {maxed ? (
              <path d="M4 2.5h5.5V8M2.5 4H8v5.5H2.5z" stroke="currentColor" stroke-width="1.2" fill="none" />
            ) : (
              <path d="M2.5 2.5h7v7h-7z" stroke="currentColor" stroke-width="1.3" fill="none" />
            )}
          </svg>
        </button>
      )}
      <button class="close" title="Close" aria-label="Close" onClick={() => void win.close()}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" fill="none" />
        </svg>
      </button>
    </div>
  );
}

function Progress({ remaining = false }: { remaining?: boolean }): JSX.Element {
  const pos = player.position.value;
  const dur = player.duration.value;
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? pos;
  const pct = dur > 0 ? Math.min(100, (shown / dur) * 100) : 0;
  return (
    <div class="progress">
      <span class="time">{formatTime(shown)}</span>
      <input
        type="range"
        min={0}
        max={Math.max(1, dur)}
        step={0.5}
        value={shown}
        style={{ '--pct': `${pct}%` } as JSX.CSSProperties}
        aria-label="Seek"
        onInput={(e) => setScrub(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => {
          seek(Number((e.target as HTMLInputElement).value));
          setScrub(null);
        }}
      />
      <span class="time">{remaining ? `-${formatTime(Math.max(0, dur - shown))}` : formatTime(dur)}</span>
    </div>
  );
}

function Transport({ size = 1 }: { size?: number }): JSX.Element {
  const playing = player.playing.value;
  return (
    <div class="transport">
      <button class="ib" title="Previous" onClick={prevTrack}>
        <Icon name="prev" size={24 * size} />
      </button>
      <button class="ib play" title={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
        <Icon name={playing ? 'pause' : 'play'} size={30 * size} />
      </button>
      <button class="ib" title="Next" onClick={nextTrack}>
        <Icon name="next" size={24 * size} />
      </button>
    </div>
  );
}

function PlayerBar(): JSX.Element {
  const t = player.track.value;
  const repeat = player.repeat.value;
  return (
    <footer class="bar">
      <Visualizer />
      <div class="bar-now">
        {t ? (
          <>
            <Art src={t.src} id={t.imageId} label={t.title} size={120} class="bar-art" onClick={() => go({ name: 'nowplaying' })} />
            <div class="bar-main">
              <div class="bar-line">
                <div class="bar-text" role="button" onClick={() => go({ name: 'nowplaying' })}>
                  <span class="bar-title">{t.title}</span>
                  <span class="bar-sub">{t.artist}</span>
                </div>
                <LikeButton track={t} size={16} class="ib" />
              </div>
              <Progress remaining />
            </div>
          </>
        ) : (
          <div class="bar-sub">nothing playing</div>
        )}
      </div>
      <div class="bar-ctl">
        <Transport size={0.8} />
        <div class="bar-right">
        <button class={`ib ${player.shuffle.value ? 'on' : ''}`} title="Shuffle" onClick={toggleShuffle}>
          <Icon name="shuffle" size={20} />
        </button>
        <button class={`ib ${repeat !== 'off' ? 'on' : ''}`} title={`Repeat: ${repeat}`} onClick={cycleRepeat}>
          <Icon name="repeat" size={20} />
          {repeat === 'one' && <b class="rep1">1</b>}
        </button>
        <div class="vol">
          <Icon name="volume" size={20} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={player.volume.value}
            style={{ '--pct': `${player.volume.value * 100}%` } as JSX.CSSProperties}
            aria-label="Volume"
            onInput={(e) => setVolume(Number((e.target as HTMLInputElement).value))}
          />
        </div>
        <button class="ib" title="Mini player" onClick={() => void setMini(true)}>
          <Icon name="mini" size={20} />
        </button>
      </div>
      </div>
    </footer>
  );
}

/** The small portrait player: artist + album in caps, big art, progress, track, what's next, round transport. */
function Mini(): JSX.Element {
  const t = player.track.value;
  const queue = player.queue.value;
  const next = queue.slice(player.index.value + 1, player.index.value + 4);
  return (
    <div class="mini">
      <span class="accent-bar" />
      <WindowControls mini />
      <div class="mini-head">
        <div class="mini-artist">{t?.artist ?? 'nothing playing'}</div>
        <div class="mini-album">{t?.album ?? ''}</div>
      </div>
      {t ? <Art src={t.src} id={t.imageId} label={t.title} size={400} class="mini-art" /> : <div class="art art-ph mini-art" />}
      <Progress remaining />
      <div class="mini-track">{t?.title ?? ''}</div>
      <ol class="mini-next">
        {next.map((n, i) => (
          <li key={`${n.id}-${i}`}>{n.title}</li>
        ))}
      </ol>
      <div class="mini-ctrl">
        <Transport size={0.9} />
        {t && <LikeButton track={t} size={20} class="ib" />}
      </div>
    </div>
  );
}

function useGlobalKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if (e.code === 'Space' && !typing && el?.tagName !== 'BUTTON') {
        e.preventDefault();
        togglePlay();
      } else if (e.ctrlKey && e.key === 'ArrowRight') nextTrack();
      else if (e.ctrlKey && e.key === 'ArrowLeft') prevTrack();
      else if (e.key === 'Escape' && npFull.value) {
        npFull.value = false;
        if (document.fullscreenElement) void document.exitFullscreen();
      } else if (e.key === 'Escape' && player.mini.value) void setMini(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
