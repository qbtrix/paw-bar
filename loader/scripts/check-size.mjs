// loader/scripts/check-size.mjs — Fail the build when dist/loader.js gzips above
// 2KB. Created 2026-07-15 (A2): the loader is the one script a foreign site
// pastes in, so it must stay tiny (mirrors the frozen widget's own size gate,
// just a tighter budget). Run after `node loader/build.mjs`.

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 2 * 1024;

const path = new URL('../dist/loader.js', import.meta.url);
const raw = readFileSync(path);
const gz = gzipSync(raw, { level: 9 });
const size = gz.byteLength;

console.log(
  `loader.js gzipped: ${size.toLocaleString()} bytes (budget ${BUDGET_BYTES.toLocaleString()})`,
);
if (size > BUDGET_BYTES) {
  console.error(`❌ Loader exceeds budget by ${(size - BUDGET_BYTES).toLocaleString()} bytes`);
  process.exit(1);
}
console.log('✅ Loader within budget');
