import { DEFAULT_SETTINGS, type Http, type Settings, type SourceConfig } from '../core';

/** What the preload script exposes (see src/main/preload.ts). */
export interface Bridge {
  platform: string;
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<Settings>;
  http: Http;
  setMini(on: boolean): Promise<void>;
}

declare global {
  interface Window {
    bbz?: Bridge;
  }
}

export const isElectron = typeof window !== 'undefined' && !!window.bbz;

const DEMO_CONFIG: SourceConfig = { id: 'demo', kind: 'demo', name: 'Demo library', url: 'demo://local', username: 'demo' };

/**
 * In Electron this is the real IPC bridge. In a plain browser (used for design screenshots and
 * quick UI iteration) it falls back to in-memory settings seeded with the offline demo library.
 */
export function getBridge(): Bridge {
  if (window.bbz) return window.bbz;
  let mem: Settings = { ...DEFAULT_SETTINGS, sources: [DEMO_CONFIG], activeSourceId: 'demo' };
  return {
    platform: 'browser',
    loadSettings: async () => mem,
    saveSettings: async (s) => (mem = s),
    http: async () => {
      throw new Error('Network access needs the desktop app');
    },
    setMini: async () => {},
  };
}

export { DEMO_CONFIG };
