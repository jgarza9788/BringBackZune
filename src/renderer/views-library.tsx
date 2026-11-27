import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  formatTime,
  MAX_PINS,
  SMART_DJ_SLOTS,
  isPinned,
  sortTracks,
  PLAYLIST_SORTS,
  type Album,
  type AlbumSort,
  type Artist,
  type Playlist,
  type PlaylistSort,
  type Seed,
  type Track,
  type TrackSort,
  type TrackSortKey,
} from '../core';
import {
  activeConfig,
  addDemoSource,
  addToPlaylist,
  albumPin,
  artistPin,
  assignSmartDj,
  cached,
  clearCover,
  clearSmartDj,
  enqueue,
  go,
  hasOwnCover,
  isFlipping,
  notify,
  openMixview,
  openPin,
  player,
  playAlbum,
  playArtist,
  playLikesMix,
  playlistPin,
  playPin,
  playPlaylist,
  playSmartDj,
  playTracks,
  requireSource,
  setCover,
  settings,
  togglePinned,
  togglePlay,
  update,
} from './state';
import { coverFromFile } from './covers';
import { Art, Await, Icon, Section, Tile, TrackList, useAsync, useDropZone } from './ui';

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
        <Section
          title="smart dj"
          right={
            <button class="btn small" title="A mix built from the songs you have liked" onClick={() => void playLikesMix(cfg.id)}>
              <Icon name="heart" size={14} /> from my likes
            </button>
          }
        >
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
                <div
                  key={i}
                  class="tile slot"
                  role="button"
                  tabIndex={0}
                  title="Right-click an album or artist (or use its pin button) to pin it here"
                  onClick={() => {
                    notify('Right-click any album or artist, or use its pin button, to pin it to Quickplay');
                    go({ name: 'collection', tab: 'albums' });
                  }}
                >
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
      pin={albumPin(album)}
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
      pin={artistPin(artist)}
    />
  );
}

/* ---------------------------------------------------------------- collection */

type Tab = 'artists' | 'albums' | 'playlists' | 'songs' | 'liked';

export function Collection({ tab }: { tab: Tab }): JSX.Element {
  const cfg = activeConfig.value;
  const classic = settings.value.layout === 'classic';
  // Classic folds artists / albums / songs into one three-column library.
  const tabs: { label: string; to: Tab; on: boolean }[] = classic
    ? [
        { label: 'library', to: 'artists', on: tab === 'artists' || tab === 'albums' || tab === 'songs' },
        { label: 'playlists', to: 'playlists', on: tab === 'playlists' },
        { label: 'liked', to: 'liked', on: tab === 'liked' },
      ]
    : (['artists', 'albums', 'playlists', 'songs', 'liked'] as Tab[]).map((t) => ({ label: t, to: t, on: t === tab }));
  return (
    <div class="collection">
      <nav class="subpivot">
        {tabs.map((t) => (
          <a key={t.label} class={t.on ? 'active' : ''} href={`#/collection/${t.to}`}>
            {t.label}
          </a>
        ))}
      </nav>
      {!cfg ? (
        <div class="status">add a server in “sources” to see your collection</div>
      ) : tab === 'playlists' ? (
        <PlaylistsTab srcId={cfg.id} />
      ) : tab === 'liked' ? (
        <LikedTab srcId={cfg.id} />
      ) : classic ? (
        <ClassicLibrary srcId={cfg.id} />
      ) : tab === 'artists' ? (
        <ArtistsTab srcId={cfg.id} />
      ) : tab === 'albums' ? (
        <AlbumsTab srcId={cfg.id} />
      ) : (
        <SongsTab srcId={cfg.id} />
      )}
    </div>
  );
}

/** Scroll a letter group to just below the sticky jump bar (which would otherwise cover its top). */
function jumpToLetter(l: string): void {
  const el = document.getElementById(`letter-${l}`);
  const main = el?.closest('.main');
  const bar = main?.querySelector<HTMLElement>('.letters');
  if (!el || !main || !bar) return;
  // Where the bar's bottom edge sits once stuck: sticky offsets are measured from inside the scroller's padding.
  const stuckBottom = (parseFloat(getComputedStyle(main).paddingTop) || 0) + (parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight;
  const delta = el.getBoundingClientRect().top - main.getBoundingClientRect().top;
  main.scrollTo({ top: Math.max(0, main.scrollTop + delta - stuckBottom - 6), behavior: 'smooth' });
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
                <button key={l} onClick={() => jumpToLetter(l)}>
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
  const sort = settings.value.collectionSort.albums;
  const setSort = (v: AlbumSort): void => update((s) => (s.collectionSort.albums = v));
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

const sortPlaylists = (lists: Playlist[], by: PlaylistSort): Playlist[] => {
  const name = (p: Playlist): string => p.name.replace(/^(the|a|an)\s+/i, '');
  const byName = (a: Playlist, b: Playlist): number => name(a).localeCompare(name(b), undefined, { sensitivity: 'base', numeric: true });
  const out = lists.slice();
  if (by === 'size') return out.sort((a, b) => (b.trackCount ?? 0) - (a.trackCount ?? 0) || byName(a, b));
  if (by === 'recent') return out.sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? '') || byName(a, b));
  return out.sort(byName);
};

function PlaylistsTab({ srcId }: { srcId: string }): JSX.Element {
  const st = useAsync(() => cached(`playlists:${srcId}`, () => requireSource(srcId).getPlaylists()), [srcId]);
  const saved = settings.value.collectionSort.playlists;
  const setSort = (v: PlaylistSort): void => update((s) => (s.collectionSort.playlists = v));
  return (
    <Await state={st}>
      {(all) => {
        // "recently added" only makes sense when the server tells us when playlists were created
        const choices = PLAYLIST_SORTS.filter((s) => s !== 'recent' || all.some((p) => p.addedAt));
        const sort = choices.includes(saved) ? saved : 'name';
        const lists = sortPlaylists(all, sort);
        return lists.length === 0 ? (
          <div class="status">no playlists found</div>
        ) : (
          <>
          <div class="chips">
            {choices.map((s) => (
              <button key={s} class={`chip ${s === sort ? 'on' : ''}`} onClick={() => setSort(s)}>
                {s === 'recent' ? 'recently added' : s === 'size' ? 'most songs' : 'by name'}
              </button>
            ))}
          </div>
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
                onPlay={() => void playPlaylist(p.src, p.id)}
                pin={playlistPin(p)}
              />
            ))}
          </div>
          </>
        );
      }}
    </Await>
  );
}

export function PlaylistPage({ src, id }: { src: string; id: string }): JSX.Element {
  const st = useAsync(() => requireSource(src).getPlaylist(id), [src, id]);
  return <Await state={st}>{({ playlist, tracks }) => <PlaylistBody playlist={playlist} tracks={tracks} reload={st.reload} />}</Await>;
}

function PlaylistBody({ playlist, tracks, reload }: { playlist: Playlist; tracks: Track[]; reload(): void }): JSX.Element {
  const src = playlist.src;
  const [adding, setAdding] = useState(false);
  const total = tracks.reduce((n, t) => n + t.durationSec, 0);
  const pin = playlistPin(playlist);
  const pinned = isPinned(settings.value.quickplay, pin);
  const coverId = playlist.imageId ?? `own:${playlist.id}`;
  const drop = useDropZone((dropped) => {
    void addToPlaylist(playlist, dropped).then((ok) => ok && reload());
  });
  return (
    <div class="detail">
      <div class="hero">
        <Art src={src} id={coverId} label={playlist.name} size={600} class={`hero-art ${isFlipping(src, coverId) ? 'flip' : ''}`} />
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
            <button class={`btn ${adding ? 'on' : ''}`} onClick={() => setAdding(!adding)}>
              <Icon name="playlist-add" size={18} /> add songs
            </button>
            <button class={`btn ${pinned ? 'on' : ''}`} onClick={() => togglePinned(pin)}>
              <Icon name="pin" size={18} /> {pinned ? 'pinned' : 'pin'}
            </button>
            <CoverActions src={src} id={coverId} />
          </div>
        </div>
      </div>
      {adding && <AddSongsPanel playlist={playlist} onAdded={reload} />}
      <div {...drop.props} class={`drop-area ${drop.over ? 'over' : ''}`}>
        <TrackList tracks={tracks} showArtist showAlbum />
        {drop.over && <div class="drop-hint">drop to add to “{playlist.name}”</div>}
      </div>
    </div>
  );
}

/** Pick songs from your likes, a search, or the queue and add them here (rows can also be dragged onto the list below). */
function AddSongsPanel({ playlist, onAdded }: { playlist: Playlist; onAdded(): void }): JSX.Element {
  const src = playlist.src;
  const [tab, setTab] = useState<'liked' | 'search' | 'queue'>('liked');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const h = window.setTimeout(() => setTerm(q.trim()), 300);
    return () => window.clearTimeout(h);
  }, [q]);
  const liked = useAsync(() => (tab === 'liked' ? requireSource(src).getLikedTracks(200) : Promise.resolve([] as Track[])), [src, tab]);
  const found = useAsync(() => (tab === 'search' && term ? requireSource(src).search(term).then((r) => r.tracks) : Promise.resolve([] as Track[])), [src, tab, term]);
  const rows = tab === 'liked' ? liked.data : tab === 'search' ? found.data : player.queue.value.filter((t) => t.src === src);
  const error = tab === 'liked' ? liked.error : tab === 'search' ? found.error : undefined;
  return (
    <div class="add-panel">
      <div class="chips">
        {(['liked', 'search', 'queue'] as const).map((t) => (
          <button key={t} class={`chip ${t === tab ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t === 'queue' ? 'now playing' : t}
          </button>
        ))}
        {tab === 'search' && (
          <input class="add-search" type="search" placeholder="search songs" aria-label="Search songs to add" value={q} autoFocus onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        )}
      </div>
      {error ? (
        <div class="status error">{error}</div>
      ) : rows === undefined ? (
        <div class="status">loading…</div>
      ) : rows.length === 0 ? (
        <div class="status">{tab === 'liked' ? 'no liked songs yet' : tab === 'search' ? (term ? 'no songs found' : 'type to search') : 'nothing in now playing'}</div>
      ) : (
        <div class="add-rows">
          <TrackList
            tracks={rows}
            showArtist
            actions={(t) => (
              <button title={`Add to ${playlist.name}`} onClick={() => void addToPlaylist(playlist, [t]).then((ok) => ok && onAdded())}>
                <Icon name="plus" size={16} />
              </button>
            )}
          />
        </div>
      )}
    </div>
  );
}

/** Replace a cover on this computer (the server is not changed), or put the original back. */
function CoverActions({ src, id }: { src: string; id: string | undefined }): JSX.Element | null {
  const input = useRef<HTMLInputElement>(null);
  if (!id) return null;
  const own = hasOwnCover(src, id);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const el = e.target as HTMLInputElement;
          const file = el.files?.[0];
          el.value = '';
          if (!file) return;
          try {
            setCover(src, id, await coverFromFile(file));
            notify('Cover changed on this computer');
          } catch (err) {
            notify((err as Error).message, 'error');
          }
        }}
      />
      <button class="btn" title="Use your own image for this cover (stays on this computer)" onClick={() => input.current?.click()}>
        <Icon name="expand" size={18} /> change cover
      </button>
      {own && (
        <button class="btn" onClick={() => clearCover(src, id)}>
          reset cover
        </button>
      )}
    </>
  );
}

function LikedTab({ srcId }: { srcId: string }): JSX.Element {
  const st = useAsync(() => requireSource(srcId).getLikedTracks(500), [srcId]);
  return (
    <Await state={st}>
      {(tracks) =>
        tracks.length === 0 ? (
          <div class="status">no liked songs yet. use the heart next to a song</div>
        ) : (
          <>
            <div class="actions top">
              <button class="btn primary" onClick={() => playTracks(tracks, 0, { shuffle: false })}>
                <Icon name="play" size={18} /> play
              </button>
              <button class="btn" onClick={() => playTracks(tracks, 0, { shuffle: true })}>
                <Icon name="shuffle" size={18} /> shuffle
              </button>
              <button class="btn" onClick={() => void playLikesMix(srcId)}>
                <Icon name="dj" size={18} /> smart dj from likes
              </button>
            </div>
            <TrackList tracks={tracks} showArtist showAlbum />
          </>
        )
      }
    </Await>
  );
}

/** The classic Zune library: artists, then that artist's albums, then that album's songs, side by side. */
function ClassicLibrary({ srcId }: { srcId: string }): JSX.Element {
  const [artistId, setArtistId] = useState<string>();
  const [albumId, setAlbumId] = useState<string>();
  useEffect(() => {
    setArtistId(undefined);
    setAlbumId(undefined);
  }, [srcId]);
  const artists = useAsync(() => cached(`artists:${srcId}`, () => requireSource(srcId).getArtists()), [srcId]);
  const albums = useAsync(() => (artistId ? requireSource(srcId).getArtist(artistId).then((r) => r.albums) : Promise.resolve([] as Album[])), [srcId, artistId]);
  const album = useAsync(() => (albumId ? requireSource(srcId).getAlbum(albumId) : Promise.resolve(undefined)), [srcId, albumId]);
  const sorted = [...(artists.data ?? [])].sort((a, b) => a.name.replace(/^the\s+/i, '').localeCompare(b.name.replace(/^the\s+/i, ''), undefined, { sensitivity: 'base' }));
  const tracks = albumId ? (album.data?.tracks ?? []) : [];
  return (
    <div class="classic">
      <div class="classic-col">
        <h3>artists</h3>
        {artists.error ? (
          <div class="status error">{artists.error}</div>
        ) : artists.data === undefined ? (
          <div class="status">loading…</div>
        ) : (
          <ul>
            {sorted.map((a) => (
              <li key={a.id}>
                <button
                  class={a.id === artistId ? 'on' : ''}
                  onClick={() => {
                    setArtistId(a.id);
                    setAlbumId(undefined);
                  }}
                  onDblClick={() => void playArtist(srcId, a.id)}
                >
                  {a.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div class="classic-col">
        <h3>albums</h3>
        {!artistId ? (
          <div class="status">pick an artist</div>
        ) : albums.error ? (
          <div class="status error">{albums.error}</div>
        ) : albums.data === undefined ? (
          <div class="status">loading…</div>
        ) : albums.data.length === 0 ? (
          <div class="status">no albums</div>
        ) : (
          <ul>
            {albums.data.map((a) => (
              <li key={a.id}>
                <button class={`with-art ${a.id === albumId ? 'on' : ''}`} onClick={() => setAlbumId(a.id)} onDblClick={() => void playAlbum(srcId, a.id)}>
                  <Art src={srcId} id={a.imageId} label={a.title} size={80} class="classic-art" />
                  <span>
                    {a.title}
                    {a.year ? <small>{a.year}</small> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div class="classic-col wide">
        <h3>songs</h3>
        {!albumId ? (
          <div class="status">pick an album</div>
        ) : album.error ? (
          <div class="status error">{album.error}</div>
        ) : album.data === undefined ? (
          <div class="status">loading…</div>
        ) : (
          <>
            <div class="actions top">
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
            <TrackList tracks={tracks} numbered />
          </>
        )}
      </div>
    </div>
  );
}

function SongsTab({ srcId }: { srcId: string }): JSX.Element {
  const sort = settings.value.collectionSort.songs;
  const setSort = (fn: (s: TrackSort) => TrackSort): void => update((st) => (st.collectionSort.songs = fn(st.collectionSort.songs)));
  const source = requireSource(srcId);
  // Servers that can sort do it themselves (so paging stays correct); otherwise we sort what has loaded so far.
  const p = usePaged((offset, limit) => source.getTracks({ offset, limit, sort }), [srcId, sort.by, sort.desc]);
  const rows = source.sortsTracksOnServer ? p.items : sortTracks(p.items, sort);
  const onSort = (by: TrackSortKey): void => setSort((s) => (s.by === by ? { by, desc: !s.desc } : { by }));
  return (
    <>
      <TrackList tracks={rows} showArtist showAlbum sort={{ ...sort, onSort }} />
      {!source.sortsTracksOnServer && !p.done && p.items.length > 0 && sort.by !== 'title' && (
        <div class="status">sorting the songs loaded so far — load more to include the rest of your library</div>
      )}
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
              <Art src={src} id={artist.imageId} label={artist.name} size={500} class={`hero-art ${isFlipping(src, artist.imageId) ? 'flip' : ''}`} />
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
                  <button class="btn" onClick={() => (assignSmartDj(seed), void playSmartDj(seed))}>
                    <Icon name="dj" size={18} /> smart dj
                  </button>
                  <button class={`btn ${pinned ? 'on' : ''}`} onClick={() => togglePinned(pin)}>
                    <Icon name="pin" size={18} /> {pinned ? 'pinned' : 'pin'}
                  </button>
                  <button class="btn" title="Related artists and albums around this one" onClick={() => openMixview(src, id)}>
                    <Icon name="mix" size={18} /> mixview
                  </button>
                  <CoverActions src={src} id={artist.imageId} />
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
              <Art src={src} id={album.imageId} label={album.title} size={600} class={`hero-art ${isFlipping(src, album.imageId) ? 'flip' : ''}`} />
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
                  <button class="btn" onClick={() => (assignSmartDj(seed), void playSmartDj(seed))}>
                    <Icon name="dj" size={18} /> smart dj
                  </button>
                  <button class={`btn ${pinned ? 'on' : ''}`} onClick={() => togglePinned(pin)}>
                    <Icon name="pin" size={18} /> {pinned ? 'pinned' : 'pin'}
                  </button>
                  {album.artistId && (
                    <button class="btn" title="Related artists and albums around this artist" onClick={() => openMixview(src, album.artistId as string)}>
                      <Icon name="mix" size={18} /> mixview
                    </button>
                  )}
                  <CoverActions src={src} id={album.imageId} />
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
