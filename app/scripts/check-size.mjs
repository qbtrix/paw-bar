// scripts/check-size.mjs — Fail the build if dist/pawbar.js gzips above 80KB.
// Created 2026-07-15 (A3 glass bar). First-paint budget from the A3 spec: the
// concierge main chunk (Svelte + marked + dompurify + app) must stay ≤80KB gz
// so the iframe paints fast. Models the frozen widget's scripts/check-size.mjs.
// Also reports the CSS size for visibility (not budgeted here).

import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 80 * 1024;
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
