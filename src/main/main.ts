import { app, BrowserWindow, ipcMain, net, session, shell, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import path from 'node:path';
import type { HttpRequest, HttpResponse } from '../core';
import type { Settings } from '../core';
import { SettingsStore } from './settings';

// Hardware media keys + MPRIS (Linux) / SMTC (Windows) via Chromium's media session.
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService');

let win: BrowserWindow | null = null;
let store: SettingsStore;
let savedBounds: Rectangle | null = null;
let wasMaximized = false;
/** Hosts the user explicitly allowed to use self-signed certificates. */
const selfSignedHosts = new Set<string>();

function refreshSelfSigned(settings: Settings): void {
  selfSignedHosts.clear();
  for (const s of settings.sources) {
    if (!s.allowSelfSigned) continue;
    try {
      selfSignedHosts.add(new URL(s.url).hostname);
    } catch {
      /* ignore malformed url */
    }
  }
}

const MAX_RESPONSE_CHARS = 64 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/** Only our own bundled page may talk to the privileged IPC handlers. */
function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return !!win && e.sender === win.webContents && url.startsWith('file://') && url.includes('/renderer/index.html');
}

/** Header names/values must be plain strings; drops anything else the renderer might send. */
function cleanHeaders(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h || typeof h !== 'object') return out;
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
    if (typeof v === 'string' && /^[A-Za-z0-9-]+$/.test(k) && !/[\r\n]/.test(v)) out[k] = v;
  }
  return out;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#000000',
    // No OS title bar or border: the app draws its own minimize / maximize / close buttons.
    frame: false,
    title: 'Bring Back Zune',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Lets the visualizer's AudioContext run when a track resumes or advances without a click.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.removeMenu();
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Never navigate away from the app; open external links in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-redirect', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.on('maximize', () => win?.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('win:maximized', false));
  win.on('closed', () => (win = null));
}

function registerIpc(): void {
  // Every handler refuses callers that are not our own bundled page.
  const handle = <A extends unknown[], R>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => R | Promise<R>): void => {
    ipcMain.handle(channel, (e, ...args) => {
      if (!isTrustedSender(e)) throw new Error('Untrusted IPC sender');
      return fn(e, ...(args as A));
    });
  };

  handle('settings:load', async () => {
    const s = await store.load();
    refreshSelfSigned(s);
    return s;
  });

  handle('settings:save', async (_e, settings: unknown) => {
    const s = await store.save(settings);
    refreshSelfSigned(s);
    return s;
  });

  // Renderer pages are file:// so cross-origin fetches would hit CORS; the main process fetches instead.
  handle('http:request', async (_e, url: unknown, req: unknown): Promise<HttpResponse> => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are allowed');
    const r = (req ?? {}) as HttpRequest;
    const method = r.method === 'POST' || r.method === 'DELETE' ? r.method : 'GET';
    const body = method === 'POST' && typeof r.body === 'string' ? r.body : undefined;
    let headers = cleanHeaders(r.headers);
    let target = url;
    // Follow redirects by hand so credentials (Authorization, X-Emby-Token) never leak to another origin.
    for (let hop = 0; ; hop++) {
      const res = await net.fetch(target, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (loc) {
        if (hop >= MAX_REDIRECTS) throw new Error('Too many redirects');
        const next = new URL(loc, target);
        if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new Error('Redirect to a non-http(s) URL blocked');
        if (next.origin !== new URL(target).origin) headers = {};
        target = next.href;
        continue;
      }
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > MAX_RESPONSE_CHARS) throw new Error('Response too large');
      const text = await res.text();
      if (text.length > MAX_RESPONSE_CHARS) throw new Error('Response too large');
      return { status: res.status, text };
    }
  });

  handle('win:minimize', () => win?.minimize());
  handle('win:toggleMaximize', () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  handle('win:close', () => win?.close());
  handle('win:isMaximized', () => win?.isMaximized() ?? false);

  handle('win:mini', (_e, on: unknown) => {
    if (!win) return;
    if (on) {
      wasMaximized = win.isMaximized();
      savedBounds = win.getNormalBounds();
      if (wasMaximized) win.unmaximize();
      win.setMinimumSize(280, 440);
      win.setSize(300, 470);
      win.setAlwaysOnTop(true);
      win.setResizable(false);
    } else {
      win.setResizable(true);
      win.setAlwaysOnTop(false);
      win.setMinimumSize(900, 600);
      if (savedBounds) win.setBounds(savedBounds);
      if (wasMaximized) win.maximize();
    }
  });
}

void app.whenReady().then(() => {
  store = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  // Honour per-source "allow self-signed" (homelab servers); everything else uses normal verification.
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(selfSignedHosts.has(request.hostname) ? 0 : -3);
  });
  // The visualizer reads the audio through Web Audio, which silences media that is not CORS-readable.
  // Most media servers send no CORS headers, so allow our own page to read media responses.
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    if (details.resourceType !== 'media') return callback({});
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (k.toLowerCase() === 'access-control-allow-origin') delete headers[k];
    headers['Access-Control-Allow-Origin'] = ['*'];
    callback({ responseHeaders: headers });
  });
  // The player needs no device permissions (camera, mic, geolocation, notifications ...).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
