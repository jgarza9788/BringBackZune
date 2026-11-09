// Bundles main + preload (Node/CJS) and the renderer (browser IIFE) into dist/.
import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--check');
await rm('dist', { recursive: true, force: true });
await mkdir('dist/renderer', { recursive: true });

await build({
  entryPoints: { main: 'src/main/main.ts', preload: 'src/main/preload.ts' },
  outdir: 'dist/main',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
});

await build({
  entryPoints: { app: 'src/renderer/main.tsx' },
  outdir: 'dist/renderer',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.woff2': 'file', '.woff': 'file' },
  assetNames: 'assets/[name]-[hash]',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
});

// Node-side bundle of the core library, used by scripts/probe.mjs.
await build({
  entryPoints: { core: 'src/core/index.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  target: 'node20',
  logLevel: 'warning',
});

await copyFile('src/renderer/index.html', 'dist/renderer/index.html');
console.log('build ok');
