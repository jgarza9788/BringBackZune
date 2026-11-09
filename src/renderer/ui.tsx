import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatTime, type Track } from '../core';
import { artUrl, enqueue, jumpTo, player, playTracks } from './state';

/* ---------------------------------------------------------------- icons */

const PATHS: Record<string, string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  prev: 'M6 6h2v12H6zM9.5 12l8.5 6V6z',
  shuffle: 'M10.6 9.2L5.4 4 4 5.4l5.2 5.2 1.4-1.4zM14.5 4l2.05 2.05L4 18.6 5.4 20 17.95 7.45 20 9.5V4h-5.5zM14.8 13.4l-1.4 1.4 3.15 3.15L14.5 20H20v-5.5l-2.05 2.05-3.15-3.15z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z',
  mini: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  list: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
  pin: 'M16 9V4h1V2H7v2h1v5l-2 2v2h5v7h2v-7h5v-2l-2-2z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  dj: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z',
  mix: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM4 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm16 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS | string; size?: number }): JSX.Element {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name] ?? ''} fill="currentColor" />
    </svg>
  );
}

/* ---------------------------------------------------------------- hooks */

export interface Async<T> {
  data?: T;
  error?: string;
  loading: boolean;
  reload(): void;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ data: s.data, loading: true }));
    fn().then(
      (data) => alive && setState({ data, loading: false }),
      (e: Error) => alive && setState({ error: e.message || String(e), loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/* ---------------------------------------------------------------- art + tiles */

export function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function Art(props: {
  src: string;
  id?: string;
  size?: number;
  kind?: 'primary' | 'backdrop';
  label: string;
  class?: string;
}): JSX.Element {
  const url = artUrl(props.src, props.id, props.size ?? 300, props.kind ?? 'primary');
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) {
    return (
      <div class={`art art-ph ${props.class ?? ''}`} style={{ '--h': hueOf(props.label) } as JSX.CSSProperties}>
        <span>{props.label.trim().charAt(0).toUpperCase()}</span>
      </div>
    );
  }
  return <img class={`art ${props.class ?? ''}`} src={url} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}

export function Tile(props: {
  title: string;
  subtitle?: string;
  src: string;
  imageId?: string;
  onClick?: () => void;
  onPlay?: () => void;
  i?: number;
  class?: string;
  /** Extra CSS custom properties (used by MixView for positioning). */
  vars?: Record<string, string | number>;
  children?: ComponentChildren;
}): JSX.Element {
  return (
    <div
      class={`tile ${props.class ?? ''}`}
      style={{ '--i': props.i ?? 0, ...props.vars } as JSX.CSSProperties}
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), props.onClick?.())}
    >
      <Art src={props.src} id={props.imageId} label={props.title} size={400} />
      <div class="tile-cap">
        <div class="tile-title">{props.title}</div>
        {props.subtitle && <div class="tile-sub">{props.subtitle}</div>}
      </div>
      {props.onPlay && (
        <button
          class="tile-play"
          title="Play"
          onClick={(e) => {
            e.stopPropagation();
            props.onPlay?.();
          }}
        >
          <Icon name="play" size={26} />
        </button>
      )}
      {props.children}
    </div>
  );
}

export function Section(props: { title: string; right?: ComponentChildren; children: ComponentChildren }): JSX.Element {
  return (
    <section class="section">
      <header class="section-h">
        <h2>{props.title}</h2>
        {props.right}
      </header>
      {props.children}
    </section>
  );
}

export function Loading({ text = 'loading…' }: { text?: string }): JSX.Element {
  return <div class="status">{text}</div>;
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }): JSX.Element {
  return (
    <div class="status error">
      <div>{error}</div>
      {retry && (
        <button class="btn" onClick={retry}>
          try again
        </button>
      )}
    </div>
  );
}

export function Await<T>(props: { state: Async<T>; children: (data: T) => ComponentChildren; empty?: string }): JSX.Element {
  const { state } = props;
  if (state.error) return <ErrorBox error={state.error} retry={state.reload} />;
  if (state.data === undefined) return <Loading />;
  return <>{props.children(state.data)}</>;
}

/* ---------------------------------------------------------------- track list */

export function TrackList(props: {
  tracks: Track[];
  showArtist?: boolean;
  showAlbum?: boolean;
  numbered?: boolean;
  /** Called to start playback from row i; defaults to queueing the whole list. */
  onPlay?: (i: number) => void;
}): JSX.Element {
  const cur = player.track.value;
  if (props.tracks.length === 0) return <div class="status">nothing here yet</div>;
  return (
    <div class="tracks" role="list">
      {props.tracks.map((t, i) => {
        const playing = cur?.id === t.id && cur.src === t.src;
        return (
          <div
            key={`${t.id}-${i}`}
            role="listitem"
            class={`track ${playing ? 'is-playing' : ''}`}
            onDblClick={() => (props.onPlay ? props.onPlay(i) : playTracks(props.tracks, i))}
          >
            <button class="track-num" title="Play" onClick={() => (props.onPlay ? props.onPlay(i) : playTracks(props.tracks, i))}>
              <span class="num">{playing && player.playing.value ? '♪' : props.numbered ? (t.trackNo ?? i + 1) : i + 1}</span>
              <Icon name="play" size={18} />
            </button>
            <div class="track-title">{t.title}</div>
            {props.showArtist && <div class="track-artist">{t.artist}</div>}
            {props.showAlbum && <div class="track-album">{t.album}</div>}
            <div class="track-actions">
              <button title="Play next" onClick={() => enqueue([t], true)}>
                <Icon name="next" size={16} />
              </button>
              <button title="Add to now playing" onClick={() => enqueue([t])}>
                <Icon name="plus" size={16} />
              </button>
            </div>
            <div class="track-time">{formatTime(t.durationSec)}</div>
          </div>
        );
      })}
    </div>
  );
}

export { jumpTo };

/* ---------------------------------------------------------------- misc */

export function useInterval(fn: () => void, ms: number): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = window.setInterval(() => ref.current(), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}
