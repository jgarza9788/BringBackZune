// Tiling window-manager support for the mini player.
//
// Electron's setSize / setAlwaysOnTop do nothing useful while a tiling compositor (Hyprland, niri,
// sway, i3) keeps the window tiled, so on those we ask the WM over its own IPC to float, size,
// place and pin the window. Everywhere else (Windows, GNOME, KDE, ...) this is a no-op and the
// plain Electron calls in main.ts do the job.
import { execFile } from 'node:child_process';

export type WmKind = 'hyprland' | 'niri' | 'sway' | 'i3';

export function detectWm(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): WmKind | null {
  if (platform !== 'linux') return null;
  if (env.HYPRLAND_INSTANCE_SIGNATURE) return 'hyprland';
  if (env.NIRI_SOCKET) return 'niri';
  if (env.SWAYSOCK) return 'sway';
  if (env.I3SOCK || /(^|:)i3($|:)/i.test(env.XDG_CURRENT_DESKTOP ?? '')) return 'i3';
  return null;
}

/** Runs a command (no shell) and resolves with stdout; rejects on failure. */
export type Runner = (cmd: string, args: string[]) => Promise<string>;

export const execRunner: Runner = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 2000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

export interface MiniTarget {
  /** Process id of the Electron main process (the Wayland / X11 client). */
  pid: number;
  /** X11 window id (needed by i3, which has no pid criterion). */
  xid?: number;
  width: number;
  height: number;
  margin: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WmController {
  enterMini(t: MiniTarget): Promise<void>;
  exitMini(t: MiniTarget): Promise<void>;
}

/** Top-left position that puts a w×h window in the bottom-right corner of `area`. */
export function bottomRight(area: Rect, w: number, h: number, margin: number): { x: number; y: number } {
  return {
    x: Math.round(area.x + area.width - w - margin),
    y: Math.round(area.y + area.height - h - margin),
  };
}

interface HyprMonitor {
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
  transform?: number;
  /** [left, top, right, bottom] in logical px. */
  reserved?: number[];
  focused?: boolean;
}

/** Usable logical area of a Hyprland monitor (width/height are physical pixels). */
export function hyprWorkArea(m: HyprMonitor): Rect {
  const scale = m.scale && m.scale > 0 ? m.scale : 1;
  const rotated = (m.transform ?? 0) % 2 === 1;
  const w = (rotated ? m.height : m.width) / scale;
  const h = (rotated ? m.width : m.height) / scale;
  const [l = 0, t = 0, r = 0, b = 0] = m.reserved ?? [];
  return { x: m.x + l, y: m.y + t, width: w - l - r, height: h - t - b };
}

/**
 * One Hyprland dispatch in both syntaxes: Hyprland >= 0.55 uses Lua (`hl.dsp.*`), older releases the
 * classic `dispatcher args` form. Which one works is probed on first use.
 */
export interface HyprCmd {
  lua: string;
  legacy: string;
}

const hyprWin = (pid: number): string => `window = 'pid:${pid}'`;

export const hypr = {
  float: (pid: number, on: boolean): HyprCmd => ({
    lua: `hl.dsp.window.float({ action = '${on ? 'on' : 'off'}', ${hyprWin(pid)} })`,
    legacy: `${on ? 'setfloating' : 'settiled'} pid:${pid}`,
  }),
  resize: (pid: number, w: number, h: number): HyprCmd => ({
    lua: `hl.dsp.window.resize({ x = ${w}, y = ${h}, ${hyprWin(pid)} })`,
    legacy: `resizewindowpixel exact ${w} ${h},pid:${pid}`,
  }),
  move: (pid: number, x: number, y: number): HyprCmd => ({
    lua: `hl.dsp.window.move({ x = ${x}, y = ${y}, ${hyprWin(pid)} })`,
    legacy: `movewindowpixel exact ${x} ${y},pid:${pid}`,
  }),
  /** Legacy `pin` toggles, so callers only send it when the state actually needs to flip. */
  pin: (pid: number, on: boolean): HyprCmd => ({
    lua: `hl.dsp.window.pin({ action = '${on ? 'on' : 'off'}', ${hyprWin(pid)} })`,
    legacy: `pin pid:${pid}`,
  }),
};

export type HyprSyntax = 'lua' | 'legacy';

export function hyprBatch(cmds: HyprCmd[], syntax: HyprSyntax): string {
  return cmds.map((c) => `dispatch ${c[syntax]}`).join(' ; ');
}

/** hyprctl exits 0 even on failure; success is every reply line reading "ok". */
export function hyprOk(out: string): boolean {
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => l === 'ok');
}

/** sway / i3 command string (criteria + comma-separated commands). */
export function swayEnterCmd(criteria: string, w: number, h: number, pos: { x: number; y: number } | null): string {
  const cmds = ['floating enable', `resize set ${w} px ${h} px`];
  if (pos) cmds.push(`move absolute position ${pos.x} px ${pos.y} px`);
  cmds.push('sticky enable');
  return `${criteria} ${cmds.join(', ')}`;
}

const parse = <T>(s: string): T => JSON.parse(s) as T;

const noop: WmController = { enterMini: async () => {}, exitMini: async () => {} };

export function createWmController(kind: WmKind | null, run: Runner = execRunner, log: (msg: string) => void = console.warn): WmController {
  if (!kind) return noop;
  const impl = kind === 'hyprland' ? hyprland(run) : kind === 'niri' ? niri(run) : sway(run, kind);
  // A missing binary or an IPC change must never break mini mode itself.
  const guard =
    (fn: (t: MiniTarget) => Promise<void>) =>
    async (t: MiniTarget): Promise<void> => {
      try {
        await fn(t);
      } catch (e) {
        log(`[wm:${kind}] ${e instanceof Error ? e.message : String(e)}`);
      }
    };
  return { enterMini: guard(impl.enterMini), exitMini: guard(impl.exitMini) };
}

function hyprland(run: Runner): WmController {
  let syntax: HyprSyntax | null = null;
  let changed = false;
  let wasFloating = false;
  let pinned = false;
  /** Previous floating geometry, restored on exit (Electron can't position windows on Wayland). */
  let prev: { at: number[]; size: number[] } | null = null;

  const dispatch = async (cmds: HyprCmd[]): Promise<void> => {
    if (!cmds.length) return;
    const tryWith = async (s: HyprSyntax): Promise<string | null> => {
      const out = await run('hyprctl', ['--batch', hyprBatch(cmds, s)]);
      return hyprOk(out) ? null : out.trim();
    };
    if (syntax) {
      const err = await tryWith(syntax);
      if (err) throw new Error(err);
      return;
    }
    const luaErr = await tryWith('lua');
    if (!luaErr) return void (syntax = 'lua');
    const legacyErr = await tryWith('legacy');
    if (!legacyErr) return void (syntax = 'legacy');
    throw new Error(`lua: ${luaErr} | legacy: ${legacyErr}`);
  };

  return {
    async enterMini(t) {
      const clients = parse<Array<{ pid: number; floating: boolean; pinned: boolean; at?: number[]; size?: number[] }>>(
        await run('hyprctl', ['-j', 'clients']),
      );
      const me = clients.find((c) => c.pid === t.pid);
      if (!me) throw new Error(`no window for pid ${t.pid}`);
      const monitors = parse<HyprMonitor[]>(await run('hyprctl', ['-j', 'monitors']));
      const mon = monitors.find((m) => m.focused) ?? monitors[0];
      wasFloating = me.floating;
      prev = me.floating && me.at?.length === 2 && me.size?.length === 2 ? { at: me.at, size: me.size } : null;
      pinned = !me.pinned; // only pin (and later unpin) if it isn't pinned already
      const cmds = [hypr.float(t.pid, true), hypr.resize(t.pid, t.width, t.height)];
      if (mon) {
        const p = bottomRight(hyprWorkArea(mon), t.width, t.height, t.margin);
        cmds.push(hypr.move(t.pid, p.x, p.y));
      }
      if (pinned) cmds.push(hypr.pin(t.pid, true));
      changed = true;
      await dispatch(cmds);
    },
    async exitMini(t) {
      if (!changed) return;
      changed = false;
      const cmds: HyprCmd[] = [];
      if (pinned) cmds.push(hypr.pin(t.pid, false));
      if (!wasFloating) cmds.push(hypr.float(t.pid, false));
      else if (prev) {
        const [w = 0, h = 0] = prev.size;
        const [x = 0, y = 0] = prev.at;
        cmds.push(hypr.resize(t.pid, w, h), hypr.move(t.pid, x, y));
      }
      await dispatch(cmds);
    },
  };
}

function niri(run: Runner): WmController {
  let id: number | null = null;
  let wasFloating = false;
  const act = (...args: string[]) => run('niri', ['msg', 'action', ...args]);
  return {
    async enterMini(t) {
      const windows = parse<Array<{ id: number; pid: number | null; is_floating: boolean }>>(await run('niri', ['msg', '--json', 'windows']));
      const me = windows.find((w) => w.pid === t.pid);
      if (!me) throw new Error(`no window for pid ${t.pid}`);
      id = me.id;
      wasFloating = me.is_floating;
      const sid = String(me.id);
      await act('move-window-to-floating', '--id', sid);
      await act('set-window-width', '--id', sid, String(t.width));
      await act('set-window-height', '--id', sid, String(t.height));
      // Floating positions are relative to the output's working area, in logical px.
      const out = parse<{ logical?: { width: number; height: number } } | null>(await run('niri', ['msg', '--json', 'focused-output']));
      if (out?.logical) {
        const p = bottomRight({ x: 0, y: 0, ...out.logical }, t.width, t.height, t.margin);
        await act('move-floating-window', '--id', sid, '-x', String(Math.max(0, p.x)), '-y', String(Math.max(0, p.y)));
      }
      // niri has no "pin to all workspaces"; floating is as close as it gets.
    },
    async exitMini() {
      if (id === null) return;
      const sid = String(id);
      id = null;
      if (!wasFloating) await act('move-window-to-tiling', '--id', sid);
    },
  };
}

interface SwayNode {
  pid?: number;
  window?: number | null;
  type?: string;
  floating?: string;
  rect?: Rect;
  nodes?: SwayNode[];
  floating_nodes?: SwayNode[];
}

export function findSwayNode(n: SwayNode, match: (n: SwayNode) => boolean, floating = false): { node: SwayNode; floating: boolean } | null {
  if (match(n)) return { node: n, floating: floating || n.type === 'floating_con' || n.floating === 'user_on' || n.floating === 'auto_on' };
  for (const c of n.nodes ?? []) {
    const r = findSwayNode(c, match, floating);
    if (r) return r;
  }
  for (const c of n.floating_nodes ?? []) {
    const r = findSwayNode(c, match, true);
    if (r) return r;
  }
  return null;
}

function sway(run: Runner, kind: 'sway' | 'i3'): WmController {
  const bin = kind === 'sway' ? 'swaymsg' : 'i3-msg';
  let changed = false;
  let wasFloating = false;
  const criteria = (t: MiniTarget): string => {
    if (kind === 'sway') return `[pid=${t.pid}]`;
    if (!t.xid) throw new Error('no X11 window id');
    return `[id=${t.xid}]`;
  };
  return {
    async enterMini(t) {
      const crit = criteria(t);
      const tree = parse<SwayNode>(await run(bin, ['-t', 'get_tree']));
      const found = findSwayNode(tree, (n) => (kind === 'sway' ? n.pid === t.pid && n.type !== 'root' && n.type !== 'output' && n.type !== 'workspace' : n.window === t.xid));
      wasFloating = found?.floating ?? false;
      let area: Rect | null = null;
      if (kind === 'sway') {
        const outs = parse<Array<{ focused?: boolean; rect: Rect }>>(await run(bin, ['-t', 'get_outputs']));
        area = (outs.find((o) => o.focused) ?? outs[0])?.rect ?? null;
      } else {
        const wss = parse<Array<{ focused?: boolean; rect: Rect }>>(await run(bin, ['-t', 'get_workspaces']));
        area = (wss.find((w) => w.focused) ?? wss[0])?.rect ?? null;
      }
      const pos = area ? bottomRight(area, t.width, t.height, t.margin) : null;
      await run(bin, [swayEnterCmd(crit, t.width, t.height, pos)]);
      changed = true;
    },
    async exitMini(t) {
      if (!changed) return;
      changed = false;
      const cmds = ['sticky disable'];
      if (!wasFloating) cmds.push('floating disable');
      await run(bin, [`${criteria(t)} ${cmds.join(', ')}`]);
    },
  };
}
