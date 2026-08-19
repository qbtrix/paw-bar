// dock-size.ts — What size the docked widget reports to the loader.
// Created 2026-08-19.
//
// WHY THIS IS A FUNCTION AND NOT TWO LINES IN AN EFFECT: the docked box is a
// feedback loop. The loader sizes the iframe from what the app reports, and the
// app is laid out inside that iframe — so anything that lets the frame's
// current size influence the MEASUREMENT closes the loop and the box can never
// grow again.
//
// That is not hypothetical. `.pawbar-content` carried `max-height: 100%` and a
// default `flex-shrink: 1`, both resolving against a root that IS the frame. A
// composer growing to two lines was clamped straight back to the frame's
// current height; the ResizeObserver measured the clamped box, reported the old
// height, and the frame stayed put — permanently. Measured in the harness: bar
// 98px, observed box 53px, frame 77px, and it never recovered. The visitor saw
// their own input cut off.
//
// The CSS that caused it is fixed. This exists so the next constraint someone
// adds above the observed element cannot re-create the deadlock: the scroll
// extent is the content's TRUE size whether or not the box was clamped, so
// reporting the larger of the two always describes what the app actually wants
// to draw. Worst case the frame is briefly a few pixels too large, which is
// invisible; the failure it replaces is content the visitor cannot see.

/** The parts of an observed element this needs. Structural so it unit-tests
 *  against plain objects — jsdom has no layout, and a test that had to fake one
 *  would be testing the fake. */
export interface DockBox {
  /** The laid-out box (ResizeObserver contentRect, or getBoundingClientRect). */
  rect: { width: number; height: number };
  /** The content's real extent, unaffected by a cap on the box itself. */
  scrollWidth: number;
  scrollHeight: number;
}

export interface DockSize {
  w: number;
  h: number;
}

/**
 * The box to ask the loader for, in frame pixels.
 *
 * @param box  the observed element's laid-out box and scroll extent
 * @param pad  the root's gutter, both sides (the shadow has to fit inside it)
 */
export function dockSize(box: DockBox, pad: number): DockSize {
  const width = Math.max(nonNegative(box.rect.width), nonNegative(box.scrollWidth));
  const height = Math.max(nonNegative(box.rect.height), nonNegative(box.scrollHeight));
  return { w: width + pad, h: height + pad };
}

/** A detached or not-yet-laid-out element reports 0, and some browsers report
 *  NaN mid-teardown. Either way the answer is "nothing to add", never a
 *  negative box the loader would have to defend itself against. */
function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}
