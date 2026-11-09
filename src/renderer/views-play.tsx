import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { buildMixView, formatTime, type MixNode } from '../core';
import { AlbumTile, ArtistTile } from './views-library';
import {
  ACCENTS,
  accent,
  activeConfig,
  addDemoSource,
  addSource,
  artUrl,
  getSource,
  go,
  jumpTo,
  notify,
  player,
  playAlbum,
  playArtist,
  reconnectSource,
  removeFromQueue,
  removeSource,
  requireSource,
  route,
  setAccent,
  setActiveSource,
  settings,
  type NewSourceInput,
} from './state';
import { Art, Await, Icon, Section, Tile, TrackList, useAsync } from './ui';

/* ---------------------------------------------------------------- now playing */

export function NowPlaying(): JSX.Element {
  const t = player.track.value;
  const idx = player.index.value;
  const queue = player.queue.value;

  const artist = useAsync(async () => {
    if (!t?.artistId) return undefined;
    try {
      return (await requireSource(t.src).getArtist(t.artistId)).artist;
    } catch {
      return undefined;
    }
  }, [t?.src, t?.artistId]);

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

  const a = artist.data;
  // Prefer a wide artist backdrop, then the artist portrait, then the (blurred) album art.
  const bg =
    artUrl(t.src, a?.backdropId, 1080, 'backdrop') ?? artUrl(t.src, a?.imageId, 1080) ?? artUrl(t.src, t.imageId, 1080);
  const info = [t.artist, t.album, t.trackNo ? `track ${t.trackNo}` : undefined].filter(Boolean).join('   •   ');
  const upcoming = queue.slice(idx + 1);

  return (
    <div class="np">
      {bg && <img class="np-bg" src={bg} alt="" draggable={false} key={bg} />}
      <div class="np-shade" />
      <div class="np-body">
        <Art src={t.src} id={t.imageId} label={t.title} size={700} class="np-art" />
        <div class="np-info">
          <h1 class="np-title">{t.title}</h1>
          <a class="np-artist" href={t.artistId ? `#/artist/${encodeURIComponent(t.src)}/${encodeURIComponent(t.artistId)}` : undefined}>
            {t.artist}
          </a>
          {t.album && (
            <a class="np-album" href={t.albumId ? `#/album/${encodeURIComponent(t.src)}/${encodeURIComponent(t.albumId)}` : undefined}>
              {t.album}
            </a>
          )}
          <div class="marquee" aria-hidden="true">
            <span>
              {info}   •   {info}   •   {info}   •
            </span>
          </div>
          <div class="np-actions">
            <button class="btn" onClick={() => t.artistId && go({ name: 'mixview', src: t.src, kind: 'artist', id: t.artistId })} disabled={!t.artistId}>
              <Icon name="mix" size={18} /> mixview
            </button>
          </div>
        </div>
        <aside class="np-queue">
          <h3>playing next</h3>
          {upcoming.length === 0 ? (
            <div class="status">end of queue</div>
          ) : (
            <ol>
              {upcoming.slice(0, 40).map((q, i) => (
                <li key={`${q.id}-${idx + 1 + i}`}>
                  <button class="q-main" onClick={() => jumpTo(idx + 1 + i)}>
                    <span class="q-title">{q.title}</span>
                    <span class="q-sub">{q.artist}</span>
                  </button>
                  <span class="q-time">{formatTime(q.durationSec)}</span>
                  <button class="q-x" title="Remove" onClick={() => removeFromQueue(idx + 1 + i)}>
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- mixview */

export function MixView({ src, kind, id }: { src: string; kind: 'artist' | 'album'; id: string }): JSX.Element {
  const st = useAsync(() => buildMixView(requireSource(src), { kind, id }, 8), [src, kind, id]);
  return (
    <Await state={st}>
      {({ center, related }) => (
        <div class="mix" key={`${kind}${id}`}>
          <div class="mix-stage">
            {related.map((n, i) => {
              const ang = (i / related.length) * Math.PI * 2 - Math.PI / 2;
              return (
                <Tile
                  key={`${n.kind}${n.id}`}
                  class="mix-sat"
                  title={n.title}
                  subtitle={n.subtitle}
                  src={n.src}
                  imageId={n.imageId}
                  i={i}
                  vars={{ '--cx': Math.cos(ang).toFixed(4), '--cy': Math.sin(ang).toFixed(4) }}
                  onClick={() => go({ name: 'mixview', src: n.src, kind: n.kind, id: n.id })}
                  onPlay={() => void (n.kind === 'artist' ? playArtist(n.src, n.id) : playAlbum(n.src, n.id))}
                />
              );
            })}
            <MixCenter node={center} />
          </div>
          <p class="mix-hint">select any tile to re-centre mixview on it</p>
        </div>
      )}
    </Await>
  );
}

function MixCenter({ node }: { node: MixNode }): JSX.Element {
  return (
    <div class="mix-center">
      <div class="tile mix-main">
        <Art src={node.src} id={node.imageId} label={node.title} size={500} />
        <button
          class="tile-play always"
          title="Play"
          onClick={() => void (node.kind === 'artist' ? playArtist(node.src, node.id) : playAlbum(node.src, node.id))}
        >
          <Icon name="play" size={30} />
        </button>
      </div>
      <h1>{node.title}</h1>
      <div class="meta">{node.subtitle}</div>
      <button class="btn" onClick={() => go({ name: node.kind, src: node.src, id: node.id })}>
        open {node.kind}
      </button>
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
