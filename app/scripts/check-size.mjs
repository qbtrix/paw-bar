// scripts/check-size.mjs — Fail the build if dist/pawbar.js gzips above 83KB.
// The frame paints from this one file, so its gzipped size is the bar's
// first-paint budget. The CSS size is reported for visibility, not budgeted.
// The budget grows only for real visitor-facing work: 80KB until the
// full-page chat (#45) and site-theme detection (#42), 82KB until the Move map
// (#49) and the tool confirm card's description and args (#50) landed together.
// A lazy chunk for preview-only code is not an option while the backend loads
// pawbar.js as a classic script (no import.meta for chunk URLs).

import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 83 * 1024;
const JS = 'dist/pawbar.js';
const CSS = 'dist/pawbar.css';

if (!existsSync(JS)) {
  console.error(`❌ ${JS} not found — run \`bun run build\` first`);
  process.exit(1);
}

const js = gzipSync(readFileSync(JS), { level: 9 }).byteLength;
console.log(`pawbar.js  gzipped: ${js.toLocaleString()} bytes (budget ${BUDGET_BYTES.toLocaleString()})`);

if (existsSync(CSS)) {
  const css = gzipSync(readFileSync(CSS), { level: 9 }).byteLength;
  console.log(`pawbar.css gzipped: ${css.toLocaleString()} bytes (not budgeted)`);
}

if (js > BUDGET_BYTES) {
  console.error(`❌ main chunk exceeds budget by ${(js - BUDGET_BYTES).toLocaleString()} bytes`);
  process.exit(1);
}
console.log('✅ main chunk within budget');
