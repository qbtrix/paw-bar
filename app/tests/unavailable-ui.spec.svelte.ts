// tests/unavailable-ui.spec.svelte.ts — how the bar draws a turn the server
// marked unavailable. Temporary: a note under the reply, "I couldn't answer
// that just now." with Try again and no contact offer. Limit: the near-input
// line "I'm not available right now." with "Leave your email", which opens the
// Talk-to-a-person panel; nothing is sent until the visitor submits it.

import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

import { mount, unmount, flushSync, tick } from 'svelte';
import PawBarFrame, { type BarMessage } from '../src/components/bar/PawBarFrame.svelte';

let live: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

function frame(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const props = $state({
    messages: [] as BarMessage[],
    expanded: true,
    onsend: vi.fn(),
    onstop: vi.fn(),
    onretry: vi.fn(),
    ...extra,
  });
  live = mount(PawBarFrame, { target, props });
  flushSync();
  return { target, props };
}

function text(el: Element | null) {
  if (!el) return undefined;
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('.sr-only').forEach((n) => n.remove());
  return c.textContent?.replace(/\s+/g, ' ').trim();
}

const user: BarMessage = { id: 'u1', role: 'user', content: 'what are your hours?', status: 'done' };

describe('an unavailable reply', () => {
  it('temporary: says so under the reply, offers Try again, and no contact', () => {
    const onrequesthuman = vi.fn(async () => ({ ok: true as const }));
    const { target, props } = frame({
      onrequesthuman,
      messages: [user, { id: 'a1', role: 'assistant', content: '', status: 'error', failure: 'unavailable', unavailable: 'temporary' }],
    });
    const note = target.querySelector('.turn-note.error');
    expect(text(note)).toBe("I couldn't answer that just now. Try again");
    expect(target.textContent).not.toContain('No answer came back');
    expect(target.textContent).not.toContain('Leave your email');
    expect(target.querySelector('.notice')).toBeNull();

    note!.querySelector<HTMLButtonElement>('.retry')!.click();
    expect(props.onretry).toHaveBeenCalledWith('a1');
    expect(onrequesthuman).not.toHaveBeenCalled();
  });

  it('limit: the line says the bar is down, and Leave your email opens the panel without sending anything', async () => {
    const onrequesthuman = vi.fn(async () => ({ ok: true as const }));
    const { target } = frame({
      onrequesthuman,
      unavailable: { contactable: true },
      notice: {
        kind: 'unavailable',
        text: "I'm not available right now. Leave your email and the team will get back to you.",
        action: 'contact',
      },
      messages: [user, { id: 'a1', role: 'assistant', content: '', status: 'error', failure: 'unavailable', unavailable: 'limit' }],
    });
    const notice = target.querySelector('.notice')!;
    expect(text(notice)).toBe("I'm not available right now. Leave your email");
    // The line speaks for the turn: no second copy of it, no Try again, no "Not sent".
    expect(target.querySelector('.turn-note')).toBeNull();
    expect(target.textContent).not.toContain('No answer came back');

    notice.querySelector<HTMLButtonElement>('.retry')!.click();
    await tick();
    flushSync();
    expect(target.querySelector('.contact')).not.toBeNull();
    expect(onrequesthuman).not.toHaveBeenCalled();
  });

  it('never shows the act line alongside the unavailable note', () => {
    const { target } = frame({
      messages: [
        user,
        {
          id: 'a1',
          role: 'assistant',
          content: 'Here are the boots.',
          status: 'error',
          failure: 'unavailable',
          unavailable: 'temporary',
          action: { do: 'navigate', to: 'https://shop.example.com/boots', label: 'Cairn boot', state: 'pending' },
        },
      ],
    });
    expect(text(target.querySelector('.turn-note.error'))).toBe("I couldn't answer that just now. Try again");
    expect(target.textContent).not.toContain('Cairn boot');
  });
});
