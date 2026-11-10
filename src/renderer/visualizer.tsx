import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { audioPlaying, audioSpectrum } from './state';

const BARS = 40;
/** Columns the dome outline is drawn with (the spectrum is interpolated up to this). */
const COLS = 120;

const parseHex = (hex: string): [number, number, number] => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1] as string, 16) : 0xd80073;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const rgba = (c: [number, number, number], a: number): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

/**
 * The glow on the bottom edge of the control bar, as in the original software: one wide, low dome in
 * the accent colour, brightest at the base in the middle, whose top edge ripples with the music.
 * It stays on for as long as something is playing and fades away when playback stops.
 */
export function Visualizer(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cur = new Float32Array(BARS);
    let presence = 0;
    let peak = 0.3;
    let raf = 0;
    let tick = 0;
    let accent = parseHex('#d80073');
    let idle = false;

    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      if (tick++ % 20 === 0) accent = parseHex(getComputedStyle(document.documentElement).getPropertyValue('--accent'));

      const playing = audioPlaying();
      presence += ((playing ? 1 : 0) - presence) * (playing ? 0.25 : 0.08);

      const raw = audioSpectrum(BARS);
      let sum = 0;
      for (let i = 0; i < BARS; i++) {
        const target = still ? (playing ? 0.3 : 0) : (raw[i] ?? 0);
        const c = cur[i] ?? 0;
        // quick attack, slower release so the edge ripples instead of flickering
        cur[i] = c + (target - c) * (target > c ? 0.75 : 0.2);
      }
      // auto-gain: normalise to the recent peak so quiet tracks move as much as loud ones
      let loudest = 0;
      for (let i = 0; i < BARS; i++) loudest = Math.max(loudest, cur[i] ?? 0);
      peak = Math.max(0.25, loudest, peak * 0.997);
      const norm = 1 / peak;
      let bars = Array.from(cur, (v) => Math.min(1, v * norm));
      // smooth along the frequency axis: the original's edge is a gentle swell, not a jagged skyline
      for (let pass = 0; pass < 2; pass++) {
        const prev = bars;
        bars = prev.map((v, i) => ((prev[i - 1] ?? v) + v * 2 + (prev[i + 1] ?? v)) / 4);
      }
      let bass = 0;
      for (let i = 0; i < 6; i++) bass += bars[i] ?? 0;
      bass /= 6;
      for (const v of bars) sum += v;
      const energy = sum / BARS;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        idle = false;
      }
      if (presence < 0.01) {
        if (!idle) g.clearRect(0, 0, canvas.width, canvas.height);
        idle = true;
        return;
      }
      idle = false;

      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      // dome outline: a broad bell, scaled by overall loudness, with the spectrum rippling along the top
      const top: number[] = [];
      for (let i = 0; i < COLS; i++) {
        const x = (i / (COLS - 1)) * 2 - 1;
        // broad bell that eases all the way down to zero at both ends, so the glow melts into the window edge
        // wide, elliptical dome
        const bell = Math.pow(Math.max(0, 1 - x * x), 0.62);
        const f = (i / (COLS - 1)) * (BARS - 1);
        const a = Math.floor(f);
        const v = (bars[a] ?? 0) + ((bars[Math.min(BARS - 1, a + 1)] ?? 0) - (bars[a] ?? 0)) * (f - a);
        // the whole dome heaves with the bass / overall energy, and its edge ripples with each band
        const level = 0.42 + 0.45 * bass + 0.25 * energy;
        top.push(h * 0.82 * Math.min(1, bell * level * (0.72 + 0.5 * v) * presence));
      }

      const pad = w * 0.05;
      const core = mix(accent, [255, 255, 255], 0.1);
      const cw = (w - pad * 2) / (COLS - 1);
      // One thin vertical strip per column, each fading to nothing at ITS OWN top: the upper edge of the dome is a
      // soft feather (as in the original), never a drawn outline. The two blurred passes melt the strips together.
      const strips = (): void => {
        for (let i = 0; i < COLS - 1; i++) {
          const t = Math.max(top[i] ?? 0, top[i + 1] ?? 0);
          if (t < 1) continue;
          const grad = g.createLinearGradient(0, h, 0, h - t);
          grad.addColorStop(0, rgba(core, 0.78));
          grad.addColorStop(0.3, rgba(accent, 0.46));
          grad.addColorStop(0.65, rgba(accent, 0.14));
          grad.addColorStop(1, rgba(accent, 0));
          g.fillStyle = grad;
          g.fillRect(pad + i * cw - 0.5, h - t, cw + 1, t + 40);
        }
      };
      g.globalCompositeOperation = 'lighter';
      g.filter = 'blur(10px)';
      g.globalAlpha = 0.45;
      strips();
      g.filter = 'blur(4px)';
      g.globalAlpha = 0.65;
      strips();
      g.filter = 'none';
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} class="np-viz" aria-hidden="true" />;
}
