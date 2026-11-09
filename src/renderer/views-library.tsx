import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { formatTime, MAX_PINS, SMART_DJ_SLOTS, isPinned, type Album, type Artist, type Seed, type Track } from '../core';
import {
  activeConfig,
  addDemoSource,
  albumPin,
  artistPin,
  assignSmartDj,
  cached,
  clearSmartDj,
  enqueue,
  go,
  openPin,
  player,
  playAlbum,
  playArtist,
  playPin,
  playSmartDj,
  playTracks,
  requireSource,
  settings,
  togglePinned,
  togglePlay,
} from './state';
import { Art, Await, Icon, Section, Tile, TrackList, useAsync } from './ui';

/* ---------------------------------------------------------------- quickplay */

export function Quickplay(): JSX.Element {
  const cfg = activeConfig.value;
  const qp = settings.value.quickplay;
  const t = player.track.value;
  const newest = useAsync(
    () => (cfg ? cached(`new:${cfg.id}`, () => requireSource(cfg.id).getNewestAlbums(12)) : Promise.resolve([] as Album[])),
    [cfg?.id],
  );

  if (!cfg) {
    return (
      <div class="welcome">
        <h1>welcome</h1>
        <p>Connect your Jellyfin or Navidrome server to stream your music, or explore with a built-in demo library.</p>
        <div class="row">
          <button class="btn primary" onClick={() => go({ name: 'sources' })}>
            connect a server
          </button>
          <button class="btn" onClick={addDemoSource}>
            try the demo library
          </button>
        </div>
      </div>
    );
  }

  const pinSlots = Array.from({ length: MAX_PINS }, (_, i) => qp.pins[i]);
  return (
    <div class="qp">
      <Section title="now playing">
        {t ? (
          <div class="tile big" role="button" tabIndex={0} onClick={() => go({ name: 'nowplaying' })}>
            <Art src={t.src} id={t.imageId} label={t.title} size={600} />
            <div class="tile-cap">
              <div class="tile-title">{t.title}</div>
              <div class="tile-sub">{t.artist}</div>
            </div>
            <button
              class="tile-play always"
              title={player.playing.value ? 'Pause' : 'Play'}
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
            >
              <Icon name={player.playing.value ? 'pause' : 'play'} size={30} />
            </button>
          </div>
        ) : (
          <div class="tile big empty" onClick={() => go({ name: 'collection', tab: 'albums' })} role="button" tabIndex={0}>
            <div class="empty-msg">
              <Icon name="play" size={40} />
              <span>nothing playing. pick something from your collection</span>
            </div>
          </div>
        )}
      </Section>

      <div class="qp-right">
        <Section title="smart dj">
          <div class="row-grid five">
            {Array.from({ length: SMART_DJ_SLOTS }, (_, i) => {
              const seed = qp.smartDj[i];
              return seed ? (
                <Tile key={i} i={i} title={seed.title} subtitle="smart dj" src={seed.src} imageId={seed.imageId} onClick={() => void playSmartDj(seed)} onPlay={() => void playSmartDj(seed)}>
                  <button
                    class="tile-x"
                    title="Remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearSmartDj(i);
                    }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </Tile>
              ) : (
                <div key={i} class="tile slot" title="Use “smart dj” on an artist or album page to fill this slot">
                  <Icon name="dj" size={28} />
                  <span>{i === 0 ? 'add an artist or album' : ''}</span>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="pins" right={<span class="count">{qp.pins.length}/{MAX_PINS}</span>}>
          <div class="row-grid six">
            {pinSlots.map((p, i) =>
              p ? (
                <Tile key={`${p.kind}${p.id}`} i={i} title={p.title} subtitle={p.subtitle ?? p.kind} src={p.src} imageId={p.imageId} onClick={() => openPin(p)} onPlay={() => void playPin(p)}>
                  <button
                    class="tile-x"
                    title="Unpin"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePinned(p);
                    }}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </Tile>
              ) : (
                <div key={i} class="tile slot">
                  <Icon name="pin" size={26} />
                  <span>{i === 0 ? 'pin favourites here' : ''}</span>
                </div>
              ),
            )}
          </div>
        </Section>
      </div>

      <div class="qp-wide">
        {qp.history.length > 0 && (
          <Section title="history">
            <div class="grid small">
              {qp.history.slice(0, 12).map((p, i) => (
                <Tile key={`${p.kind}${p.id}`} i={i} title={p.title} subtitle={p.subtitle ?? p.kind} src={p.src} imageId={p.imageId} onClick={() => openPin(p)} onPlay={() => void playPin(p)} />
              ))}
            </div>
          </Section>
        )}
        <Section title="new">
          <Await state={newest}>
            {(albums) =>
              albums.length === 0 ? (
                <div class="status">no albums yet</div>
              ) : (
                <div class="grid small">
                  {albums.map((a, i) => (
                    <AlbumTile key={a.id} album={a} i={i} />
                  ))}
                </div>
              )
            }
          </Await>
        </Section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- tiles */

export function AlbumTile({ album, i = 0, showYear = false }: { album: Album; i?: number; showYear?: boolean }): JSX.Element {
  return (
    <Tile
      i={i}
      title={album.title}
      subtitle={showYear && album.year ? `${album.year}` : album.artist}
      src={album.src}
      imageId={album.imageId}
      onClick={() => go({ name: 'album', src: album.src, id: album.id })}
      onPlay={() => void playAlbum(album.src, album.id)}
    />
  );
}

export function ArtistTile({ artist, i = 0 }: { artist: Artist; i?: number }): JSX.Element {
  return (
    <Tile
      i={i}
      title={artist.name}
      subtitle={artist.albumCount ? `${artist.albumCount} album${artist.albumCount === 1 ? '' : 's'}` : 'artist'}
      src={artist.src}
      imageId={artist.imageId}
      onClick={() => go({ name: 'artist', src: artist.src, id: artist.id })}
      onPlay={() => void playArtist(artist.src, artist.id)}
    />
  );
}

/* ---------------------------------------------------------------- collection */

type Tab = 'artists' | 'albums' | 'playlists' | 'songs';

export function Collection({ tab }: { tab: Tab }): JSX.Element {
  const cfg = activeConfig.value;
  return (
    <div class="collection">
      <nav class="subpivot">
        {(['artists', 'albums', 'playlists', 'songs'] as Tab[]).map((t) => (
          <a key={t} class={t === tab ? 'active' : ''} href={`#/collection/${t}`}>
            {t}
          </a>
        ))}
      </nav>
      {!cfg ? (
        <div class="status">add a server in “sources” to see your collection</div>
      ) : tab === 'artists' ? (
        <ArtistsTab srcId={cfg.id} />
      ) : tab === 'albums' ? (
        <AlbumsTab srcId={cfg.id} />
      ) : tab === 'playlists' ? (
        <PlaylistsTab srcId={cfg.id} />
      ) : (
        <SongsTab srcId={cfg.id} />
      )}
    </div>
  );
}

const letterOf = (name: string): string => {
  const c = name.replace(/^(the|a|an)\s+/i, '').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};

function ArtistsTab({ srcId }: { srcId: string }): JSX.Element {
  const st = useAsync(() => cached(`artists:${srcId}`, () => requireSource(srcId).getArtists()), [srcId]);
  return (
    <Await state={st}>
      {(artists) => {
        const groups = new Map<string, Artist[]>();
        [...artists]
          .sort((a, b) => a.name.replace(/^the\s+/i, '').localeCompare(b.name.replace(/^the\s+/i, ''), undefined, { sensitivity: 'base' }))
          .forEach((a) => {
            const l = letterOf(a.name);
            groups.set(l, [...(groups.get(l) ?? []), a]);
          });
        const letters = [...groups.keys()].sort((a, b) => (a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)));
        if (letters.length === 0) return <div class="status">no artists found</div>;
        return (
          <>
            <div class="letters">
              {letters.map((l) => (
                <button key={l} onClick={() => document.getElementById(`letter-${l}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  {l}
                </button>
              ))}
            </div>
            {letters.map((l) => (
              <div key={l} id={`letter-${l}`} class="letter-group">
                <div class="letter">{l}</div>
                <div class="grid">
                  {(groups.get(l) ?? []).map((a, i) => (
                    <ArtistTile key={a.id} artist={a} i={Math.min(i, 12)} />
                  ))}
                </div>
              </div>
            ))}
          </>
        );
      }}
    </Await>
  );
}

const PAGE = 120;

function usePaged<T>(load: (offset: number, limit: number) => Promise<T[]>, deps: unknown[]) {
  const [items, setItems] = useState<T[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const more = async (reset = false) => {
    setBusy(true);
    try {
      const offset = reset ? 0 : items.length;
      const next = await load(offset, PAGE);
      setItems((cur) => (reset ? next : [...cur, ...next]));
      setDone(next.length < PAGE);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setItems([]);
    setDone(false);
    void more(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { items, done, error, busy, more: () => void more() };
}

function MoreButton(p: { done: boolean; busy: boolean; error?: string; more(): void; empty: boolean }): JSX.Element {
  if (p.error) return <div class="status error">{p.error}</div>;
  if (p.busy) return <div class="status">loading…</div>;
  if (p.empty) return <div class="status">nothing found</div>;
  return p.done ? <></> : (
    <button class="btn more" onClick={p.more}>
      show more
    </button>
  );
}

function AlbumsTab({ srcId }: { srcId: string }): JSX.Element {
  const [sort, setSort] = useState<'name' | 'recent' | 'artist'>('name');
  const p = usePaged((offset, limit) => requireSource(srcId).getAlbums(sort, { offset, limit }), [srcId, sort]);
  return (
    <>
      <div class="chips">
        {(['name', 'artist', 'recent'] as const).map((s) => (
          <button key={s} class={`chip ${s === sort ? 'on' : ''}`} onClick={() => setSort(s)}>
            {s === 'recent' ? 'recently added' : `by ${s}`}
          </button>
        ))}
      </div>
      <div class="grid">
        {p.items.map((a, i) => (
          <AlbumTile key={a.id} album={a} i={Math.min(i, 12)} />
        ))}
      </div>
      <MoreButton {...p} empty={!p.busy && p.items.length === 0} />
    </>
  );
}

function PlaylistsTab({ srcId }: { srcId: string }): JSX.Element {
  const st = useAsync(() => cached(`playlists:${srcId}`, () => requireSource(srcId).getPlaylists()), [srcId]);
  return (
    <Await state={st}>
      {(lists) =>
        lists.length === 0 ? (
          <div class="status">no playlists found</div>
        ) : (
          <div class="grid">
            {lists.map((p, i) => (
              <Tile
                key={p.id}
                i={Math.min(i, 12)}
                title={p.name}
                subtitle={p.trackCount != null ? `${p.trackCount} song${p.trackCount === 1 ? '' : 's'}` : 'playlist'}
                src={p.src}
                imageId={p.imageId}
                onClick={() => go({ name: 'playlist', src: p.src, id: p.id })}
                onPlay={() => void requireSource(p.src).getPlaylist(p.id).then((r) => playTracks(r.tracks, 0, { shuffle: false }))}
              />
            ))}
          </div>
        )
      }
    </Await>
  );
}

export function PlaylistPage({ src, id }: { src: string; id: string }): JSX.Element {
  const st = useAsync(() => requireSource(src).getPlaylist(id), [src, id]);
  return (
    <Await state={st}>
      {({ playlist, tracks }) => {
        const total = tracks.reduce((n, t) => n + t.durationSec, 0);
        return (
          <div class="detail">
            <div class="hero">
              <Art src={src} id={playlist.imageId} label={playlist.name} size={600} class="hero-art" />
              <div class="hero-info">
                <div class="kicker">playlist</div>
                <h1>{playlist.name}</h1>
                <div class="meta">
                  {tracks.length} song{tracks.length === 1 ? '' : 's'} · {formatTime(total)}
                </div>
                <div class="actions">
                  <button class="btn primary" onClick={() => playTracks(tracks, 0, { shuffle: false })}>
                    <Icon name="play" size={18} /> play
                  </button>
                  <button class="btn" onClick={() => playTracks(tracks, 0, { shuffle: true })}>
                    <Icon name="shuffle" size={18} /> shuffle
                  </button>
                  <button class="btn" onClick={() => enqueue(tracks)}>
                    <Icon name="plus" size={18} /> add to now playing
                  </button>
                </div>
              </div>
            </div>
            <TrackList tracks={tracks} showArtist showAlbum />
          </div>
        );
      }}
    </Await>
  );
}

function SongsTab({ srcId }: { srcId: string }): JSX.Element {
  const p = usePaged((offset, limit) => requireSource(srcId).getTracks({ offset, limit }), [srcId]);
  return (
    <>
      <TrackList tracks={p.items} showArtist showAlbum />
      <MoreButton {...p} empty={!p.busy && p.items.length === 0} />
    </>
  );
}

/* ---------------------------------------------------------------- artist + album pages */

const seedOf = (kind: Seed['kind'], x: { src: string; id: string; title: string; subtitle?: string; imageId?: string }): Seed => ({
  kind,
  src: x.src,
  id: x.id,
  title: x.title,
  subtitle: x.subtitle,
  imageId: x.imageId,
});

export function ArtistPage({ src, id }: { src: string; id: string }): JSX.Element {
  const st = useAsync(async () => {
    const s = requireSource(src);
    const r = await s.getArtist(id);
    let top: Track[] = [];
    try {
      top = await s.getTopTracks(r.artist, 8);
    } catch {
      /* optional */
    }
    return { ...r, top };
  }, [src, id]);

  return (
    <Await state={st}>
      {({ artist, albums, top }) => {
        const pin = artistPin(artist);
        const pinned = isPinned(settings.value.quickplay, pin);
        const seed = seedOf('artist', { src, id, title: artist.name, imageId: artist.imageId });
        return (
          <div class="detail">
            <div class="hero">
              <Art src={src} id={artist.imageId} label={artist.name} size={500} class="hero-art" />
              <div class="hero-info">
                <div class="kicker">artist</div>
                <h1>{artist.name}</h1>
                <div class="meta">
                  {albums.length} album{albums.length === 1 ? '' : 's'}
                </div>
                <div class="actions">
                  <button class="btn primary" onClick={() => void playArtist(src, id)}>
                    <Icon name="play" size={18} /> play
                  </button>
                  <button class="btn" onClick={() => void playArtist(src, id, { shuffle: true })}>
                    <Icon name="shuffle" size={18} /> shuffle
                  </button>
                  <button class="btn" onClick={() => go({ name: 'mixview', src, kind: 'artist', id })}>
                    <Icon name="mix" size={18} /> mixview
                  </button>
                  <button class="btn" onClick={() => (assignSmartDj(seed), void playSmartDj(seed))}>
                    <Icon name="dj" size={18} /> smart dj
                  </button>
                  <button class={`btn ${pinned ? 'on' : ''}`} onClick={() => togglePinned(pin)}>
                    <Icon name="pin" size={18} /> {pinned ? 'pinned' : 'pin'}
                  </button>
                </div>
              </div>
            </div>
            {top.length > 0 && (
              <Section title="top songs">
                <TrackList tracks={top} showAlbum />
              </Section>
            )}
            <Section title="albums">
              <div class="grid">
                {albums.map((a, i) => (
                  <AlbumTile key={a.id} album={a} i={i} showYear />
                ))}
              </div>
            </Section>
          </div>
        );
      }}
    </Await>
  );
}

export function AlbumPage({ src, id }: { src: string; id: string }): JSX.Element {
  const st = useAsync(() => requireSource(src).getAlbum(id), [src, id]);
  return (
    <Await state={st}>
      {({ album, tracks }) => {
        const pin = albumPin(album);
        const pinned = isPinned(settings.value.quickplay, pin);
        const seed = seedOf('album', { src, id, title: album.title, subtitle: album.artist, imageId: album.imageId });
        const total = tracks.reduce((n, t) => n + t.durationSec, 0);
        const various = new Set(tracks.map((t) => t.artist)).size > 1;
        return (
          <div class="detail">
            <div class="hero">
              <Art src={src} id={album.imageId} label={album.title} size={600} class="hero-art" />
              <div class="hero-info">
                <div class="kicker">album</div>
                <h1>{album.title}</h1>
                <div class="meta">
                  {album.artistId ? (
                    <a href={`#/artist/${encodeURIComponent(src)}/${encodeURIComponent(album.artistId)}`}>{album.artist}</a>
                  ) : (
                    album.artist
                  )}
                  {album.year ? ` · ${album.year}` : ''} · {tracks.length} song{tracks.length === 1 ? '' : 's'} · {formatTime(total)}
                </div>
                <div class="actions">
                  <button class="btn primary" onClick={() => playTracks(tracks, 0, { shuffle: false })}>
                    <Icon name="play" size={18} /> play
                  </button>
                  <button class="btn" onClick={() => playTracks(tracks, 0, { shuffle: true })}>
                    <Icon name="shuffle" size={18} /> shuffle
                  </button>
                  <button class="btn" onClick={() => enqueue(tracks)}>
                    <Icon name="plus" size={18} /> add to now playing
                  </button>
                  <button class="btn" onClick={() => go({ name: 'mixview', src, kind: 'album', id })}>
                    <Icon name="mix" size={18} /> mixview
                  </button>
                  <button class="btn" onClick={() => (assignSmartDj(seed), void playSmartDj(seed))}>
                    <Icon name="dj" size={18} /> smart dj
                  </button>
                  <button class={`btn ${pinned ? 'on' : ''}`} onClick={() => togglePinned(pin)}>
                    <Icon name="pin" size={18} /> {pinned ? 'pinned' : 'pin'}
                  </button>
                </div>
              </div>
            </div>
            <TrackList tracks={tracks} numbered showArtist={various} />
          </div>
        );
      }}
    </Await>
  );
}
