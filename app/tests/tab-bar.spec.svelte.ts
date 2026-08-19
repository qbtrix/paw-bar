// tests/tab-bar.spec.svelte.ts — the top nav keeps the promise its roles make.
// Created 2026-08-19 (nav moved to the top as segmented pills).
//
// role="tablist" is a CONTRACT, not a label. Announcing it tells a screen-reader
// user that arrow keys move between tabs and that Tab steps past the whole
// group in one press. The old bottom nav made no such claim and behaved like a
// row of buttons, which was at least honest; claiming the role and keeping the
// button behaviour would be worse than either. So the contract is pinned here:
// roving tabindex, arrows with wrap, Home/End, and aria-controls that actually
// resolves to a pane.

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TabBar, { type Tab } from '../src/components/TabBar.svelte';

const TABS: Tab[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'messages', label: 'Messages', icon: 'messages', badge: 2 },
  { id: 'help', label: 'Help', icon: 'help' },
];

let live: ReturnType<typeof mount> | null = null;

function render(initial = 'home') {
  const target = document.createElement('div');
  document.body.append(target);
  const props = $state({
    tabs: TABS,
    active: initial,
    onselect: (id: string) => {
      props.active = id;
    },
  });
  live = mount(TabBar, { target, props });
  flushSync();

  const tabs = () => [...target.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  return {
    target,
    tabs,
    active: () => props.active,
    press(key: string) {
      // Dispatched on the focused tab, which is where a real keypress lands.
      const from = tabs().find((t) => t.tabIndex === 0) ?? tabs()[0];
      from.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      flushSync();
    },
  };
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.replaceChildren();
});

describe('TabBar keyboard contract', () => {
  it('puts exactly one tab in the page tab order', () => {
    const nav = render('messages');
    const order = nav.tabs().map((t) => t.tabIndex);

    // Roving tabindex: Tab reaches the group once and moves on, instead of
    // stepping through every section on the way to the content.
    expect(order).toEqual([-1, 0, -1]);
  });

  it('moves with the arrows and wraps at both ends', () => {
    const nav = render('home');

    nav.press('ArrowRight');
    expect(nav.active()).toBe('messages');

    nav.press('ArrowLeft');
    expect(nav.active()).toBe('home');

    // Wrapping matters more than it looks: without it the first and last tabs
    // are dead ends, and a keyboard user has to reverse to cross the group.
    nav.press('ArrowLeft');
    expect(nav.active()).toBe('help');

    nav.press('ArrowRight');
    expect(nav.active()).toBe('home');
  });

  it('jumps to the ends with Home and End', () => {
    const nav = render('messages');
    nav.press('End');
    expect(nav.active()).toBe('help');
    nav.press('Home');
    expect(nav.active()).toBe('home');
  });

  it('leaves other keys alone', () => {
    const nav = render('home');
    nav.press('ArrowDown');
    nav.press('a');
    expect(nav.active()).toBe('home');
  });

  it('names the pane each tab controls, and marks the selected one', () => {
    const nav = render('help');
    const [home, , help] = nav.tabs();

    expect(help.getAttribute('aria-selected')).toBe('true');
    expect(home.getAttribute('aria-selected')).toBe('false');
    // aria-controls pointing at nothing is worse than omitting it — Messenger
    // renders these ids on the panes.
    expect(help.getAttribute('aria-controls')).toBe('pawbar-pane-help');
    expect(help.id).toBe('pawbar-pane-tab-help');
  });

  it('announces an unread count as part of the tab, not as a loose number', () => {
    const nav = render();
    const messages = nav.tabs()[1];

    // "Messages, 2 unread" rather than a stranded "2" beside the label.
    expect(messages.textContent).toContain('Messages');
    expect(messages.querySelector('.sr-only')?.textContent).toBe('2 unread');
  });
});
