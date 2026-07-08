// scripts/check-size.mjs — Fail the build when dist/widget.js gzips above 10KB.
// Created: 2026-04-13 — Contract from PAW-BAR-MVP.md: the bundle stays small
// enough that embedders don't hesitate to drop it in. 10KB gzipped matches the
// planning doc target.

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 10 * 1024;

const raw = readFileSync('dist/widget.js');
const gz = gzipSync(raw, { level: 9 });
const size = gz.byteLength;

console.log(`widget.js gzipped: ${size.toLocaleString()} bytes (budget ${BUDGET_BYTES.toLocaleString()})`);
if (size > BUDGET_BYTES) {
  console.error(`❌ Bundle exceeds budget by ${(size - BUDGET_BYTES).toLocaleString()} bytes`);
  process.exit(1);
}
console.log('✅ Bundle within budget');
