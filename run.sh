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

echo "Building..."
npm run build

echo "Starting..."
exec npx electron . "${electron_args[@]}"
