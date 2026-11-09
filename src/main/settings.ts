import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sanitizeSettings, type Settings } from '../core/settings';

export { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '../core/settings';

export class SettingsStore {
  constructor(private readonly file: string) {}

  async load(): Promise<Settings> {
    try {
      return sanitizeSettings(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch {
      return sanitizeSettings(null);
    }
  }

  /** Atomic write (temp + rename) with owner-only permissions: the file holds access tokens. */
  async save(settings: unknown): Promise<Settings> {
    const clean = sanitizeSettings(settings);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(clean, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
    return clean;
  }
}
