// tests/theming.spec.ts — the white-label scale is actually re-skinnable.
// Created 2026-08-19.
// 2026-09-27: components/bar/PawBar.svelte joins ALLOWED — its whites are
// var() fallbacks for the default theme, not colours forced past the owner.
// 2026-09-27 (old shell removed): tokens.css, TabBar, Composer and GlassShell
// are gone, and with them the tests that read the old --pawbar-ink scale and
// those components' focus rings. What stays is the tree-wide rule, which still
// guards the new bar: no component invents an absolute colour, and nothing
// uses an elevation shadow token.
//
// THE BUG THIS EXISTS FOR: the old stylesheet told owners that a lighter widget
// was one override away. It was not. Every foreground and hairline was
// hard-coded to white at some alpha, and thirteen component rules painted
// literal `oklch(1 0 0 / n)` washes on top. A light surface and nothing else
// gave white text on a white panel. Screenshotted, following the file's own
// instructions.
//
// That is a CLASS of mistake, not one instance — the next person to reach for a
// quick `oklch(1 0 0 / 0.05)` hover state re-breaks it silently, and it stays
// invisible because the default palette is the dark one where white looks
// right. So these guard the rule rather than the symptom, and they read the
// real sources rather than a fixture.

import { describe, it, expect } from 'vitest';

// Sources come through Vite's own glob rather than node:fs, for two reasons: it
// needs no @types/node (this is browser code and does not carry them), and the
// paths resolve at transform time so there is no cwd to get wrong on Windows.
const SOURCES = import.meta.glob('../src/**/*.{svelte,css}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Absolute black or white, at any alpha, in any colour syntax. */
const ABSOLUTE =
  /(oklch\(\s*[01]\s+0\s+0\s*[/)])|(#fff\b)|(#ffffff\b)|(#000\b)|(#000000\b)|(\brgba?\(\s*(255,\s*255,\s*255|0,\s*0,\s*0)\s*[,)])/i;

/** Where an absolute colour is the right answer, with the reason it is. */
const ALLOWED: Record<string, string> = {
  // The bar components (2026-09-27) have no shared stylesheet under them.
  // Every value there is a var(--pawbar-*, <default>) fallback, so a white
  // here is only the DEFAULT text on the default dark accent, and any site
  // that sets --pawbar-accent-fg replaces it.
  'components/bar/PawBar.svelte': 'default-theme fallback inside var()',
};

interface Source {
  rel: string;
  text: string;
}

const files: Source[] = Object.entries(SOURCES).map(([path, text]) => ({
  rel: path.replace(/^\.\.\/src\//, ''),
  text,
}));

describe('white-label scale', () => {
  it('found the sources it is meant to be checking', () => {
    // NOT DECORATION. Vitest disables CSS processing by default, and under it
    // every stylesheet reads as an EMPTY STRING through `?raw`, `?inline` and a
    // plain import alike — while the glob keys still resolve. The scans below
    // would all have passed against nothing at all. `css: true` in vite.config
    // is what fixes it; this is what notices if it ever goes away.
    expect(files.map((f) => f.rel)).toContain('components/bar/PawBar.svelte');
    expect(files.map((f) => f.rel)).toContain('components/bar/PawBarFrame.svelte');

    const empty = files.filter((f) => f.text.trim().length < 50).map((f) => f.rel);
    expect(empty, 'every source read has real content').toEqual([]);
  });

  it('no component invents an absolute black or white', () => {
    const offenders = files
      .filter((f) => !(f.rel in ALLOWED))
      .filter((f) => ABSOLUTE.test(f.text))
      .map((f) => f.rel);

    // Every one of these goes invisible the moment an owner sets a light
    // surface. Reach for a var(--pawbar-*, <default>) value, or add an entry to
    // ALLOWED above WITH the reason it must be absolute.
    expect(offenders).toEqual([]);
  });

  it('uses no elevation shadow tokens', () => {
    // Removed 2026-08-19 (captain direction), and the measurement agreed: a
    // pixel diff over both a white and a near-black host page put every changed
    // pixel inside the panel's own box — a 2px rim, i.e. a second border on
    // elements that already have one — and it carried the "must fit inside the
    // 12px gutter or the frame clips it into a grey rectangle" hazard.
    const users = files.filter((f) => /var\(--pawbar-shadow/.test(f.text)).map((f) => f.rel);
    expect(users).toEqual([]);
  });
});
