import { describe, expect, it } from 'vitest';
import { PlaybackQueue } from '../src/core/queue';
import {
  emptyQuickplay,
  isPinned,
  loadQuickplay,
  MAX_HISTORY,
  MAX_PINS,
  pushHistory,
  setSmartDjSlot,
  togglePin,
  trackToPin,
  type PinRef,
} from '../src/core/quickplay';
import type { Track } from '../src/core/types';
import { seededRng } from '../src/core/util';

const mk = (n: number): Track[] =>
  Array.from({ length: n }, (_, i) => ({ src: 's', id: `t${i}`, title: `T${i}`, artist: 'A', album: 'B', durationSec: 100 }));

describe('PlaybackQueue', () => {
  it('plays in order, stops at the end, wraps with repeat-all', () => {
    const q = new PlaybackQueue();
    q.set(mk(3), 1);
    expect(q.current!.id).toBe('t1');
    expect(q.next()!.id).toBe('t2');
    expect(q.next()).toBeUndefined();
    q.repeat = 'all';
    expect(q.next()!.id).toBe('t0');
    expect(q.previous()!.id).toBe('t2');
  });

  it('repeat-one only loops on auto-advance', () => {
    const q = new PlaybackQueue();
    q.set(mk(3));
    q.repeat = 'one';
    expect(q.next(true)!.id).toBe('t0');
    expect(q.next(false)!.id).toBe('t1');
  });

  it('shuffle keeps the current track first and is reversible', () => {
    const q = new PlaybackQueue(seededRng(1));
    q.set(mk(10), 4);
    q.setShuffle(true);
    expect(q.current!.id).toBe('t4');
    expect(q.currentIndex).toBe(0);
    expect(new Set(q.tracks.map((t) => t.id)).size).toBe(10);
    q.next();
    const playing = q.current!.id;
    q.setShuffle(false);
    expect(q.tracks.map((t) => t.id)).toEqual(mk(10).map((t) => t.id));
    expect(q.current!.id).toBe(playing);
  });

  it('set() with shuffle on starts on the chosen track', () => {
    const q = new PlaybackQueue(seededRng(7));
    q.shuffle = true;
    q.set(mk(6), 3);
    expect(q.current!.id).toBe('t3');
    expect(q.length).toBe(6);
  });

  it('enqueue / playNext / remove adjust the index correctly', () => {
    const q = new PlaybackQueue();
    q.set(mk(3), 1);
    q.playNext(mk(1).map((t) => ({ ...t, id: 'next' })));
    expect(q.tracks[2]!.id).toBe('next');
    q.enqueue(mk(1).map((t) => ({ ...t, id: 'end' })));
    expect(q.tracks.at(-1)!.id).toBe('end');
    q.remove(0);
    expect(q.current!.id).toBe('t1');
    expect(q.currentIndex).toBe(0);
    q.remove(0);
    expect(q.current!.id).toBe('next');
  });

  it('handles empty queues without throwing', () => {
    const q = new PlaybackQueue();
    expect(q.next()).toBeUndefined();
    expect(q.previous()).toBeUndefined();
    expect(q.set([])).toBeUndefined();
    q.enqueue(mk(2));
    expect(q.current!.id).toBe('t0');
  });
});

describe('Quickplay state', () => {
  const pin = (id: string): PinRef => ({ kind: 'album', src: 's', id, title: id });

  it('caps pins at 6 and toggles', () => {
    const s = emptyQuickplay();
    for (let i = 0; i < MAX_PINS; i++) expect(togglePin(s, pin(`a${i}`))).toBe(true);
    expect(togglePin(s, pin('overflow'))).toBe(false);
    expect(isPinned(s, pin('a0'))).toBe(true);
    expect(togglePin(s, pin('a0'))).toBe(true);
    expect(isPinned(s, pin('a0'))).toBe(false);
    expect(togglePin(s, pin('overflow'))).toBe(true);
  });

  it('treats the same id as different pins when the kind differs, and keeps playlist/track pins across a reload', () => {
    const s = emptyQuickplay();
    const t = { src: 's', id: 'x', title: 'Song', artist: 'Band', album: 'LP', albumId: 'al1', durationSec: 10 } as Track;
    togglePin(s, { kind: 'playlist', src: 's', id: 'x', title: 'Mix' });
    togglePin(s, { kind: 'album', src: 's', id: 'x', title: 'Album' });
    togglePin(s, trackToPin(t));
    expect(s.pins.map((p) => p.kind)).toEqual(['playlist', 'album', 'track']);
    expect(trackToPin(t).albumId).toBe('al1');
    const back = loadQuickplay(JSON.parse(JSON.stringify(s)));
    expect(back.pins).toEqual(s.pins);
  });

  it('history is most-recent-first, de-duplicated and capped', () => {
    const s = emptyQuickplay();
    for (let i = 0; i < MAX_HISTORY + 5; i++) pushHistory(s, pin(`h${i}`));
    expect(s.history).toHaveLength(MAX_HISTORY);
    pushHistory(s, pin('h10'));
    expect(s.history[0]!.id).toBe('h10');
    expect(s.history.filter((h) => h.id === 'h10')).toHaveLength(1);
  });

  it('round-trips through JSON and survives garbage', () => {
    const s = emptyQuickplay();
    togglePin(s, pin('x'));
    setSmartDjSlot(s, 2, { kind: 'artist', src: 's', id: 'ar', title: 'Artist' });
    expect(loadQuickplay(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(loadQuickplay(null)).toEqual(emptyQuickplay());
    expect(loadQuickplay({ pins: 'nope', history: [null, 3], smartDj: [1, 2] })).toEqual(emptyQuickplay());
    setSmartDjSlot(s, 9, null);
    expect(s.smartDj).toHaveLength(5);
  });
});
