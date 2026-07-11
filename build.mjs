// build.mjs — Produce the Paw Bar widget bundle.
// Created: 2026-04-13 — Zero-dependency esbuild setup targeting evergreen
// browsers (ES2020). Minified IIFE output so embedders can `<script src="…">`
// without touching their own bundler. Sourcemap emitted for debugging.
// Changed 2026-07-11 (paw-bar hosting/versioning): additionally emits an
// immutable versioned artifact dist/widget-<WIDGET_VERSION>.js (+ .map) and
// prints SRI sha384 hashes for both artifacts so embed snippets can pin
// integrity.

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';

const WIDGET_VERSION = process.env.WIDGET_VERSION || '0.1.0';

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
    __BUILD_VERSION__: JSON.stringify(WIDGET_VERSION),
  },
});

// Immutable versioned artifact — lets embedders pin an exact release while
// dist/widget.js stays the moving "latest" pointer.
const versionedName = `widget-${WIDGET_VERSION}.js`;
copyFileSync('dist/widget.js', `dist/${versionedName}`);
copyFileSync('dist/widget.js.map', `dist/${versionedName}.map`);

const raw = readFileSync('dist/widget.js');
const gz = gzipSync(raw, { level: 9 });
const sri = `sha384-${createHash('sha384').update(raw).digest('base64')}`;

console.log(`widget.js            ${raw.byteLength.toLocaleString()} bytes raw`);
console.log(`widget.js.gz         ${gz.byteLength.toLocaleString()} bytes gzipped`);
console.log(`${versionedName.padEnd(20)} ${raw.byteLength.toLocaleString()} bytes raw (copy)`);
console.log(`SRI widget.js            ${sri}`);
console.log(`SRI ${versionedName.padEnd(20)} ${sri}`);

// Mirror the built bundle into the Playwright fixture directory so the static
// server can serve both /widget.js and /index.html from a single root.
try {
  mkdirSync('tests/fixtures', { recursive: true });
  copyFileSync('dist/widget.js', 'tests/fixtures/widget.js');
} catch (err) {
  console.warn('Failed to copy widget.js into tests/fixtures:', err);
}
