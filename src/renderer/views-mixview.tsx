import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';
import type { Album, Artist, Seed } from '../core';
import { assignSmartDj, go, mixTrail, notify, player, playArtist, playSmartDj, requireSource } from './state';
import { Art, Await, Icon, useAsync } from './ui';

/**
 * Where the tiles around the artist sit: offsets from the middle of the stage and a size, in "cqmin"
 * (1% of the stage's shorter side), so the cluster keeps its shape in any window. Tiles of different sizes overlap a
 * little, and the ones nearest the middle slip behind the main cover, like a pile of record sleeves.
 */
const SLOTS: [dx: number, dy: number, size: number][] = [
  [-33, -26, 22],
  [38, -22, 25],
  [-41, 12, 27],
  [-8, -38, 22],
  [45, 12, 22],
  [32, 36, 26],
  [-24, 37, 22],
  [16, -39, 22],
  [8, 38, 22],
  [-50, -14, 15],
  [51, -2, 15],
  [-51, 33, 15],
  [50, 33, 14],
];
/** The pink "smart dj" tile, up in the corner of the cluster. */
const DJ_SLOT: [number, number, number] = [-33, -40, 15];

type Cell = { kind: 'artist'; artist: Artist } | { kind: 'album'; album: Album };

/** Related artists and the artist's own albums, taken in turn so the pile has a bit of both. */
function ring(similar: Artist[], albums: Album[]): Cell[] {
  const a = similar.map((artist): Cell => ({ kind: 'artist', artist }));
  const b = albums.map((album): Cell => ({ kind: 'album', album }));
  const out: Cell[] = [];
  for (let i = 0; out.length < SLOTS.length && (i < a.length || i < b.length); i++) {
    if (a[i]) out.push(a[i] as Cell);
    if (out.length < SLOTS.length && b[i]) out.push(b[i] as Cell);
  }
  return out;
}

const place = (slot: [number, number, number], i: number): JSX.CSSProperties =>
  ({ '--dx': slot[0], '--dy': slot[1], '--s': slot[2], '--i': i }) as JSX.CSSProperties;

/**
 * Mixview: an artist in the middle with related artists and albums piled around them. Pick one of the artists to
 * move the view there; the trail above lets you step back, and "follow what's playing" jumps to the artist you are hearing.
 */
export function MixviewPage({ src, id }: { src: string; id: string }): JSX.Element {
  const st = useAsync(async () => {
    const s = requireSource(src);
    const [{ artist, albums }, similar] = await Promise.all([s.getArtist(id), s.getSimilarArtists(id, 12).catch(() => [] as Artist[])]);
    return { artist, albums, similar };
  }, [src, id]);

  // Keep the trail in step with where we are: stepping back (or the back button) cuts it short.
  const loaded = st.data?.artist;
  useEffect(() => {
    if (!loaded || loaded.id !== id) return;
    const trail = mixTrail.peek();
    const at = trail.findIndex((c) => c.src === src && c.id === id);
    mixTrail.value = at >= 0 ? trail.slice(0, at + 1) : [...trail, { src, id, name: loaded.name }].slice(-8);
  }, [src, id, loaded?.id]);

  const following = player.track.value;
  const trail = mixTrail.value;
  return (
    <div class="mix">
      <div class="mix-mark" aria-hidden="true">
        mixview
      </div>
      <div class="mix-top">
        <button class="mix-link" onClick={() => go({ name: 'artist', src, id })}>
          exit mixview
        </button>
        <span class="mix-sep" />
        <button
          class="mix-link"
          onClick={() => (following?.artistId ? go({ name: 'mixview', src: following.src, id: following.artistId }) : notify('Play something first', 'error'))}
        >
          follow what&apos;s playing
        </button>
      </div>
      {trail.length > 1 && (
        <nav class="mix-trail" aria-label="Mixview trail">
          {trail.map((c, i) => (
            <span key={`${c.id}-${i}`}>
              {i > 0 && <span class="sep"> › </span>}
              {i === trail.length - 1 ? <b>{c.name}</b> : <a href={`#/mixview/${encodeURIComponent(c.src)}/${encodeURIComponent(c.id)}`}>{c.name}</a>}
            </span>
          ))}
        </nav>
      )}
      <Await state={st}>
        {({ artist, albums, similar }) => {
          const cells = ring(similar, albums);
          const seed: Seed = { kind: 'artist', src, id, title: artist.name, imageId: artist.imageId };
          return (
            <div class="mix-stage">
              {cells.map((c, i) => {
                const slot = SLOTS[i] as [number, number, number];
                return c.kind === 'artist' ? (
                  <button
                    key={`a${c.artist.id}`}
                    class="mix-tile"
                    style={place(slot, i)}
                    title={`${c.artist.name} · related artist (double-click to play)`}
                    onClick={() => go({ name: 'mixview', src: c.artist.src, id: c.artist.id })}
                    onDblClick={() => void playArtist(c.artist.src, c.artist.id)}
                  >
                    <Art src={c.artist.src} id={c.artist.imageId} label={c.artist.name} size={300} />
                    <span class="mix-label">{c.artist.name}</span>
                  </button>
                ) : (
                  <button
                    key={`b${c.album.id}`}
                    class="mix-tile album"
                    style={place(slot, i)}
                    title={`${c.album.title}${c.album.year ? ` (${c.album.year})` : ''} · album`}
                    onClick={() => go({ name: 'album', src: c.album.src, id: c.album.id })}
                  >
                    <Art src={c.album.src} id={c.album.imageId} label={c.album.title} size={300} />
                    <span class="mix-label">{c.album.title}</span>
                  </button>
                );
              })}
              <button class="mix-tile mix-dj" style={place(DJ_SLOT, cells.length)} title={`Smart DJ from ${artist.name}`} onClick={() => (assignSmartDj(seed), void playSmartDj(seed))}>
                <Icon name="dj" size={30} />
                <span>smart dj</span>
              </button>
              <div class="mix-core">
                <div class="mix-cover">
                  <Art src={src} id={artist.imageId} label={artist.name} size={600} />
                </div>
                <div class="mix-cap">
                  <b>{artist.name}</b>
                  <span>
                    {albums.length} album{albums.length === 1 ? '' : 's'}
                    {similar.length > 0 ? ` · ${similar.length} related` : ' · no related artists on this server'}
                  </span>
                  <button class="mix-play" title={`Play ${artist.name}`} aria-label={`Play ${artist.name}`} onClick={() => void playArtist(src, id)}>
                    <Icon name="play" size={20} />
                  </button>
                </div>
              </div>
            </div>
          );
        }}
      </Await>
    </div>
  );
}
