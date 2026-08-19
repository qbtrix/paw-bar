// motion.ts — the ONE place that decides how long anything moves.
// Created 2026-08-19 (messenger shell).
//
// Svelte transitions run in JavaScript, so a `prefers-reduced-motion` media
// query in the stylesheet does NOT stop them — a visitor who asked their OS for
// less motion would still get every slide and fly on somebody else's website.
// That is an accessibility defect, not a preference, so the check lives here
// and every transition in the app takes its numbers from this module.
//
// It also reads the OWNER's motion preset, which the backend emits as
// --pawbar-duration / --pawbar-motion-scale (see appearance.py). One source of
// truth: an owner who picked "none" and a visitor who set reduce-motion arrive
// at the same still surface through the same code path, and "subtle" vs
// "expressive" reaches the JS transitions instead of only the CSS ones.

import { cubicOut, expoOut } from 'svelte/easing';

/** Fallback used before the token cascade is readable (SSR-less, but the very
 *  first paint can run before styles resolve in a cold frame). */
const FALLBACK_MS = 240;

function readToken(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const root = document.querySelector('.pawbar-root') ?? document.documentElement;
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** True when the visitor's OS asks for reduced motion. Read live rather than
 *  cached: people change this setting while a page is open, and a cached value
 *  would keep animating at them until reload. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Base duration in ms for a transition, after the visitor's setting and the
 *  owner's preset. Zero means "do not move" — Svelte treats a 0ms transition as
 *  an instant swap, which is the correct degradation: the state change still
 *  happens and is still announced, it simply does not travel. */
export function duration(weight = 1): number {
  if (prefersReducedMotion()) return 0;
  const base = readToken('--pawbar-duration', FALLBACK_MS);
  return Math.max(0, Math.round(base * weight));
}

/** How far things travel. The owner's "none" preset pins this to 0, so motion
 *  collapses to a cross-fade rather than disappearing — a surface that changes
 *  with no transition at all reads as a glitch. */
export function travel(px: number): number {
  if (prefersReducedMotion()) return 0;
  return Math.round(px * readToken('--pawbar-motion-scale', 1));
}

export { cubicOut, expoOut };
