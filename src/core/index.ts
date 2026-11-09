import { DemoSource } from './demo';
import { JellyfinSource } from './jellyfin';
import { SubsonicSource } from './subsonic';
import type { Http, MusicSource, SourceConfig } from './types';

export * from './types';
export * from './util';
export * from './queue';
export * from './quickplay';
export * from './discovery';
export * from './settings';
export { md5 } from './md5';
export { DemoSource } from './demo';
export { JellyfinSource } from './jellyfin';
export { SubsonicSource } from './subsonic';

export function createSource(config: SourceConfig, http: Http): MusicSource {
  switch (config.kind) {
    case 'jellyfin':
      return new JellyfinSource(config, http);
    case 'navidrome':
      return new SubsonicSource(config, http);
    case 'demo':
      return new DemoSource(config.id);
  }
}
