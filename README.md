# Bring Back Zune

A Zune-software-style (Metro) desktop music player that streams from **Jellyfin** and **Navidrome**. Runs on **Windows and Linux** (Electron + TypeScript + Preact).

## Run

One command that installs (first time), builds and launches:

```powershell
.
un.ps1             # Windows (PowerShell); add -Clean to reinstall dependencies
```
```bash
./run.sh              # Linux; add --clean to reinstall, other flags go to Electron (e.g. --no-sandbox)
```

Or by hand:

```bash
npm install
npm start          # builds and launches
```

Windows installer / portable exe: run `npm run dist:win` **on Windows**. Linux AppImage + deb: `npm run dist:linux`. Output goes to `release/`.

First launch: open **sources**, add a Jellyfin or Navidrome server, or click *add demo library* to explore offline.

## What's in it

| Zune feature | Here |
|---|---|
| Quickplay start screen | Now Playing tile, 6 Pins, 5 Smart DJ slots, History, New |
| Collection | Artists (A–Z jump bar), Albums (sort by name/artist/recent), Playlists, Songs |
| Now Playing | Full-bleed wall of album covers in mixed sizes (1x / 3x / 4x), tinted with the accent colour and slowly drifting around the colour wheel. Cover + bold caps artist / album / title bottom-left, the queue bottom-right (playing track highlighted, click to jump), an art-only full-screen mode (`Esc` to leave). Header and control bar float over the wall; the nav links appear when the pointer is at the top |
| Control bar | Compact: small cover, thin progress line with elapsed / remaining time, transport and volume on the right, and an accent-coloured glow that rises from the bottom edge and ripples with the music while something plays |
| Smart DJ | Seed from any artist/album/track, or from your likes; server recommender first, then top tracks, then random. Artists you keep skipping sink to the end of the mix and eventually drop out (kept per artist, on this computer only; Settings has a "forget" button) |
| Mixview | An artist in the middle with related artists and their albums around them. Click a related artist to move there; the trail on top steps you back. Open it from an artist page, an album page or Now Playing |
| Likes | The heart next to any song likes it on the server (Jellyfin favourite / Subsonic star). The **liked** tab lists them |
| Playlists | Create from the Now Playing queue, or from any song's playlist button. On a playlist page, **add songs** pulls from your likes, a search or the queue (click the plus or drag the row onto the list) |
| Classic layout | Settings > collection layout: artists, albums and songs side by side, like the original software |
| Light theme | Settings > theme: dark, light or follow the system. The player bar and Now Playing stay dark |
| Change cover | On an album, artist or playlist page: use your own image. Stays on this computer; the server is not touched |
| Mini player | Compact always-on-top window |
| Metro design | Black canvas, light typography, flat tiles, one accent colour, turnstile/rise motion |
| Media keys / MPRIS / Windows media overlay | Via Chromium's Media Session |

Keyboard: `Space` play/pause, `Ctrl+←/→` previous/next, `Esc` leaves the mini player and the full-screen Now Playing mode, or closes the add-to-playlist menu.

The accent colour (Settings) drives the pink-by-default highlights, the glow and the Now Playing tint.

## Servers

- **Jellyfin**: signs in with `/Users/AuthenticateByName`, stores the access token only. Streams the original file (`/Audio/{id}/stream?static=true`); formats Chromium can't play (e.g. WMA) are transcoded to MP3 by the server.
- **Navidrome** (any Subsonic 1.16.1 server): token auth (`md5(password+salt)`); the password is never stored. Recommendations (similar artists / Smart DJ) need the server to have an agent such as Last.fm configured; otherwise the app falls back to top/random tracks.
- **Self-signed certificates**: tick the checkbox when adding the server. It only trusts that one host.
- Settings live in the OS user-data folder as `settings.json` (owner-only permissions on Linux/macOS).

## Privacy

- The app talks **only to the servers you add**. No account, no analytics, no telemetry, nothing sent anywhere else, and no lookups to third-party services (the app has none to call).
- Your password is used once to sign in and is never stored; only an access token (Jellyfin) or a salted hash (Navidrome, as the Subsonic API defines) is kept, in a file readable only by you.
- Related artists and recommendations come from your own server. If that server has Last.fm or similar configured, that is the server's doing.
- Replaced covers and what Smart DJ has learned from your skips live in `settings.json` on this computer.

## Checking your own server

```bash
npm run probe -- jellyfin  http://host:8096 user pass
npm run probe -- navidrome http://host:4533 user pass
```

Runs every call the app makes (browse, search, mixes, stream, cover art) and prints PASS/FAIL per step. Please run this first if something looks empty in the app.

## Development

```bash
npm run check      # typecheck + unit tests + headless-Chrome UI smoke test
npm run screenshots   # renders every screen of the offline demo to ./screenshots
```

```
src/core      source-agnostic logic: Jellyfin + Subsonic clients, queue, Quickplay, Smart DJ, demo library
src/main      Electron main process: window, settings store, CORS-free HTTP bridge, cert allow-list
src/renderer  Preact UI (state.ts = player + library state, views-*.tsx, styles.css)
test          vitest unit tests (clients run against mocked HTTP)
scripts       build, screenshots, smoke test, server probe
```

Security model: `contextIsolation`, `sandbox`, no Node in the renderer, strict CSP, the renderer can only reach the network through the main process's http(s)-only bridge.

## Status / known gaps

- Verified here: typecheck, unit tests, and UI checks and screenshots in headless Chrome against the demo library. The demo library's covers are generated letter tiles, so the Now Playing cover wall (real artwork only) shows a plain accent wash there; try it with a real server.
- **Not yet verified against live servers or the packaged Electron shell** (the build sandbox couldn't reach NuGet/Electron binaries or run a Navidrome server). Run `npm run probe` and `npm start` on your machine.
- Creating playlists, adding songs, liked songs and the likes mix are covered by unit tests against mocked Jellyfin and Subsonic responses and by UI checks on the demo library, but **not yet run against live servers**. Playlists made through Subsonic's `createPlaylist` / `updatePlaylist` and Jellyfin's `/Playlists` are the calls to watch with `npm run probe`.
- Mixview needs the server to know related artists (Jellyfin: its own similar-artist data; Navidrome: Last.fm or similar); with none, the ring shows only that artist's albums.
- Smart DJ "learning" is per artist, from skips. It does not analyse the audio (tempo, loudness): a server stream gives us no such data.
- Not changeable: song titles (only covers can be replaced locally).
- Not implemented: ratings, scrobbling / play-count reporting, offline cache, lyrics, gapless playback.

## Roadmap (inspired by the original Zune software)

- Quickplay as horizontally panning panes (neighbouring pane titles peeking in), with the Smart DJ row sliding up.
- A Genres tab and a column chooser on the songs table.
- Pick the collection layout and theme on first launch (today: Settings).

## Naming / assets

This is an independent, unofficial fan project, not affiliated with or endorsed by Microsoft. It uses no Microsoft assets: Segoe UI is used only if already installed on Windows (Inter is bundled as the fallback). Zune is a trademark of Microsoft Corporation. "Zune" is a Microsoft trademark, so pick a different name before distributing publicly.
