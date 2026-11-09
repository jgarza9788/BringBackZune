/**
 * Audio engine. Real streams use an <audio> element; tracks without a URL (the offline demo
 * library) are "played" by a timer so the whole UI can be exercised without sound.
 */
export interface EngineEvents {
  time(position: number, duration: number): void;
  state(playing: boolean): void;
  ended(): void;
  error(message: string): void;
}

export class Engine {
  private audio = new Audio();
  private timer: number | undefined;
  private sim = false;
  private simPos = 0;
  private simDur = 0;
  private simPlaying = false;
  private hint = 0;
  private volume = 0.8;

  constructor(private readonly ev: EngineEvents) {
    this.audio.preload = 'auto';
    this.audio.addEventListener('timeupdate', () => this.emitTime());
    this.audio.addEventListener('durationchange', () => this.emitTime());
    this.audio.addEventListener('play', () => ev.state(true));
    this.audio.addEventListener('pause', () => ev.state(false));
    this.audio.addEventListener('ended', () => ev.ended());
    this.audio.addEventListener('error', () => {
      const code = this.audio.error?.code;
      ev.error(
        code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? 'This audio format or stream could not be played'
          : code === MediaError.MEDIA_ERR_NETWORK
            ? 'Network error while streaming'
            : 'Playback error',
      );
    });
  }

  private emitTime(): void {
    const d = Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : this.hint;
    this.ev.time(this.audio.currentTime, d);
  }

  load(url: string, durationHint: number, autoplay = true): void {
    this.stopSim();
    this.hint = durationHint;
    if (url) {
      this.sim = false;
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

  private stopSim(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.simPlaying = false;
  }
}
