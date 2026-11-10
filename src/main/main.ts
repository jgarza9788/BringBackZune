import { app, BrowserWindow, ipcMain, net, session, shell, type Rectangle } from 'electron';
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
  win.on('maximize', () => win?.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win?.webContents.send('win:maximized', false));
  win.on('closed', () => (win = null));
}

function registerIpc(): void {
  ipcMain.handle('settings:load', async () => {
    const s = await store.load();
    refreshSelfSigned(s);
    return s;
  });

  ipcMain.handle('settings:save', async (_e, settings: unknown) => {
    const s = await store.save(settings);
    refreshSelfSigned(s);
    return s;
  });

  // Renderer pages are file:// so cross-origin fetches would hit CORS; the main process fetches instead.
  ipcMain.handle('http:request', async (_e, url: unknown, req: unknown): Promise<HttpResponse> => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are allowed');
    const r = (req ?? {}) as HttpRequest;
    const res = await net.fetch(url, {
      method: r.method === 'POST' || r.method === 'DELETE' ? r.method : 'GET',
      headers: r.headers,
      body: r.method === 'POST' ? r.body : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    return { status: res.status, text: await res.text() };
  });

  ipcMain.handle('win:minimize', () => win?.minimize());
  ipcMain.handle('win:toggleMaximize', () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('win:close', () => win?.close());
  ipcMain.handle('win:isMaximized', () => win?.isMaximized() ?? false);

  ipcMain.handle('win:mini', (_e, on: unknown) => {
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
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
