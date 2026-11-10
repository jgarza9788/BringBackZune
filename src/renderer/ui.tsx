import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatTime, isPinned, trackToPin, type PinRef, type Track, type TrackSortKey } from '../core';
import { artUrl, enqueue, isLiked, jumpTo, player, playTracks, settings, toggleLike, togglePinned } from './state';

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
  heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  'heart-o': 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  zmark: 'M6 5h12v2.6L9.9 16H18v3H6v-2.6L14.1 8H6z',
  dj: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z',
};

export function LikeButton({ track, size = 18, class: cls = '' }: { track: Track; size?: number; class?: string }): JSX.Element {
  const on = isLiked(track);
  return (
    <button
      class={`like ${on ? 'on' : ''} ${cls}`}
      title={on ? 'Remove like' : 'Like'}
      aria-pressed={on}
      onClick={(e) => {
        e.stopPropagation();
        void toggleLike(track);
      }}
    >
      <Icon name={on ? 'heart' : 'heart-o'} size={size} />
    </button>
  );
}

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
  /** When set, the tile can be pinned to Quickplay (hover button or right-click). */
  pin?: PinRef;
  i?: number;
  class?: string;
  children?: ComponentChildren;
}): JSX.Element {
  const pinned = props.pin ? isPinned(settings.value.quickplay, props.pin) : false;
  return (
    <div
      class={`tile ${props.class ?? ''}`}
      onContextMenu={(e) => {
        if (!props.pin) return;
        e.preventDefault();
        togglePinned(props.pin);
      }}
      style={{ '--i': props.i ?? 0 } as JSX.CSSProperties}
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
      {props.pin && (
        <button
          class={`tile-pin ${pinned ? 'on' : ''}`}
          title={pinned ? 'Unpin from Quickplay' : 'Pin to Quickplay'}
          aria-pressed={pinned}
          onClick={(e) => {
            e.stopPropagation();
            if (props.pin) togglePinned(props.pin);
          }}
        >
          <Icon name="pin" size={14} />
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
  /** When set, a header row is shown and its column titles sort the list. */
  sort?: { by: TrackSortKey; desc?: boolean; onSort(key: TrackSortKey): void };
}): JSX.Element {
  const cur = player.track.value;
  if (props.tracks.length === 0) return <div class="status">nothing here yet</div>;
  const head = (key: TrackSortKey, label: string, right = false): JSX.Element => {
    const on = props.sort?.by === key;
    return (
      <button
        class={`head-cell ${on ? 'on' : ''} ${right ? 'right' : ''}`}
        aria-sort={on ? (props.sort?.desc ? 'descending' : 'ascending') : 'none'}
        title={`Sort by ${label}`}
        onClick={() => props.sort?.onSort(key)}
      >
        {label}
        {on && <span class="arrow">{props.sort?.desc ? '▼' : '▲'}</span>}
      </button>
    );
  };
  return (
    <div class="tracks" role="list">
      {props.sort && (
        <div class="track track-head">
          <div />
          {head('title', 'title')}
          {props.showArtist && head('artist', 'artist')}
          {props.showAlbum && head('album', 'album')}
          <div />
          {head('time', 'time', true)}
        </div>
      )}
      {props.tracks.map((t, i) => {
        const playing = cur?.id === t.id && cur.src === t.src;
        return (
          <div
            key={`${t.id}-${i}`}
            role="listitem"
            class={`track ${playing ? 'is-playing' : ''}`}
            onDblClick={() => (props.onPlay ? props.onPlay(i) : playTracks(props.tracks, i))}
            onContextMenu={(e) => {
              e.preventDefault();
              togglePinned(trackToPin(t));
            }}
          >
            <button class="track-num" title="Play" onClick={() => (props.onPlay ? props.onPlay(i) : playTracks(props.tracks, i))}>
              <span class="num">{playing && player.playing.value ? '♪' : props.numbered ? (t.trackNo ?? i + 1) : i + 1}</span>
              <Icon name="play" size={18} />
            </button>
            <div class="track-title">{t.title}</div>
            {props.showArtist && <div class="track-artist">{t.artist}</div>}
            {props.showAlbum && <div class="track-album">{t.album}</div>}
            <div class="track-actions">
              <LikeButton track={t} size={16} />
              <button
                class={`pin ${isPinned(settings.value.quickplay, trackToPin(t)) ? 'on' : ''}`}
                title={isPinned(settings.value.quickplay, trackToPin(t)) ? 'Unpin from Quickplay' : 'Pin to Quickplay'}
                onClick={() => togglePinned(trackToPin(t))}
              >
                <Icon name="pin" size={16} />
              </button>
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
