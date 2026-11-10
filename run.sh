#!/usr/bin/env bash
# Builds Bring Back Zune and launches it (Linux).
# Usage:  ./run.sh            install deps if needed, build, run
#         ./run.sh --clean    reinstall dependencies first
#         ./run.sh --no-sandbox   pass through to Electron (needed on some distros / containers)
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

clean=0
electron_args=()
for arg in "$@"; do
  case "$arg" in
    --clean) clean=1 ;;
    *) electron_args+=("$arg") ;;
  esac
done

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required (https://nodejs.org)." >&2
  exit 1
fi

if [ "$clean" -eq 1 ] && [ -d node_modules ]; then
  echo "Removing node_modules..."
  rm -rf node_modules
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

# A failed Electron postinstall leaves node_modules without the binary
# (no path.txt); repair it instead of failing at launch.
if [ ! -f node_modules/electron/path.txt ]; then
  echo "Electron binary missing; downloading..."
  node node_modules/electron/install.js || true
  # On very new Node versions install.js can exit 0 without extracting the
  # (already downloaded) zip; extract it from the cache ourselves.
  if [ ! -f node_modules/electron/path.txt ]; then
    zip="$(ls -t "${electron_config_cache:-$HOME/.cache/electron}"/*/electron-v*-linux-*.zip 2>/dev/null | head -1 || true)"
    if [ -n "$zip" ] && command -v unzip >/dev/null 2>&1; then
      unzip -q -o "$zip" -d node_modules/electron/dist
      printf electron > node_modules/electron/path.txt
    else
      echo "Could not install Electron. Try: ./run.sh --clean (or use Node 22 LTS)." >&2
      exit 1
    fi
  fi
fi

# Prefer native Wayland when available (unless the user chose a platform).
if [ "${XDG_SESSION_TYPE:-}" = "wayland" ] && [[ " ${electron_args[*]:-} " != *"--ozone-platform"* ]]; then
  electron_args+=(--ozone-platform-hint=auto)
fi

echo "Building..."
npm run build

echo "Starting..."
exec npx electron . "${electron_args[@]}"
