// tests/spec-renderer-imports.spec.ts — keeps the spec renderer small by
// construction. Created 2026-09-27.
//
// The renderer is worth having only while it pulls in nothing but Ripple's
// headless engine. One convenience import from the root of @ripple-ui/core
// would bring in the zod schema, and one import of app code would tie the
// renderer to the bar. Every other test would stay green. So this walks the
// real import graph from SpecRenderer.svelte and allows only `svelte`,
// `svelte/*`, `@ripple-ui/core/headless`, and files inside
// src/components/spec/. Type-only imports count too.

import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob(['../src/components/spec/**/*.ts', '../src/components/spec/**/*.svelte'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const ROOT = '../src/components/spec/';
const ENTRY = `${ROOT}SpecRenderer.svelte`;

// Multi-line aware: `[^;]*?` so `import {\n a,\n b\n} from '...'` is seen.
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^;]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersOf(source: string): string[] {
  const out: string[] = [];
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) out.push(m[1] ?? m[2]);
  }
  return out;
}

function resolveLocal(from: string, spec: string): string | undefined {
  if (!spec.startsWith('./')) return undefined; // `../` leaves the folder
  const dir = from.slice(0, from.lastIndexOf('/') + 1);
  const joined = dir + spec.slice(2);
  return [joined, joined.replace(/\.js$/, '.ts'), `${joined}.ts`].find((c) => c in SOURCES);
}

function isAllowedExternal(spec: string): boolean {
  return spec === 'svelte' || spec.startsWith('svelte/') || spec === '@ripple-ui/core/headless';
}

function crawl(): { reached: string[]; offenders: string[] } {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const queue = [ENTRY];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of specifiersOf(SOURCES[file] ?? '')) {
      if (spec.startsWith('.')) {
        const target = resolveLocal(file, spec);
        if (target) queue.push(target);
        else offenders.push(`${file} -> ${spec}`);
      } else if (!isAllowedExternal(spec)) {
        offenders.push(`${file} -> ${spec}`);
      }
    }
  }
  return { reached: [...seen], offenders };
}

describe('spec renderer imports', () => {
  it('reaches only svelte, the headless engine and its own folder', () => {
    expect(crawl().offenders).toEqual([]);
  });

  it('actually walks the renderer, so an empty result means something', () => {
    expect(crawl().reached).toEqual(
      expect.arrayContaining([ENTRY, `${ROOT}SpecNode.svelte`, `${ROOT}style.ts`, `${ROOT}types.ts`]),
    );
  });

  it('would flag the core root, a schema import and app code', () => {
    expect(isAllowedExternal('@ripple-ui/core')).toBe(false);
    expect(isAllowedExternal('@ripple-ui/core/schema')).toBe(false);
    expect(resolveLocal(ENTRY, '../../lib/cards')).toBeUndefined();
  });
});
