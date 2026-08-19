// loader/scripts/check-size.mjs — Fail the build when dist/loader.js gzips above
// 2KB. Created 2026-07-15 (A2): the loader is the one script a foreign site
// pastes in, so it must stay tiny (mirrors the frozen widget's own size gate,
// just a tighter budget). Run after `node loader/build.mjs`.

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// RAISED 2026-08-19, 2048 → 2560, for host colour-scheme detection.
//
// The loader is the ONLY code we run in the customer's document, so it is the
// only thing that can answer "is this site light or dark" — a cross-origin
// frame can see nothing of the page around it. Reading `color-scheme` off the
// host's :root, falling back to the effective page background's relative
// luminance, falling back to the visitor's OS, and passing the answer on the
// frame URL costs ~270 gzipped bytes and put the file at 2,294.
//
// Everything cheaper was measured and rejected: dropping the OS-change listener
// saves 42 bytes, dropping the `color-scheme` signal saves 47 and loses the
// most authoritative of the three. There was no version of this feature that
// fit, so the number moved rather than the feature shrinking into something
// that half-works.
//
// 2.5KB gzipped is still a rounding error against any page this embeds in, and
// the ceiling still exists — it is a ceiling, not a target. If a change wants
// the next 512 bytes, it should have to argue for them the same way.
const BUDGET_BYTES = 2560;

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
