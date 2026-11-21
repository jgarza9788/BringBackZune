import { describe, expect, it } from 'vitest';
import {
  bottomRight,
  createWmController,
  detectWm,
  findSwayNode,
  hyprWorkArea,
  type MiniTarget,
  type Runner,
} from '../src/main/wm';

const target: MiniTarget = { pid: 42, xid: 0x1234, width: 300, height: 470, margin: 16 };

function fakeRunner(responses: Record<string, string>): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = [cmd, ...args].join(' ');
    for (const [k, v] of Object.entries(responses)) if (key === k) return v;
    return '';
  };
  return { run, calls };
}

describe('detectWm', () => {
  it('detects each WM from its socket env var', () => {
    expect(detectWm({ HYPRLAND_INSTANCE_SIGNATURE: 'x' }, 'linux')).toBe('hyprland');
    expect(detectWm({ NIRI_SOCKET: '/run/niri.sock' }, 'linux')).toBe('niri');
    expect(detectWm({ SWAYSOCK: '/run/sway.sock' }, 'linux')).toBe('sway');
    expect(detectWm({ I3SOCK: '/run/i3' }, 'linux')).toBe('i3');
    expect(detectWm({ XDG_CURRENT_DESKTOP: 'i3' }, 'linux')).toBe('i3');
  });

  it('returns null for floating desktops and non-linux', () => {
    expect(detectWm({ XDG_CURRENT_DESKTOP: 'GNOME' }, 'linux')).toBeNull();
    expect(detectWm({ XDG_CURRENT_DESKTOP: 'KDE' }, 'linux')).toBeNull();
    expect(detectWm({ HYPRLAND_INSTANCE_SIGNATURE: 'x' }, 'win32')).toBeNull();
  });
});

describe('geometry', () => {
  it('computes the bottom-right corner', () => {
    expect(bottomRight({ x: 0, y: 0, width: 1920, height: 1080 }, 300, 470, 16)).toEqual({ x: 1604, y: 594 });
  });

  it('uses logical size and reserved areas on Hyprland', () => {
    const area = hyprWorkArea({ x: 0, y: 0, width: 3840, height: 2160, scale: 1.5, reserved: [0, 26, 0, 0] });
    expect(area).toEqual({ x: 0, y: 26, width: 2560, height: 1414 });
  });
});

describe('hyprland controller', () => {
  const monitors = JSON.stringify([{ x: 0, y: 0, width: 1920, height: 1080, scale: 1, reserved: [0, 0, 0, 0], focused: true }]);
  const clients = (floating: boolean, pinned: boolean) => JSON.stringify([{ pid: 42, floating, pinned }]);

  /** Fake hyprctl that only accepts one dispatch syntax. */
  function hyprRunner(syntax: 'lua' | 'legacy', floating = false, pinned = false) {
    const batches: string[] = [];
    const run: Runner = async (_cmd, args) => {
      if (args[1] === 'clients') return JSON.stringify([{ pid: 42, floating, pinned, at: [100, 200], size: [800, 600] }]);
      if (args[1] === 'monitors') return monitors;
      const batch = args[1] ?? '';
      batches.push(batch);
      const parts = batch.split(' ; ');
      const isLua = parts.every((p) => p.startsWith('dispatch hl.dsp.'));
      return parts.map(() => ((syntax === 'lua') === isLua ? 'ok' : 'error: invalid dispatcher')).join('\n\n');
    };
    return { run, batches };
  }

  it('floats, sizes, places and pins with the Lua API; then restores', async () => {
    const { run, batches } = hyprRunner('lua');
    const wm = createWmController('hyprland', run);
    await wm.enterMini(target);
    expect(batches).toEqual([
      "dispatch hl.dsp.window.float({ action = 'on', window = 'pid:42' }) ; " +
        "dispatch hl.dsp.window.resize({ x = 300, y = 470, window = 'pid:42' }) ; " +
        "dispatch hl.dsp.window.move({ x = 1604, y = 594, window = 'pid:42' }) ; " +
        "dispatch hl.dsp.window.pin({ action = 'on', window = 'pid:42' })",
    ]);
    await wm.exitMini(target);
    expect(batches.at(-1)).toBe(
      "dispatch hl.dsp.window.pin({ action = 'off', window = 'pid:42' }) ; dispatch hl.dsp.window.float({ action = 'off', window = 'pid:42' })",
    );
  });

  it('falls back to classic dispatchers on older Hyprland and remembers it', async () => {
    const { run, batches } = hyprRunner('legacy');
    const wm = createWmController('hyprland', run);
    await wm.enterMini(target);
    expect(batches).toHaveLength(2);
    expect(batches[1]).toBe(
      'dispatch setfloating pid:42 ; dispatch resizewindowpixel exact 300 470,pid:42 ; dispatch movewindowpixel exact 1604 594,pid:42 ; dispatch pin pid:42',
    );
    await wm.exitMini(target);
    expect(batches).toHaveLength(3);
    expect(batches[2]).toBe('dispatch pin pid:42 ; dispatch settiled pid:42');
  });

  it('leaves an already-floating, already-pinned window as it was', async () => {
    const { run, batches } = hyprRunner('lua', true, true);
    const wm = createWmController('hyprland', run);
    await wm.enterMini(target);
    expect(batches[0]).not.toContain('pin');
    await wm.exitMini(target);
    // stays floating and unpinned, but goes back to its old floating geometry
    expect(batches[1]).toBe(
      "dispatch hl.dsp.window.resize({ x = 800, y = 600, window = 'pid:42' }) ; dispatch hl.dsp.window.move({ x = 100, y = 200, window = 'pid:42' })",
    );
  });

  it('logs instead of throwing when hyprctl rejects both syntaxes', async () => {
    const logs: string[] = [];
    const run: Runner = async (_c, args) => (args[1] === 'clients' ? clients(false, false) : args[1] === 'monitors' ? monitors : 'error: nope');
    const wm = createWmController('hyprland', run, (m) => logs.push(m));
    await expect(wm.enterMini(target)).resolves.toBeUndefined();
    expect(logs[0]).toContain('error: nope');
  });

  it('never throws when the WM command fails', async () => {
    const logs: string[] = [];
    const wm = createWmController(
      'hyprland',
      async () => {
        throw new Error('hyprctl not found');
      },
      (m) => logs.push(m),
    );
    await expect(wm.enterMini(target)).resolves.toBeUndefined();
    await expect(wm.exitMini(target)).resolves.toBeUndefined();
    expect(logs[0]).toContain('hyprctl not found');
  });
});

describe('niri controller', () => {
  it('finds the window by pid and floats it', async () => {
    const { run, calls } = fakeRunner({
      'niri msg --json windows': JSON.stringify([
        { id: 1, pid: 7, is_floating: false },
        { id: 9, pid: 42, is_floating: false },
      ]),
      'niri msg --json focused-output': JSON.stringify({ logical: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } }),
    });
    const wm = createWmController('niri', run);
    await wm.enterMini(target);
    const actions = calls.filter((c) => c[2] === 'action').map((c) => c.slice(3).join(' '));
    expect(actions).toEqual([
      'move-window-to-floating --id 9',
      'set-window-width --id 9 300',
      'set-window-height --id 9 470',
      'move-floating-window --id 9 -x 1604 -y 594',
    ]);
    await wm.exitMini(target);
    expect(calls.at(-1)).toEqual(['niri', 'msg', 'action', 'move-window-to-tiling', '--id', '9']);
  });
});

describe('sway controller', () => {
  it('floats, sizes, places and makes sticky by pid', async () => {
    const tree = { type: 'root', nodes: [{ type: 'output', nodes: [{ type: 'workspace', nodes: [{ type: 'con', pid: 42 }] }] }] };
    const { run, calls } = fakeRunner({
      'swaymsg -t get_tree': JSON.stringify(tree),
      'swaymsg -t get_outputs': JSON.stringify([{ focused: true, rect: { x: 0, y: 0, width: 1920, height: 1080 } }]),
    });
    const wm = createWmController('sway', run);
    await wm.enterMini(target);
    expect(calls.at(-1)).toEqual([
      'swaymsg',
      '[pid=42] floating enable, resize set 300 px 470 px, move absolute position 1604 px 594 px, sticky enable',
    ]);
    await wm.exitMini(target);
    expect(calls.at(-1)).toEqual(['swaymsg', '[pid=42] sticky disable, floating disable']);
  });

  it('detects floating nodes in the tree', () => {
    const tree = { type: 'root', nodes: [{ type: 'workspace', floating_nodes: [{ type: 'floating_con', window: 5 }] }] };
    expect(findSwayNode(tree, (n) => n.window === 5)?.floating).toBe(true);
  });

  it('uses the X11 window id on i3', async () => {
    const { run, calls } = fakeRunner({ 'i3-msg -t get_tree': '{}', 'i3-msg -t get_workspaces': '[]' });
    const wm = createWmController('i3', run);
    await wm.enterMini(target);
    expect(calls.at(-1)?.[1]).toMatch(/^\[id=4660\] floating enable/);
  });
});
