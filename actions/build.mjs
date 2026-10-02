// actions/build.mjs — build the page-actions host script (actions/src/actions.ts)
// into dist/actions.js (minified IIFE, what a site includes) and
// dist/actions.readable.js (same bundle unminified, the copy pocketpaw vendors
// and serves at /paw-bar/actions.js). Prints raw and gzipped size. Mirrors
// loader/build.mjs; the jsdom tests read dist/actions.js, the shipped file.

import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not url.pathname: the latter breaks on Windows (/D:/...).
const here = fileURLToPath(new URL('.', import.meta.url));

mkdirSync(here + 'dist', { recursive: true });

const common = {
  entryPoints: [here + 'src/actions.ts'],
  bundle: true,
  sourcemap: false,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  legalComments: 'none',
};
await build({ ...common, outfile: here + 'dist/actions.js', minify: true });
await build({ ...common, outfile: here + 'dist/actions.readable.js', minify: false });

const raw = readFileSync(here + 'dist/actions.js');
const gz = gzipSync(raw, { level: 9 });
console.log(`actions.js           ${raw.byteLength.toLocaleString()} bytes raw`);
console.log(`actions.js.gz        ${gz.byteLength.toLocaleString()} bytes gzipped`);
