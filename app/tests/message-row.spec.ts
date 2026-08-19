// tests/message-row.spec.ts — the transcript survives repeated citations.
// Created 2026-08-19.
//
// THE BUG THIS EXISTS FOR: MessageRow keyed its source chips on `source.url`,
// and Svelte throws `each_key_duplicate` on a keyed block with two identical
// keys — at RENDER time, in the production bundle, with no <svelte:boundary>
// anywhere in the app to contain it. A reply citing the same page twice is
// ordinary RAG output rather than a malformed payload, so one repeated
// citation took the whole widget down on somebody else's site.
//
// TWO LAYERS, TWO CONTRACTS, and this file tests only the second:
//   • lib/sources must never EMIT a duplicate — proven in sources.spec.ts,
//     where the sanitizer is called for real.
//   • MessageRow must never THROW on one anyway — proven here, by handing the
//     component the exact payload the sanitizer is supposed to prevent.
// Asserting the deduped count from here would have tested neither: the props
// would be ones this file built, so a green result would say nothing about
// what the app actually renders.
//
// These mount the REAL component rather than reasoning about the source,
// because "is this reachable in a production build" is not a question source
// reading answers.

import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import MessageRow from '../src/components/MessageRow.svelte';
import type { Message } from '../src/store/chat.svelte';

let live: ReturnType<typeof mount> | null = null;

function render(message: Partial<Message>): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(MessageRow, {
    target,
    props: {
      message: {
        id: 'm1',
        role: 'assistant',
        content: 'Shipping takes 3 days.',
        status: 'done',
        ...message,
      } as Message,
    },
  });
  flushSync();
  return target;
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.replaceChildren();
});

describe('MessageRow source chips', () => {
  it('renders a reply carrying the same url twice instead of throwing', () => {
    const url = 'https://ocean.example/shipping';

    // Before the fix this threw at mount:
    //   each_key_duplicate — Keyed each block has duplicate key
    //   `https://ocean.example/shipping` at indexes 0 and 1
    const target = render({
      sources: [
        { title: 'Shipping', url },
        { title: 'Shipping policy', url },
      ],
    });

    const toggle = target.querySelector<HTMLButtonElement>('.sources-toggle');
    expect(toggle, 'a reply with sources shows the toggle').not.toBeNull();
    toggle!.click();
    flushSync();

    // Both render. Removing the duplicate is the sanitizer's job, not this
    // component's — its job is to stay standing on input it did not vet.
    expect(target.querySelectorAll('.source-chip').length).toBe(2);
  });

  it('keeps genuinely distinct sources', () => {
    const target = render({
      sources: [
        { title: 'Shipping', url: 'https://ocean.example/shipping' },
        { title: 'Returns', url: 'https://ocean.example/returns' },
      ],
    });
    target.querySelector<HTMLButtonElement>('.sources-toggle')!.click();
    flushSync();

    const chips = [...target.querySelectorAll<HTMLAnchorElement>('.source-chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['Shipping', 'Returns']);
    // Every chip leaves the widget, so every chip needs the opener guard.
    expect(chips.every((c) => c.rel.includes('noopener'))).toBe(true);
  });

  it('carries its own visible word as its accessible name (WCAG 2.5.3)', () => {
    const target = render({ sources: [{ title: 'Shipping', url: 'https://x.example/s' }] });
    const toggle = target.querySelector<HTMLButtonElement>('.sources-toggle')!;

    // It used to be aria-labelled "Show sources" over the visible text
    // "Sources", so a voice-control user saying "click Sources" got no match.
    expect(toggle.getAttribute('aria-label')).toBeNull();
    expect(toggle.textContent).toContain('Sources');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not offer a rating it throws away', () => {
    const target = render({ content: 'Yes, we ship worldwide.' });

    // rate() set a local variable and nothing else — no request, no store,
    // nothing that read it back. There is no feedback endpoint on the paw_bar
    // router, so the buttons asked a question nobody received.
    const labels = [...target.querySelectorAll('.actions button')].map((b) => b.textContent);
    expect(labels).toEqual(['Copy']);
  });
});
