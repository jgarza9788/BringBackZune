import { contextBridge, ipcRenderer } from 'electron';

/** The only surface the renderer can reach. Mirrored by `Bridge` in src/renderer/bridge.ts. */
contextBridge.exposeInMainWorld('bbz', {
  platform: process.platform,
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (s: unknown) => ipcRenderer.invoke('settings:save', s),
  http: (url: string, req?: unknown) => ipcRenderer.invoke('http:request', url, req),
  setMini: (on: boolean) => ipcRenderer.invoke('win:mini', on),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
  close: () => ipcRenderer.invoke('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  onMaximized: (cb: (maximized: boolean) => void) => {
    ipcRenderer.on('win:maximized', (_e, v: unknown) => cb(v === true));
  },
});
