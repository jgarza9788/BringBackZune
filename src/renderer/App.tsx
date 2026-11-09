import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { formatTime } from '../core';
import {
  activeConfig,
  cycleRepeat,
  go,
  nextTrack,
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
import { Art, Icon } from './ui';
import { AlbumPage, ArtistPage, Collection, PlaylistPage, Quickplay } from './views-library';
import { MixView, NowPlaying, SearchView, SourcesView } from './views-play';

const PIVOT: { label: string; match: Route['name'][]; to: Route }[] = [
  { label: 'quickplay', match: ['quickplay'], to: { name: 'quickplay' } },
  { label: 'collection', match: ['collection', 'artist', 'album', 'playlist', 'mixview'], to: { name: 'collection', tab: 'artists' } },
  { label: 'now playing', match: ['nowplaying'], to: { name: 'nowplaying' } },
  { label: 'search', match: ['search'], to: { name: 'search', q: '' } },
  { label: 'sources', match: ['sources'], to: { name: 'sources' } },
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
    case 'mixview':
      return <MixView src={r.src} kind={r.kind} id={r.id} />;
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
  const detail = r.name === 'artist' || r.name === 'album' || r.name === 'playlist' || r.name === 'mixview';
  const sources = settings.value.sources;
  const active = activeConfig.value;

  return (
    <div class={`shell route-${r.name}`}>
      <header class="head">
        {detail && (
          <button class="back" title="Back" onClick={() => history.back()}>
            <Icon name="back" size={26} />
          </button>
        )}
        <nav class="pivot">
          {PIVOT.map((p) => (
            <a key={p.label} href={`#${hashOf(p.to)}`} class={p.match.includes(r.name) ? 'active' : ''}>
              {p.label}
            </a>
          ))}
        </nav>
        {sources.length > 1 && (
          <select class="src-select" value={active?.id} onChange={(e) => setActiveSource((e.target as HTMLSelectElement).value)} title="Active server">
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </header>
      <main class="main" key={routeKey(r)}>
        <View r={r} />
      </main>
      <PlayerBar />
      {toast.value && <div class={`toast ${toast.value.kind}`}>{toast.value.msg}</div>}
    </div>
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

function Progress(): JSX.Element {
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
      <span class="time">{formatTime(dur)}</span>
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
      <div class="bar-now" onClick={() => t && go({ name: 'nowplaying' })} role={t ? 'button' : undefined}>
        {t ? (
          <>
            <Art src={t.src} id={t.imageId} label={t.title} size={120} class="bar-art" />
            <div class="bar-text">
              <div class="bar-title">{t.title}</div>
              <div class="bar-sub">{t.artist}</div>
            </div>
          </>
        ) : (
          <div class="bar-sub">nothing playing</div>
        )}
      </div>
      <div class="bar-mid">
        <Transport />
        <Progress />
      </div>
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
    </footer>
  );
}

function Mini(): JSX.Element {
  const t = player.track.value;
  return (
    <div class="mini">
      <div class="mini-top">
        {t ? <Art src={t.src} id={t.imageId} label={t.title} size={200} class="mini-art" /> : <div class="art art-ph mini-art" />}
        <div class="mini-text">
          <div class="bar-title">{t?.title ?? 'nothing playing'}</div>
          <div class="bar-sub">{t?.artist ?? ''}</div>
          <Transport size={0.85} />
        </div>
        <button class="ib mini-x" title="Back to full window" onClick={() => void setMini(false)}>
          <Icon name="mini" size={18} />
        </button>
      </div>
      <Progress />
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
      else if (e.key === 'Escape' && player.mini.value) void setMini(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
