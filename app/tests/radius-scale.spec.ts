// tests/radius-scale.spec.ts — the radius setting actually reaches the widget.
// Created 2026-08-22.
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
// the rule — every corner comes from the scale — rather than counting today's
// offenders.
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

const tokens = (): string => files.find((f) => f.rel === 'styles/tokens.css')!.text;

/** Every `border-radius: <literal>` outside the token scale itself. */
function literals(text: string): string[] {
  return [...text.matchAll(/border-radius:\s*([^;]+);/g)]
    .map((m) => m[1].trim())
    .filter((v) => !v.startsWith('var(--pawbar-radius'));
}

// A corner that is not a style choice. 50% is a circle because the thing is a
// circle — an avatar, a status dot, a mascot ring — and squaring those off at
// radius 0 turns a notification dot into a notification square. `3px` is the
// stop glyph inside the send button: an icon, drawn at icon scale, not chrome.
const NOT_A_SETTING = new Set(['50%', '3px']);

describe('radius scale', () => {
  it('found the sources it is meant to be checking', () => {
    // Same trap as theming.spec.ts: without `css: true` in vite.config every
    // stylesheet reads as an empty string through ?raw while the glob keys
    // still resolve, and every scan below would pass against nothing.
    expect(files.length).toBeGreaterThan(10);
    expect(files.map((f) => f.rel)).toContain('styles/tokens.css');
    // Read real bytes, not an empty string: tokens.css must carry the scale,
    // and some component must actually consume it.
    expect(tokens()).toContain('--pawbar-radius:');
    expect(files.some((f) => /border-radius:\s*var\(--pawbar-radius/.test(f.text))).toBe(true);
  });

  it('no component hard-codes a corner', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.rel === 'styles/tokens.css') continue;
      for (const value of literals(f.text)) {
        if (!NOT_A_SETTING.has(value)) offenders.push(`${f.rel}: ${value}`);
      }
    }
    // Reach for a step on the ladder — --pawbar-radius-lg / -md / -sm / -xs /
    // -2xs / -bubble / -pill / -input — or add the value to NOT_A_SETTING above
    // WITH the reason it is a shape rather than a setting.
    expect(offenders).toEqual([]);
  });

  it('every step derives from the one owner input', () => {
    // The ladder is the reason one slider can reshape the whole widget
    // coherently. A step that names its own px is a step that stops following.
    for (const step of ['-lg', '-md', '-sm', '-xs', '-2xs', '-bubble']) {
      const line = tokens()
        .split('\n')
        .find((l) => l.trim().startsWith(`--pawbar-radius${step}:`));
      expect(line, `--pawbar-radius${step} is declared`).toBeTruthy();
      expect(line, `--pawbar-radius${step} derives`).toContain('var(--pawbar-radius)');
    }
  });

  it('the input bar follows the radius setting too', () => {
    // "the radius only affects everything except the main input bar" was the
    // captain describing the BUG, not asking for the exception. An input that
    // stays a pill while the panel around it goes square is the most visible
    // way the setting looks broken. So it follows — on its own step, because a
    // ~46px-tall bar reads differently from a card, but never independently of
    // the slider.
    const input = tokens()
      .split('\n')
      .find((l) => l.trim().startsWith('--pawbar-radius-input:'));
    expect(input, '--pawbar-radius-input is declared').toBeTruthy();
    expect(input, 'the input radius follows the slider').toContain('var(--pawbar-radius)');

    // And the two elements that ARE the input bar use it: the docked pill and
    // the composer's own form. If either drifts back onto --pawbar-radius, an
    // owner shaping their cards squares off their text field as a side effect.
    const shell = files.find((f) => f.rel === 'components/GlassShell.svelte')!.text;
    const composer = files.find((f) => f.rel === 'components/Composer.svelte')!.text;
    expect(shell).toContain('border-radius: var(--pawbar-radius-input);');
    expect(composer).toContain('border-radius: var(--pawbar-radius-input);');
  });

  it('the pill step is a constant, not a derivation', () => {
    // Count badges, avatars rings and scrollbar thumbs are pills because of
    // what they are. At radius 0 they must stay pills.
    const pill = tokens()
      .split('\n')
      .find((l) => l.trim().startsWith('--pawbar-radius-pill:'));
    expect(pill).toBeTruthy();
    expect(pill).not.toContain('var(--pawbar-radius)');
  });
});
