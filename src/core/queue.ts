import type { Track } from './types';
import { shuffled } from './util';

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueSnapshot {
  items: Track[];
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

/**
 * Playback queue. `items` is the play order (already shuffled when shuffle is on),
 * `original` remembers the un-shuffled order so shuffle can be switched off again.
 */
export class PlaybackQueue {
  private items: Track[] = [];
  private original: Track[] = [];
  private index = -1;
  shuffle = false;
  repeat: RepeatMode = 'off';

  constructor(private readonly rng: () => number = Math.random) {}

  get current(): Track | undefined {
    return this.items[this.index];
  }
  get currentIndex(): number {
    return this.index;
  }
  get tracks(): readonly Track[] {
    return this.items;
  }
  get length(): number {
    return this.items.length;
  }

  snapshot(): QueueSnapshot {
    return { items: this.items.slice(), index: this.index, shuffle: this.shuffle, repeat: this.repeat };
  }

  /** Replace the queue and start at `startIndex` (index into the given list). */
  set(tracks: Track[], startIndex = 0): Track | undefined {
    this.original = tracks.slice();
    if (tracks.length === 0) {
      this.items = [];
      this.index = -1;
      return undefined;
    }
    const start = Math.min(Math.max(startIndex, 0), tracks.length - 1);
    if (this.shuffle) {
      const first = tracks[start] as Track;
      const rest = shuffled(tracks.filter((_, i) => i !== start), this.rng);
      this.items = [first, ...rest];
      this.index = 0;
    } else {
      this.items = tracks.slice();
      this.index = start;
    }
    return this.current;
  }

  /** Append to the end ("add to now playing"). */
  enqueue(tracks: Track[]): void {
    this.original.push(...tracks);
    this.items.push(...tracks);
    if (this.index < 0 && this.items.length > 0) this.index = 0;
  }

  /** Insert right after the current track ("play next"). */
  playNext(tracks: Track[]): void {
    const at = this.index + 1;
    this.items.splice(at, 0, ...tracks);
    this.original.push(...tracks);
    if (this.index < 0 && this.items.length > 0) this.index = 0;
  }

  remove(i: number): void {
    if (i < 0 || i >= this.items.length) return;
    const [gone] = this.items.splice(i, 1);
    const oi = this.original.findIndex((t) => t === gone);
    if (oi >= 0) this.original.splice(oi, 1);
    if (i < this.index) this.index--;
    else if (i === this.index && this.index >= this.items.length) this.index = this.items.length - 1;
  }

  clear(): void {
    this.items = [];
    this.original = [];
    this.index = -1;
  }

  jump(i: number): Track | undefined {
    if (i < 0 || i >= this.items.length) return undefined;
    this.index = i;
    return this.current;
  }

  /**
   * Advance. `auto` = the track ended by itself (honours repeat-one);
   * otherwise it's a user "next" press (repeat-one still advances).
   */
  next(auto = false): Track | undefined {
    if (this.items.length === 0) return undefined;
    if (auto && this.repeat === 'one') return this.current;
    if (this.index + 1 < this.items.length) {
      this.index++;
      return this.current;
    }
    if (this.repeat === 'all') {
      this.index = 0;
      return this.current;
    }
    return undefined;
  }

  previous(): Track | undefined {
    if (this.items.length === 0) return undefined;
    if (this.index > 0) {
      this.index--;
      return this.current;
    }
    if (this.repeat === 'all') {
      this.index = this.items.length - 1;
      return this.current;
    }
    return this.current;
  }

  setShuffle(on: boolean): void {
    if (on === this.shuffle) return;
    this.shuffle = on;
    const cur = this.current;
    if (!cur) return;
    if (on) {
      const rest = shuffled(this.items.filter((t) => t !== cur), this.rng);
      this.items = [cur, ...rest];
      this.index = 0;
    } else {
      this.items = this.original.slice();
      this.index = Math.max(0, this.items.indexOf(cur));
    }
  }

  cycleRepeat(): RepeatMode {
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    return this.repeat;
  }
}
