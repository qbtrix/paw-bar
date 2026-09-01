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
//
// RAISED 2026-09-01, 2560 -> 3072, for the blurred host-page scrim. Arguing for
// it the way the note above asks:
//
// Same reasoning as the colour-scheme raise, and it is not a coincidence — both
// features exist because the loader is the ONLY code we run in the customer's
// document. A cross-origin frame cannot blur the page around it, cannot dim it,
// and cannot take a click on it. Painting the backdrop from inside the frame
// means making the frame full-viewport, which is precisely the modal the
// 2026-08-19 work removed: `pointer-events` inside a frame cannot hand a click
// back to the document underneath, so that version swallows every click on the
// page. The host-document div is not the cheap way to do this; it is the only
// way that leaves the site usable.
//
// The scrim costs 324 gzipped bytes and put the file at 2,773. What was measured
// and rejected:
//   * CSS.supports() -> style-property detection: saved 25 bytes, kept.
//   * dropping the no-blur fallback dim: saves 21 bytes and makes the scrim
//     INVISIBLE wherever backdrop-filter is unsupported or switched off, which
//     leaves a 520px column floating over sharp live content. 21 bytes is not
//     worth a feature that silently does nothing on some browsers.
// Nothing else in it is optional: the element, its one listener, the open/close
// toggle and the teardown are the feature.
//
// Still a ceiling. The next change to want 512 bytes argues for them here too.
const BUDGET_BYTES = 3072;

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
