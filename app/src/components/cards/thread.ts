// thread.ts — "this card is drawn inside the new bar's thread" context flag.
// Created 2026-09-27 (Paw Bar states, section E). The cards were shared with the
// old shell (GlassShell → MessageRow → Markdown → CardBlock), whose look and
// behaviour could not change. 2026-09-27 (old shell removed): that shell is
// gone, so "absent" below now means isolated tests only. PawBarFrame sets this
// flag once at init; the
// cards read it to switch the few things CSS cannot carry: live-region roles
// (the bar's thread is the ONE live region, so nothing inside it may be
// role=status/alert), the compact copy, and product cards rendering through
// BarCatalog. Absent (isolated tests) = the cards' standalone behaviour.

import { getContext, setContext } from 'svelte';

const THREAD_KEY = Symbol('pawbar-thread-cards');

export function provideBarThread(): void {
  setContext(THREAD_KEY, true);
}

export function inBarThread(): boolean {
  return getContext<boolean | undefined>(THREAD_KEY) === true;
}
