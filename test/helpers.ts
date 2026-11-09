import type { Http, HttpRequest, SourceConfig } from '../src/core/types';

export interface Call {
  url: URL;
  req?: HttpRequest;
}

/** Route table keyed by "METHOD /path"; value is JSON body or a full response. */
type RouteFn = (u: URL, req?: HttpRequest) => unknown;

export function mockHttp(
  routes: Record<string, RouteFn | object>,
): { http: Http; calls: Call[] } {
  const calls: Call[] = [];
  const http: Http = async (url, req) => {
    const u = new URL(url);
    calls.push({ url: u, req });
    const key = `${req?.method ?? 'GET'} ${u.pathname}`;
    const route = routes[key];
    if (route === undefined) return { status: 404, text: 'not found' };
    const val = typeof route === 'function' ? route(u, req) : route;
    if (val && typeof val === 'object' && '__status' in (val as object)) {
      const r = val as { __status: number; body?: unknown };
      return { status: r.__status, text: JSON.stringify(r.body ?? {}) };
    }
    return { status: 200, text: JSON.stringify(val) };
  };
  return { http, calls };
}

export const jfConfig = (over: Partial<SourceConfig> = {}): SourceConfig => ({
  id: 'jf1',
  kind: 'jellyfin',
  name: 'Jellyfin',
  url: 'https://jf.example.com/',
  username: 'justin',
  token: 'TOKEN',
  userId: 'USER',
  ...over,
});

export const ndConfig = (over: Partial<SourceConfig> = {}): SourceConfig => ({
  id: 'nd1',
  kind: 'navidrome',
  name: 'Navidrome',
  url: 'https://nd.example.com',
  username: 'justin',
  ...over,
});
