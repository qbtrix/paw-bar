// tests/message-list.spec.ts — the transcript keeps following a streaming reply.
// Created 2026-08-19.
//
// THE BUG THIS EXISTS FOR: auto-follow was decided by measuring geometry AFTER
// the DOM update — `scrollHeight - scrollTop - clientHeight < 80`. That reads
// as "is the reader near the bottom", but by the time it runs the new content
// is already laid out, so it actually asks "was the delta shorter than 80px".
// Any single delta taller than that — a code block, a table, a long bubble —
// answered no, and the transcript stopped following for the rest of the reply
// while the visitor sat watching a stationary screen.
//
// The fix reads the reader's INTENT from their scroll events instead of
// inferring it from geometry after the fact, so these stub the scroller's
// metrics and drive it exactly the way a browser would.

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import MessageList from '../src/components/MessageList.svelte';
import type { Message } from '../src/store/chat.svelte';

let live: ReturnType<typeof mount> | null = null;

function turn(id: string, content: string): Message {
  return { id, role: 'assistant', content, status: 'done' } as Message;
}

/** Mount the list and give its scroller browser-like metrics jsdom won't. */
function render(messages: Message[]) {
  const target = document.createElement('div');
  document.body.append(target);
  const props = $state({ messages });
  live = mount(MessageList, { target, props });
  flushSync();

  const el = target.querySelector<HTMLElement>('.list')!;
  let scrollHeight = 400;
  Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { get: () => scrollHeight, configurable: true });
  el.scrollTop = 100; // 400 - 100 - 300 = 0 → pinned to the bottom

  return {
    el,
    /** A delta lands: content grows by `px`, then the list re-renders. */
    async grow(px: number, text: string) {
      scrollHeight += px;
      props.messages = [...props.messages.slice(0, -1), turn('m-tail', text)];
      flushSync();
      await tick();
      await Promise.resolve();
    },
    setScrollHeight(px: number) {
      scrollHeight = px;
    },
  };
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.replaceChildren();
});

describe('MessageList auto-follow', () => {
  it('keeps following when one delta is taller than the old 80px threshold', async () => {
    const list = render([turn('m1', 'Hi'), turn('m-tail', '')]);

    // A fenced code block arriving in one frame — 500px in a single delta.
    await list.grow(500, '```\nlots\nof\ncode\n```');

    // Before the fix this stayed at 100: the post-update measurement saw a
    // 500px gap and concluded the reader had scrolled away, when in fact they
    // had not moved at all.
    expect(list.el.scrollTop).toBe(list.el.scrollHeight);
  });

  it('stops following once the reader scrolls up, and resumes when they return', async () => {
    const list = render([turn('m1', 'Hi'), turn('m-tail', '')]);

    // The reader scrolls back to re-read something.
    list.el.scrollTop = 0;
    list.el.dispatchEvent(new Event('scroll'));

    await list.grow(200, 'more text');
    expect(list.el.scrollTop, 'reading scroll-back is never yanked away').toBe(0);

    // They scroll back down to the tail themselves.
    list.el.scrollTop = list.el.scrollHeight - 300;
    list.el.dispatchEvent(new Event('scroll'));

    await list.grow(200, 'even more text');
    expect(list.el.scrollTop).toBe(list.el.scrollHeight);
  });
});
