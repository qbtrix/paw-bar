// loader/build.mjs — Produce the Paw Bar glass-bar loader bundle.
// Created 2026-07-15 (A2): zero-dependency esbuild setup targeting evergreen
// browsers (ES2020). Minified IIFE so a foreign site can `<script src="…">` the
// loader without touching its own bundler. Reports raw + gzipped size; the
// jsdom unit test loads dist/loader.js directly (the exact shipped IIFE).

import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// fileURLToPath, NOT url.pathname: on Windows the latter yields a path with a
// leading slash (/D:/repo/...), and Node resolves that slash against the
// current drive, so every path here doubled the drive letter and the build
// died in mkdir. This script had therefore never run on Windows — which also
// meant the loader's own test suite could not run, since it reads the bundle
// this produces.
const here = fileURLToPath(new URL('.', import.meta.url));

mkdirSync(here + 'dist', { recursive: true });

await build({
  entryPoints: [here + 'src/loader.ts'],
  outfile: here + 'dist/loader.js',
  bundle: true,
  minify: true,
  sourcemap: false,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  legalComments: 'none',
});

const raw = readFileSync(here + 'dist/loader.js');
const gz = gzipSync(raw, { level: 9 });
console.log(`loader.js            ${raw.byteLength.toLocaleString()} bytes raw`);
console.log(`loader.js.gz         ${gz.byteLength.toLocaleString()} bytes gzipped`);
