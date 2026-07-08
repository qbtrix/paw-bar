// build.mjs — Produce the Paw Bar widget bundle.
// Renamed 2026-07-08 to Paw Bar (bundle/product rename; rename-only).
// Created: 2026-04-13 — Zero-dependency esbuild setup targeting evergreen
// browsers (ES2020). Minified IIFE output so embedders can `<script src="…">`
// without touching their own bundler. Sourcemap emitted for debugging.

import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/widget.js',
  bundle: true,
  minify: true,
  sourcemap: true,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  legalComments: 'none',
  metafile: false,
  define: {
    __BUILD_VERSION__: JSON.stringify(process.env.WIDGET_VERSION || '0.1.0'),
  },
});

const raw = readFileSync('dist/widget.js');
const gz = gzipSync(raw, { level: 9 });
console.log(`widget.js            ${raw.byteLength.toLocaleString()} bytes raw`);
console.log(`widget.js.gz         ${gz.byteLength.toLocaleString()} bytes gzipped`);

// Mirror the built bundle into the Playwright fixture directory so the static
// server can serve both /widget.js and /index.html from a single root.
try {
  mkdirSync('tests/fixtures', { recursive: true });
  copyFileSync('dist/widget.js', 'tests/fixtures/widget.js');
} catch (err) {
  console.warn('Failed to copy widget.js into tests/fixtures:', err);
}
