// scripts/build-manifest.ts — write pawbar-manifest.json, the document the
// agent reads to learn what the Paw Bar can draw. Created 2026-09-27.
// Run with `bun run manifest` after changing src/lib/spec-manifest.ts, and
// commit the result; tests/spec-widgets.spec.svelte.ts fails while the
// committed file is stale. Output is stable (no timestamp) so the diff shows
// only real changes.

import { writeFileSync } from 'node:fs';
import { buildPawBarManifest } from '../src/lib/spec-manifest';

const out = new URL('../pawbar-manifest.json', import.meta.url);
const manifest = buildPawBarManifest();
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
console.log(`wrote pawbar-manifest.json (${manifest.widgets.length} widgets, ${Object.keys(manifest.actions).length} actions)`);
