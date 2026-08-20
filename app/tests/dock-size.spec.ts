// tests/dock-size.spec.ts — the docked box can always grow.
// Created 2026-08-19.
//
// THE BUG THIS EXISTS FOR: the docked widget is a feedback loop — the loader
// sizes the iframe from what the app reports, and the app is laid out inside
// that iframe. `.pawbar-content` carried `max-height: 100%` and a default
// `flex-shrink: 1`, both resolving against a root that IS the frame. So a
// composer growing to a second line was clamped straight back to the frame's
// current height; the ResizeObserver measured the clamped box, reported the old
// height, and the frame never grew again. Measured in the browser harness: bar
// 98px, observed box 53px, frame 77px, permanently. The captain saw it as their
// own input being cut off.
//
// The CSS is fixed. This pins the other half: reporting the SCROLL EXTENT as
// well as the laid-out box, so a future constraint above the observed element
// cannot close the loop again. jsdom has no layout, which is exactly why the
// function takes plain numbers — a test that faked a layout would be testing
// the fake.

import { describe, it, expect } from 'vitest';
import { dockSize } from '../src/lib/dock-size';

const PAD = 24; // the root's 12px gutter, both sides

describe('dockSize', () => {
  it('adds the gutter to an unconstrained box', () => {
    expect(
      dockSize({ rect: { width: 360, height: 53 }, scrollWidth: 360, scrollHeight: 53 }, PAD),
    ).toEqual({ w: 384, h: 77 });
  });

  it('reports what the content WANTS when the box has been clamped', () => {
    // The exact numbers measured in the harness while the bug was live.
    expect(
      dockSize({ rect: { width: 360, height: 53 }, scrollWidth: 360, scrollHeight: 98 }, PAD),
    ).toEqual({ w: 384, h: 122 });
  });

  it('does not shrink a box whose scroll extent is smaller', () => {
    // A scroller at rest reports scrollHeight === clientHeight, and a flex
    // child can legitimately be taller than its scroll extent. Taking the max
    // rather than preferring one source keeps both cases correct.
    expect(
      dockSize({ rect: { width: 400, height: 700 }, scrollWidth: 400, scrollHeight: 200 }, PAD),
    ).toEqual({ w: 424, h: 724 });
  });

  it('handles a clamp on the width the same way', () => {
    expect(
      dockSize({ rect: { width: 148, height: 53 }, scrollWidth: 360, scrollHeight: 53 }, PAD),
    ).toEqual({ w: 384, h: 77 });
  });

  it('never reports a negative or non-finite box', () => {
    // A detached or mid-teardown element measures 0 or NaN. The loader would
    // have to defend itself against a negative box; it should never see one.
    expect(
      dockSize({ rect: { width: NaN, height: NaN }, scrollWidth: 0, scrollHeight: 0 }, PAD),
    ).toEqual({ w: 24, h: 24 });
    expect(
      dockSize({ rect: { width: -5, height: -5 }, scrollWidth: -5, scrollHeight: -5 }, PAD),
    ).toEqual({ w: 24, h: 24 });
  });
});
