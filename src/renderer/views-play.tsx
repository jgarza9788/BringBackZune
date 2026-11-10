import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatTime, isPinned, type PinRef, type Track } from '../core';
import { AlbumTile, ArtistTile } from './views-library';
import {
  ACCENTS,
  accent,
  activeConfig,
  addDemoSource,
  addSource,
  artUrl,
  cached,
  getSource,
  go,
  jumpTo,
  notify,
  npFull,
  player,
  reconnectSource,
  removeFromQueue,
  removeSource,
  requireSource,
  route,
  setAccent,
  setActiveSource,
  settings,
  togglePinned,
  togglePlay,
  type NewSourceInput,
} from './state';
import { Art, Await, Eq, Icon, LikeButton, Section, TrackList, useAsync } from './ui';

/* ---------------------------------------------------------------- now playing */

const nowAlbumPin = (t: Track): PinRef => ({ kind: 'album', src: t.src, id: t.albumId ?? '', title: t.album, subtitle: t.artist, imageId: t.imageId });

/** Cover art for the backdrop mosaic: what's queued, topped up with the newest albums. Stable per set of covers. */
/** How many wall cells it takes to cover the window (any shape, with room for the drift), rounded up so small resizes don't churn. */
function useWallCells(): number {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    let t = 0;
    const on = (): void => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setSize({ w: window.innerWidth, h: window.innerHeight }), 150);
    };
    window.addEventListener('resize', on);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', on);
    };
  }, []);
  const cell = Math.max(64, size.w * 0.056); // same as --cell in the stylesheet
  const units = (2 * size.w * size.h) / (cell * cell); // 1x1 cells to fill ~2x the window area
  const AVG_AREA = 3; // mean cell area given the 1x / 3x / 4x mix
  return Math.min(600, Math.ceil((units / AVG_AREA + 20) / 40) * 40);
}

function useMosaic(): { src: string; id?: string; label: string; span: number }[] {
  const count = useWallCells();
  const cfg = activeConfig.value;
  const queue = player.queue.value;
  const newest = useAsync(
    () => (cfg ? cached(`new:${cfg.id}`, () => requireSource(cfg.id).getNewestAlbums(24)) : Promise.resolve([])),
    [cfg?.id],
  );
  type Cover = { src: string; id?: string; label: string };
  const seen = new Map<string, Cover>();
  for (const q of queue.slice(0, 80)) seen.set(`${q.src}:${q.imageId ?? q.album}`, { src: q.src, id: q.imageId, label: q.album || q.title });
  for (const a of newest.data ?? []) seen.set(`${a.src}:${a.imageId ?? a.title}`, { src: a.src, id: a.imageId, label: a.title });
  // only real artwork: no generated letter tiles on the wall
  const covers = [...seen.values()].filter((c) => c.id && isRealArt(artUrl(c.src, c.id, 200)));
  const key = [...seen.keys()].join('|');
  return useMemo(() => {
    if (covers.length === 0) return [];
    // A mosaic of mixed sizes: mostly small (1x) covers, with some 3x and a few 4x ones (~80 / 13 / 7 %). Fixed-seed random,
    // so the wall doesn't reshuffle on every render. CSS grid-auto-flow: dense fills the gaps.
    let n = 7;
    const rnd = (): number => (n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const order = covers.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j] as Cover, order[i] as Cover];
    }
    return Array.from({ length: count }, (_, i) => {
      const r = rnd();
      return { ...(order[i % order.length] as Cover), span: r < 0.07 ? 4 : r < 0.2 ? 3 : 1 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, count]);
}

/** True for artwork served by a real server; the demo library's generated letter tiles (data: URLs) don't count. */
const isRealArt = (url: string | undefined): url is string => !!url && /^https?:/i.test(url);

/** One cover on the wall. If its image fails to load it simply drops out (the grid packs around it). */
function WallCover({ c }: { c: { src: string; id?: string; span: number } }): JSX.Element | null {
  const [failed, setFailed] = useState(false);
  const url = artUrl(c.src, c.id, c.span > 1 ? 400 : 200);
  if (!isRealArt(url) || failed) return null;
  return <img class={`art m${c.span}`} src={url} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}

export function NowPlaying(): JSX.Element {
  const t = player.track.value;
  const idx = player.index.value;
  const queue = player.queue.value;
  const full = npFull.value;
  const mosaic = useMosaic();
  const curRow = useRef<HTMLLIElement>(null);
  const queueBox = useRef<HTMLElement>(null);

  // Keep the playing row in view as the queue advances.
  // (scroll the queue itself: scrollIntoView would also nudge the clipped page around it)
  useEffect(() => {
    const row = curRow.current;
    const box = queueBox.current;
    if (row && box) box.scrollTo({ top: row.offsetTop - (box.clientHeight - row.clientHeight) / 2, behavior: 'smooth' });
  }, [idx, t?.id]);

  // Leaving the page, or the browser leaving fullscreen by itself (Esc), ends art-only mode.
  useEffect(() => {
    const onFs = (): void => {
      if (!document.fullscreenElement) npFull.value = false;
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      npFull.value = false;
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, []);

  const enterFull = (): void => {
    npFull.value = true;
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  if (!t) {
    return (
      <div class="welcome">
        <h1>nothing playing</h1>
        <p>Pick an album, artist or smart dj mix to get started.</p>
        <div class="row">
          <button class="btn primary" onClick={() => go({ name: 'collection', tab: 'albums' })}>
            browse collection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class={`np ${full ? 'full' : ''}`}>
      <div class="np-wall" aria-hidden="true">
        <div class="np-mosaic">
          {mosaic.map((c, i) => (
            <WallCover key={i} c={c} />
          ))}
        </div>
      </div>
      {/* the colour of the wall drifts around the colour wheel, starting from the accent */}
      <div class={`np-tint ${mosaic.length ? '' : 'solo'}`} aria-hidden="true" />
      <div class="np-shade" />
      {full && <div class="np-esc">press esc to exit</div>}
      <div class="np-body">
        <Art src={t.src} id={t.imageId} label={t.title} size={700} class="np-art" key={t.imageId ?? t.id} />
        <div class="np-info">
          <a class="np-artist" href={t.artistId ? `#/artist/${encodeURIComponent(t.src)}/${encodeURIComponent(t.artistId)}` : undefined}>
            {t.artist}
          </a>
          {t.album && (
            <a class="np-album" href={t.albumId ? `#/album/${encodeURIComponent(t.src)}/${encodeURIComponent(t.albumId)}` : undefined}>
              {t.album}
            </a>
          )}
          <h1 class="np-title">{t.title}</h1>
          <div class="np-actions">
            <LikeButton track={t} size={22} class="ib" />
            {t.albumId && (
              <button
                class={`ib ${isPinned(settings.value.quickplay, nowAlbumPin(t)) ? 'on' : ''}`}
                title={isPinned(settings.value.quickplay, nowAlbumPin(t)) ? 'Unpin album from Quickplay' : 'Pin album to Quickplay'}
                onClick={() => togglePinned(nowAlbumPin(t))}
              >
                <Icon name="pin" size={20} />
              </button>
            )}
            <button class="ib" title="Full screen art" onClick={enterFull}>
              <Icon name="expand" size={20} />
            </button>
          </div>
        </div>
        <aside class="np-queue" ref={queueBox}>
          {queue.length === 0 ? (
            <div class="status">end of queue</div>
          ) : (
            <ol>
              {queue.map((q, i) => (
                <li key={`${q.id}-${i}`} class={i === idx ? 'cur' : i < idx ? 'past' : ''} ref={i === idx ? curRow : undefined}>
                  <button class="q-main" onClick={() => (i === idx ? togglePlay() : jumpTo(i))}>
                    <span class="q-title">
                      {i === idx && <Eq playing={player.playing.value} />}
                      {q.title}
                    </span>
                    <span class="q-sub">{q.artist}</span>
                  </button>
                  <span class="q-time">{formatTime(q.durationSec)}</span>
                  {i !== idx && (
                    <button class="q-x" title="Remove" onClick={() => removeFromQueue(i)}>
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- search */

export function SearchView({ q }: { q: string }): JSX.Element {
  const cfg = activeConfig.value;
  const [text, setText] = useState(q);

  // Debounced "live" search that rewrites the hash without spamming history.
  useEffect(() => {
    if (text === q) return;
    const h = window.setTimeout(() => {
      const r = { name: 'search' as const, q: text };
      history.replaceState(null, '', `#/search/${encodeURIComponent(text)}`);
      route.value = r;
    }, 300);
    return () => window.clearTimeout(h);
  }, [text]);

  const res = useAsync(
    () => (cfg && q.trim() ? requireSource(cfg.id).search(q) : Promise.resolve({ artists: [], albums: [], tracks: [] })),
    [cfg?.id, q],
  );

  return (
    <div class="search">
      <input
        class="search-box"
        type="search"
        placeholder="search artists, albums and songs"
        value={text}
        autoFocus
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
      />
      {!cfg ? (
        <div class="status">add a server in “sources” first</div>
      ) : !q.trim() ? (
        <div class="status">type to search “{cfg.name}”</div>
      ) : (
        <Await state={res}>
          {(r) =>
            r.artists.length + r.albums.length + r.tracks.length === 0 ? (
              <div class="status">no results for “{q}”</div>
            ) : (
              <>
                {r.artists.length > 0 && (
                  <Section title="artists">
                    <div class="grid small">
                      {r.artists.map((a, i) => (
                        <ArtistTile key={a.id} artist={a} i={i} />
                      ))}
                    </div>
                  </Section>
                )}
                {r.albums.length > 0 && (
                  <Section title="albums">
                    <div class="grid small">
                      {r.albums.map((a, i) => (
                        <AlbumTile key={a.id} album={a} i={i} />
                      ))}
                    </div>
                  </Section>
                )}
                {r.tracks.length > 0 && (
                  <Section title="songs">
                    <TrackList tracks={r.tracks} showArtist showAlbum />
                  </Section>
                )}
              </>
            )
          }
        </Await>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- sources */

export function SourcesView(): JSX.Element {
  const s = settings.value;
  const [form, setForm] = useState<NewSourceInput>({
    kind: 'jellyfin',
    name: '',
    url: '',
    username: '',
    password: '',
    allowSelfSigned: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reconnecting, setReconnecting] = useState<string>();
  const [rePw, setRePw] = useState('');

  const set = <K extends keyof NewSourceInput>(k: K, v: NewSourceInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await addSource(form);
      setForm({ ...form, password: '', name: '', url: '', username: '' });
      notify('Connected');
      go({ name: 'quickplay' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="sources">
      <Section title="servers">
        {s.sources.length === 0 && <div class="status">no servers yet</div>}
        <ul class="source-list">
          {s.sources.map((c) => {
            const active = (activeConfig.value?.id ?? '') === c.id;
            const signedIn = c.kind === 'demo' || !!c.token || !!c.subsonicToken;
            return (
              <li key={c.id} class={active ? 'active' : ''}>
                <div class="source-main">
                  <div class="source-name">{c.name}</div>
                  <div class="source-sub">
                    {c.kind} · {c.kind === 'demo' ? 'offline sample data' : c.url} {c.username && c.kind !== 'demo' ? `· ${c.username}` : ''}
                    {!signedIn && ' · signed out'}
                  </div>
                </div>
                <div class="source-actions">
                  {!active && (
                    <button class="btn" onClick={() => setActiveSource(c.id)}>
                      use
                    </button>
                  )}
                  {active && <span class="badge">active</span>}
                  {c.kind !== 'demo' && (
                    <button class="btn" onClick={() => setReconnecting(reconnecting === c.id ? undefined : c.id)}>
                      sign in again
                    </button>
                  )}
                  <button class="btn danger" onClick={() => removeSource(c.id)}>
                    remove
                  </button>
                </div>
                {reconnecting === c.id && (
                  <form
                    class="inline-form"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await reconnectSource(c.id, rePw);
                        setReconnecting(undefined);
                        setRePw('');
                        notify('Signed in');
                      } catch (err) {
                        notify((err as Error).message, 'error');
                      }
                    }}
                  >
                    <input type="password" placeholder={`password for ${c.username}`} value={rePw} onInput={(e) => setRePw((e.target as HTMLInputElement).value)} autoFocus />
                    <button class="btn primary" type="submit">
                      sign in
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
        {!s.sources.some((c) => c.kind === 'demo') && (
          <button class="btn" onClick={addDemoSource}>
            add demo library
          </button>
        )}
      </Section>

      <Section title="add a server">
        <form class="form" onSubmit={submit}>
          <div class="seg">
            {(['jellyfin', 'navidrome'] as const).map((k) => (
              <button type="button" key={k} class={form.kind === k ? 'on' : ''} onClick={() => set('kind', k)}>
                {k}
              </button>
            ))}
          </div>
          <label>
            name <small>(optional)</small>
            <input value={form.name} onInput={(e) => set('name', (e.target as HTMLInputElement).value)} placeholder="Home server" />
          </label>
          <label>
            server address
            <input
              value={form.url}
              onInput={(e) => set('url', (e.target as HTMLInputElement).value)}
              placeholder={form.kind === 'jellyfin' ? 'http://192.168.1.10:8096' : 'http://192.168.1.10:4533'}
              required
            />
          </label>
          <label>
            username
            <input value={form.username} onInput={(e) => set('username', (e.target as HTMLInputElement).value)} autocomplete="username" required />
          </label>
          <label>
            password
            <input type="password" value={form.password} onInput={(e) => set('password', (e.target as HTMLInputElement).value)} autocomplete="current-password" />
          </label>
          <label class="check">
            <input type="checkbox" checked={form.allowSelfSigned} onChange={(e) => set('allowSelfSigned', (e.target as HTMLInputElement).checked)} />
            trust a self-signed certificate for this server
          </label>
          {error && <div class="form-error">{error}</div>}
          <div class="row">
            <button class="btn primary" type="submit" disabled={busy}>
              {busy ? 'connecting…' : 'connect'}
            </button>
          </div>
          <p class="fine">
            Your password is only sent to your server to sign in. Only the access token is stored on this computer
            {form.kind === 'navidrome' ? ' (as a salted hash, as the Subsonic API defines)' : ''}.
          </p>
        </form>
      </Section>

      <Section title="colour">
        <div class="swatches">
          {ACCENTS.map((a) => (
            <button
              key={a.hex}
              class={`swatch ${accent.value.toLowerCase() === a.hex.toLowerCase() ? 'on' : ''}`}
              style={{ background: a.hex }}
              title={a.name}
              onClick={() => setAccent(a.hex)}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

export { getSource };
