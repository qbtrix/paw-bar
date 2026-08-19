// tests/theming.spec.ts — the white-label scale is actually re-skinnable.
// Created 2026-08-19.
//
// THE BUG THIS EXISTS FOR: tokens.css told owners that a lighter widget was one
// override away — "an owner who wants a lighter surface overrides
// --pawbar-surface — the white-label path, which is real and tested". It was
// not. Every foreground and hairline was hard-coded to white at some alpha, and
// thirteen component rules painted literal `oklch(1 0 0 / n)` washes on top. A
// light surface and nothing else gave white text on a white panel: no cards, no
// articles, no composer. Screenshotted, following the file's own instructions.
//
// The fix routes every foreground, line and wash through --pawbar-ink. That is
// a CLASS of mistake, not one instance — the next person to reach for a quick
// `oklch(1 0 0 / 0.05)` hover state re-breaks it silently, and it stays
// invisible because the shipped palette is the dark one where white looks
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
  // A scrim guaranteeing contrast for hero type over an OWNER'S PHOTOGRAPH. It
  // has to stay dark whichever way the rest of the widget is skinned, because
  // the thing underneath it is an arbitrary image, not a themed surface.
  'components/tabs/HomeTab.svelte': 'hero-wash scrim over owner artwork',
  // The palette itself: these are the values everything else derives FROM.
  'styles/tokens.css': 'the base scale',
};

interface Source {
  rel: string;
  text: string;
}

const files: Source[] = Object.entries(SOURCES).map(([path, text]) => ({
  rel: path.replace(/^\.\.\/src\//, ''),
  text,
}));

const tokens = (): string => files.find((f) => f.rel === 'styles/tokens.css')!.text;

const declaration = (name: string): string | undefined =>
  tokens()
    .split('\n')
    .find((line) => line.trim().startsWith(`${name}:`));

describe('white-label scale', () => {
  it('found the sources it is meant to be checking', () => {
    // NOT DECORATION. Vitest disables CSS processing by default, and under it
    // every stylesheet reads as an EMPTY STRING through `?raw`, `?inline` and a
    // plain import alike — while the glob keys still resolve. The scans below
    // would all have passed against nothing at all. `css: true` in vite.config
    // is what fixes it; this is what notices if it ever goes away.
    expect(files.length).toBeGreaterThan(10);
    expect(files.map((f) => f.rel)).toContain('styles/tokens.css');
    expect(files.map((f) => f.rel)).toContain('components/TabBar.svelte');

    const empty = files.filter((f) => f.text.trim().length < 50).map((f) => f.rel);
    expect(empty, 'every source read has real content').toEqual([]);
  });

  it('no component invents an absolute black or white', () => {
    const offenders = files
      .filter((f) => !(f.rel in ALLOWED))
      .filter((f) => ABSOLUTE.test(f.text))
      .map((f) => f.rel);

    // Every one of these goes invisible the moment an owner sets a light
    // surface. Reach for --pawbar-wash / --pawbar-wash-strong / --pawbar-border,
    // or add an entry to ALLOWED above WITH the reason it must be absolute.
    expect(offenders).toEqual([]);
  });

  it('every foreground, line and wash derives from --pawbar-ink', () => {
    const derived = [
      '--pawbar-fg',
      '--pawbar-fg-muted',
      '--pawbar-fg-subtle',
      '--pawbar-wash',
      '--pawbar-wash-strong',
      '--pawbar-border',
      '--pawbar-border-strong',
      '--pawbar-nav-fg',
      '--pawbar-nav-fg-active',
      '--pawbar-assistant-bubble',
    ];
    for (const name of derived) {
      const line = declaration(name);
      expect(line, `${name} is declared`).toBeTruthy();
      // One input decides light vs dark. A literal here is the whole bug.
      expect(line, `${name} derives from ink`).toContain('var(--pawbar-ink)');
    }
  });

  it('--pawbar-ink is always a literal colour, never derived', () => {
    const decls = tokens()
      .split('\n')
      .filter((line) => line.trim().startsWith('--pawbar-ink:'));
    // One per palette: the dark default, and the light block.
    expect(decls.length).toBeGreaterThanOrEqual(1);
    // It is the ROOT of the derivation. An ink referencing another token would
    // make the whole scale circular.
    for (const d of decls) expect(d).not.toContain('var(');
  });

  it('the light palette sets every ground it needs to', () => {
    // A PARTIAL light block is the white-on-white bug in a new place: miss the
    // ink and the type stays light on a light panel, miss a surface and one
    // slab stays dark. Five is the whole palette — see the header in tokens.css.
    const block = tokens().match(/\[data-pawbar-scheme='light'\]\s*\{([\s\S]*?)\}/);
    expect(block, 'the light block exists').toBeTruthy();
    for (const name of [
      '--pawbar-ink',
      '--pawbar-surface',
      '--pawbar-surface-strong',
      '--pawbar-surface-raised',
      '--pawbar-surface-sunken',
    ]) {
      expect(block![1], `light sets ${name}`).toContain(`${name}:`);
    }
  });

  it('the nav follows the surface scale rather than restating a colour', () => {
    // The nav track and the active pill are the two places a light re-skin used
    // to leave a dark slab behind, because both named their own oklch.
    expect(declaration('--pawbar-nav-track')).toContain('var(--pawbar-surface');
    expect(declaration('--pawbar-nav-active-bg')).toContain('var(--pawbar-surface');
  });

  it('ships no elevation shadow tokens', () => {
    // Removed 2026-08-19 (captain direction), and the measurement agreed: a
    // pixel diff over both a white and a near-black host page put every changed
    // pixel inside the panel's own box — a 2px rim, i.e. a second border on
    // elements that already have one — and it carried the "must fit inside the
    // 12px gutter or the frame clips it into a grey rectangle" hazard.
    const declared = tokens()
      .split('\n')
      .filter((line) => /^\s*--pawbar-shadow(-sm)?:/.test(line));
    expect(declared).toEqual([]);

    const users = files.filter((f) => /var\(--pawbar-shadow/.test(f.text)).map((f) => f.rel);
    expect(users).toEqual([]);
  });

  it('keeps the box-shadows that are not elevation', () => {
    // A blanket "remove the shadows" would have taken these with it: the focus
    // rings, and the ring that cuts the unread badge out of the glyph behind
    // it. Both are box-shadows; neither is elevation.
    const composer = files.find((f) => f.rel === 'components/Composer.svelte')!.text;
    const shell = files.find((f) => f.rel === 'components/GlassShell.svelte')!.text;
    const tabbar = files.find((f) => f.rel === 'components/TabBar.svelte')!.text;

    expect(composer).toMatch(/:focus-within[\s\S]{0,240}box-shadow/);
    expect(shell).toMatch(/:focus-within[\s\S]{0,360}box-shadow/);
    expect(tabbar).toMatch(/box-shadow:\s*0 0 0 2px var\(--pawbar-nav-track\)/);
  });
});
