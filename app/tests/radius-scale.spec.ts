// tests/radius-scale.spec.ts — the radius setting actually reaches the widget.
// Created 2026-08-22.
// 2026-09-27: a corner counts as following the setting when it DERIVES from
// --pawbar-radius, not only when it starts with it — components/bar/ rounds
// the pill with min(var(--pawbar-radius), height / 2) and the frame with
// calc(var(--pawbar-radius) + padding), both of which move with the slider.
// `inherit` joins NOT_A_SETTING for the same reason: it follows its parent.
// 2026-09-27 (old shell removed): tokens.css and its --pawbar-radius-* ladder
// are gone, so the tests that read the ladder, and the one that checked the
// old shell's input bar and Composer, went with them. The tree-wide rule
// stays: no component hard-codes a corner. The sanity check now looks for any
// border-radius that uses the setting, wrapped in min()/calc() or not.
//
// THE BUG THIS EXISTS FOR: --pawbar-radius was a real, validated, persisted,
// slider-driven owner setting that reached SEVEN of roughly sixty corners. The
// panel followed it, four cards followed it, a couple of list rows followed it,
// and every other border-radius in the widget was a hard-coded literal. So an
// owner who dragged the slider to 0 got a sharp panel full of round cards,
// round rows, round buttons and round bubbles, and reasonably concluded the
// customization did not work. It did. It just did almost nothing.
//
// That is a CLASS of mistake, not one instance: the next component to be
// written reaches for `border-radius: 12px` because that is what CSS looks
// like, and the setting silently covers a little less of the widget than it did
// before. Nothing goes red, because there was nothing watching. So these guard
// the rule — every corner comes from the setting — rather than counting
// today's offenders.
import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob('../src/**/*.{svelte,css}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const files = Object.entries(SOURCES).map(([path, text]) => ({
  rel: path.replace(/^\.\.\/src\//, ''),
  text,
}));

/** Every `border-radius: <literal>` that does not use the setting. */
function literals(text: string): string[] {
  return [...text.matchAll(/border-radius:\s*([^;]+);/g)]
    .map((m) => m[1].trim())
    .filter((v) => !v.includes('var(--pawbar-radius'));
}

// A corner that is not a style choice. 50% is a circle because the thing is a
// circle — an avatar, a status dot, a mascot ring — and squaring those off at
// radius 0 turns a notification dot into a notification square. `3px` is the
// stop glyph inside the send button: an icon, drawn at icon scale, not chrome.
// `inherit` takes the parent's corner, which itself follows the setting — the
// icon launcher's button copies the surface it fills (components/bar/).
const NOT_A_SETTING = new Set(['50%', '3px', 'inherit']);

describe('radius scale', () => {
  it('found the sources it is meant to be checking', () => {
    // Same trap as theming.spec.ts: without `css: true` in vite.config every
    // stylesheet reads as an empty string through ?raw while the glob keys
    // still resolve, and every scan below would pass against nothing.
    expect(files.map((f) => f.rel)).toContain('components/bar/PawBar.svelte');
    // Read real bytes, not an empty string: some component must actually
    // consume the setting.
    expect(files.some((f) => /border-radius:[^;]*var\(--pawbar-radius/.test(f.text))).toBe(true);
  });

  it('no component hard-codes a corner', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const value of literals(f.text)) {
        if (!NOT_A_SETTING.has(value)) offenders.push(`${f.rel}: ${value}`);
      }
    }
    // Derive the corner from var(--pawbar-radius, <default>), or add the value
    // to NOT_A_SETTING above WITH the reason it is a shape rather than a
    // setting.
    expect(offenders).toEqual([]);
  });
});
