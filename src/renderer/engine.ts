/**
 * Audio engine. Real streams use an <audio> element; tracks without a URL (the offline demo
 * library) are "played" by a timer so the whole UI can be exercised without sound.
 *
 * Real streams are also routed through a Web Audio analyser so the now-playing visualizer can
 * follow the music. That needs CORS-readable media (the Electron main process adds the header);
 * if a server still refuses, the element is rebuilt without the analyser and the visualizer
 * falls back to a simulated pulse, so playback itself never depends on it.
 */
export interface EngineEvents {
  time(position: number, duration: number): void;
  state(playing: boolean): void;
  ended(): void;
  error(message: string): void;
}

/** Smoothed-by-the-caller energy per band, each 0..1. */
export interface Levels {
  low: number;
  mid: number;
  high: number;
}

export class Engine {
  private audio: HTMLAudioElement;
  private timer: number | undefined;
  private sim = false;
  private simPos = 0;
  private simDur = 0;
  private simPlaying = false;
  private hint = 0;
  private volume = 0.8;

  private ctx: AudioContext | undefined;
  private analyser: AnalyserNode | undefined;
  private source: MediaElementAudioSourceNode | undefined;
  private bins = new Uint8Array(0);
  /** False once a server has refused CORS: we then play without the analyser. */
  private corsOk = true;
  private url = '';
  private autoplay = true;

  constructor(private readonly ev: EngineEvents) {
    this.audio = this.makeAudio(true);
  }

  private makeAudio(cors: boolean): HTMLAudioElement {
    const a = new Audio();
    a.preload = 'auto';
    a.volume = this.volume;
    if (cors) a.crossOrigin = 'anonymous';
    const mine = (fn: () => void) => () => {
      if (a === this.audio) fn();
    };
    a.addEventListener('timeupdate', mine(() => this.emitTime()));
    a.addEventListener('durationchange', mine(() => this.emitTime()));
    a.addEventListener('play', mine(() => this.ev.state(true)));
    a.addEventListener('pause', mine(() => this.ev.state(false)));
    a.addEventListener('ended', mine(() => this.ev.ended()));
    a.addEventListener(
      'error',
      mine(() => {
        // A CORS refusal looks like "format not supported": retry once without the analyser.
        if (this.corsOk && this.url && a.crossOrigin) {
          this.fallBackWithoutAnalyser();
          return;
        }
        const code = a.error?.code;
        this.ev.error(
          code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
            ? 'This audio format or stream could not be played'
            : code === MediaError.MEDIA_ERR_NETWORK
              ? 'Network error while streaming'
              : 'Playback error',
        );
      }),
    );
    if (cors) this.attachAnalyser(a);
    return a;
  }

  private attachAnalyser(a: HTMLAudioElement): void {
    try {
      this.ctx ??= new AudioContext();
      this.analyser ??= this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      // snappy, and a narrower dB window than the default (-100..-30) so ordinary music fills more of the range
      this.analyser.smoothingTimeConstant = 0.45;
      this.analyser.minDecibels = -88;
      this.analyser.maxDecibels = -22;
      this.bins = new Uint8Array(this.analyser.frequencyBinCount);
      this.source = this.ctx.createMediaElementSource(a);
      this.source.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    } catch {
      this.source = undefined;
    }
  }

  private fallBackWithoutAnalyser(): void {
    this.corsOk = false;
    this.source?.disconnect();
    this.source = undefined;
    this.audio.pause();
    this.audio = this.makeAudio(false);
    this.audio.src = this.url;
    if (this.autoplay) void this.audio.play().catch((e: Error) => this.ev.error(e.message));
  }

  private emitTime(): void {
    const d = Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : this.hint;
    this.ev.time(this.audio.currentTime, d);
  }

  load(url: string, durationHint: number, autoplay = true): void {
    this.stopSim();
    this.hint = durationHint;
    this.url = url;
    this.autoplay = autoplay;
    if (url) {
      this.sim = false;
      void this.ctx?.resume();
      this.audio.src = url;
      this.audio.volume = this.volume;
      this.ev.time(0, durationHint);
      if (autoplay) void this.audio.play().catch((e: Error) => this.ev.error(e.message));
    } else {
      this.sim = true;
      this.audio.removeAttribute('src');
      this.audio.load();
      this.simPos = 0;
      this.simDur = durationHint;
      this.ev.time(0, durationHint);
      if (autoplay) this.play();
    }
  }

  play(): void {
    if (this.sim) {
      if (this.simPlaying) return;
      this.simPlaying = true;
      this.ev.state(true);
      this.timer = window.setInterval(() => {
        this.simPos = Math.min(this.simDur, this.simPos + 0.25);
        this.ev.time(this.simPos, this.simDur);
        if (this.simPos >= this.simDur) {
          this.stopSim();
          this.ev.ended();
        }
      }, 250);
    } else if (this.audio.src) {
      void this.ctx?.resume();
      void this.audio.play().catch((e: Error) => this.ev.error(e.message));
    }
  }

  pause(): void {
    if (this.sim) {
      this.stopSim();
      this.ev.state(false);
    } else this.audio.pause();
  }

  stop(): void {
    this.stopSim();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.url = '';
  }

  seek(sec: number): void {
    if (this.sim) {
      this.simPos = Math.max(0, Math.min(this.simDur, sec));
      this.ev.time(this.simPos, this.simDur);
    } else if (Number.isFinite(sec)) this.audio.currentTime = Math.max(0, sec);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.audio.volume = this.volume;
  }

  /**
   * Current band energy for the visualizer. Real analysis when available; otherwise a smooth
   * pseudo-random pulse while something is "playing" (demo library, or a server without CORS).
   * Note the analyser sits before the element volume, so levels do not shrink with the volume slider.
   */
  levels(): Levels {
    const playing = this.sim ? this.simPlaying : !this.audio.paused && !this.audio.ended;
    if (!playing) return { low: 0, mid: 0, high: 0 };
    if (this.analyser && this.source && !this.sim) {
      this.analyser.getByteFrequencyData(this.bins);
      const avg = (from: number, to: number): number => {
        let sum = 0;
        for (let i = from; i < to; i++) sum += this.bins[i] ?? 0;
        return sum / Math.max(1, to - from) / 255;
      };
      const shape = (v: number): number => Math.min(1, Math.pow(v, 1.4) * 1.5);
      return { low: shape(avg(0, 3)), mid: shape(avg(3, 20)), high: shape(avg(20, 90) * 1.8) };
    }
    const t = performance.now() / 1000;
    const wave = (f: number, p: number): number => 0.5 + 0.5 * Math.sin(t * f + p);
    return {
      low: 0.25 + 0.55 * wave(2.1, 0) * wave(0.7, 1),
      mid: 0.2 + 0.5 * wave(3.3, 2) * wave(1.1, 0.5),
      high: 0.15 + 0.5 * wave(4.7, 4) * wave(1.7, 2),
    };
  }

  /** True while audio (real or simulated) is actually playing. */
  isPlaying(): boolean {
    return this.sim ? this.simPlaying : !this.audio.paused && !this.audio.ended;
  }

  /**
   * `count` bars of spectrum energy (0..1), low frequencies first, log-spaced. Real analysis when
   * available, otherwise a lively per-bar pulse while playing; all zeros when not playing.
   */
  spectrum(count: number): number[] {
    const out = new Array<number>(count).fill(0);
    const playing = this.sim ? this.simPlaying : !this.audio.paused && !this.audio.ended;
    if (!playing) return out;
    if (this.analyser && this.source && !this.sim) {
      this.analyser.getByteFrequencyData(this.bins);
      const usable = Math.min(this.bins.length, 96);
      for (let i = 0; i < count; i++) {
        const from = 1 + Math.floor(Math.pow(i / count, 1.7) * (usable - 1));
        const to = Math.max(from + 1, 1 + Math.floor(Math.pow((i + 1) / count, 1.7) * (usable - 1)));
        let peak = 0;
        for (let b = from; b < to; b++) peak = Math.max(peak, this.bins[b] ?? 0);
        // gentle tilt: music has far less energy up high, so lift the right side
        out[i] = Math.min(1, Math.pow(peak / 255, 1.05) * (1 + (i / count) * 1.1));
      }
      return out;
    }
    const t = performance.now() / 1000;
    for (let i = 0; i < count; i++) {
      const a = 1.3 + ((i * 7919) % 13) * 0.37;
      const b = 0.7 + ((i * 104729) % 11) * 0.29;
      out[i] = Math.abs(Math.sin(t * a + i)) * Math.abs(Math.sin(t * b + i * 0.6)) * (0.9 - (i / count) * 0.35);
    }
    return out;
  }

  private stopSim(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.simPlaying = false;
  }
}
