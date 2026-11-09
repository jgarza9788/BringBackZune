import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, SettingsStore } from '../src/main/settings';

describe('settings', () => {
  it('sanitizes garbage to defaults', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ sources: [1, { id: 'x', url: 'u', kind: 'evil' }], accent: 'red', volume: 9, repeat: 'x' });
    expect(s.sources).toEqual([]);
    expect(s.accent).toBe(DEFAULT_SETTINGS.accent);
    expect(s.volume).toBe(DEFAULT_SETTINGS.volume);
    expect(s.repeat).toBe('off');
  });

  it('keeps valid values', () => {
    const s = sanitizeSettings({
      sources: [{ id: 'a', kind: 'jellyfin', name: 'J', url: 'http://x', username: 'u', token: 't' }],
      activeSourceId: 'a',
      accent: '#1BA1E2',
      volume: 0.3,
      shuffle: true,
      repeat: 'all',
    });
    expect(s.sources).toHaveLength(1);
    expect(s).toMatchObject({ activeSourceId: 'a', accent: '#1BA1E2', volume: 0.3, shuffle: true, repeat: 'all' });
  });

  it('writes atomically with owner-only permissions and round-trips', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bbz-'));
    const file = path.join(dir, 'sub', 'settings.json');
    const store = new SettingsStore(file);
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
    await store.save({ ...DEFAULT_SETTINGS, accent: '#00ABA9' });
    expect((await store.load()).accent).toBe('#00ABA9');
    expect(JSON.parse(await readFile(file, 'utf8')).accent).toBe('#00ABA9');
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('recovers from a corrupt file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bbz-'));
    const file = path.join(dir, 'settings.json');
    await (await import('node:fs/promises')).writeFile(file, '{ not json');
    expect(await new SettingsStore(file).load()).toEqual(DEFAULT_SETTINGS);
  });
});
