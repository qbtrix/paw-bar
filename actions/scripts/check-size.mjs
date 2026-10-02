// actions/scripts/check-size.mjs — fail when dist/actions.js gzips above its
// budget. The page-actions script runs in the customer's document beside the
// loader, so it gets the same treatment: a hard ceiling, not a target. Run
// after `node actions/build.mjs`.

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 2048;

const raw = readFileSync(new URL('../dist/actions.js', import.meta.url));
const size = gzipSync(raw, { level: 9 }).byteLength;

console.log(
  `actions.js gzipped: ${size.toLocaleString()} bytes (budget ${BUDGET_BYTES.toLocaleString()})`,
);
if (size > BUDGET_BYTES) {
  console.error(`❌ actions.js exceeds budget by ${(size - BUDGET_BYTES).toLocaleString()} bytes`);
  process.exit(1);
}
console.log('✅ actions.js within budget');
