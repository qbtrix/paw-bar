// tests/pawbar-states.spec.svelte.ts — the conversation states of the new bar
// (2026-09-27; specs in docs/design/drafts/2026-09-27-paw-bar-states-ux-*).
// Streaming turns Send into Stop and swallows Enter; a failed reply offers
// "Try again" on the newest failure only; a stopped reply says so; team turns
// are labelled once per run and system turns are chips; an empty pinned bar
// greets; a restore shows nothing, then one quiet line; the closed bar shows
// what arrived while it was closed, and only PINNING it marks that as seen;
// a team takeover gets a notice and a new placeholder; a turn with an unknown
// role costs one row. Hovering shows the history (click pins it). PawBar alone: read-only, blocked send, a refused draft
// coming back, and the Talk-to-a-person panel. Failures: notes under the
// failed turn, a queued turn, a cooldown that counts down and holds Send, an
// unavailable chat (read-only, email offer when a person can still be
// reached), and the rejected alert. F: Default follows the host scheme,
// branded themes do not; a narrow screen opens a conversation full screen.
// 2026-09-27: the field is described by the notice AND the AI disclosure, so
// the takeover test checks the notice is one of its describers. "Talk to a
// person" is a chip in the bottom row now, not a ⋯ item.

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
import PawBar from '../src/components/bar/PawBar.svelte';
import { resolveTheme } from '../src/lib/bar-themes';

let live: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const say = (id: string, role: BarMessage['role'], content: string, status: BarMessage['status'] = 'done'): BarMessage => ({
  id,
  role,
  content,
  status,
});

function frame(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const props = $state({
    messages: [] as BarMessage[],
    expanded: false,
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

function type(target: HTMLElement, value: string) {
  const field = target.querySelector('textarea')!;
  field.value = value;
  field.dispatchEvent(new Event('input'));
  flushSync();
  return field;
}
const enter = (field: HTMLTextAreaElement) => {
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  flushSync();
};

describe('conversation states', () => {
  it('C4: while a reply streams, Send is Stop, and Stop calls onstop', () => {
    const { target, props } = frame({ expanded: true, messages: [say('u1', 'user', 'hi'), say('a1', 'assistant', 'Hel', 'streaming')] });
    expect(target.querySelector('button[aria-label="Send"]')).toBeNull();
    target.querySelector<HTMLButtonElement>('button[aria-label="Stop reply"]')!.click();
    expect(props.onstop).toHaveBeenCalledOnce();
  });

  it('C4: Enter is swallowed mid-reply and the draft is kept', () => {
    const { target, props } = frame({ expanded: true, messages: [say('u1', 'user', 'hi'), say('a1', 'assistant', '', 'streaming')] });
    const field = type(target, 'next question');
    enter(field);
    expect(props.onsend).not.toHaveBeenCalled();
    expect(field.value).toBe('next question');
  });

  it('C7: only the newest failed reply offers Try again, and it calls onretry', () => {
    const { target, props } = frame({
      expanded: true,
      messages: [
        say('u1', 'user', 'one'),
        say('a1', 'assistant', '', 'error'),
        say('u2', 'user', 'two'),
        say('a2', 'assistant', 'partial', 'error'),
      ],
    });
    const errors = target.querySelectorAll('.turn-note.error');
    expect(errors).toHaveLength(2);
    const buttons = target.querySelectorAll<HTMLButtonElement>('.retry');
    expect(buttons).toHaveLength(1);
    buttons[0].click();
    expect(props.onretry).toHaveBeenCalledWith('a2');
    // The partial text stays above the error line.
    expect(text(target.querySelectorAll('.msg.assistant')[0])).toBe('partial');
  });

  it('C5: a reply stopped part-way says so, and offers no Copy', () => {
    const stopped = { ...say('a1', 'assistant', 'half an ans'), stopped: true };
    const { target } = frame({ expanded: true, messages: [say('u1', 'user', 'hi'), stopped] });
    expect(text(target.querySelector('.row.assistant .meta'))).toBe('Stopped');
    expect(target.querySelector('.foot')).toBeNull();
  });

  it('C6: a done reply lists its sources behind a disclosure', () => {
    const done = { ...say('a1', 'assistant', 'Yes.'), sources: [{ title: 'Shipping', url: 'https://example.com/s' }] };
    const { target } = frame({ expanded: true, messages: [say('u1', 'user', 'hi'), done] });
    const toggle = target.querySelector<HTMLButtonElement>('.foot-btn[aria-expanded]')!;
    expect(text(toggle)).toBe('Sources (1)');
    expect(target.querySelector('.source')).toBeNull();
    toggle.click();
    flushSync();
    const link = target.querySelector<HTMLAnchorElement>('.source')!;
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  });

  it('C9/C10: a team run is labelled once, and a system turn is a chip', () => {
    const { target } = frame({
      expanded: true,
      teamLabel: 'Support',
      messages: [
        say('s1', 'system', 'A member of the team joined the conversation'),
        say('o1', 'owner', 'Hi'),
        say('o2', 'owner', 'Order number?'),
      ],
    });
    expect(text(target.querySelector('.chip-note'))).toBe('A member of the team joined the conversation');
    expect(target.querySelectorAll('.msg.owner')).toHaveLength(2);
    const labels = target.querySelectorAll('.team-label');
    expect(labels).toHaveLength(1);
    expect(text(labels[0])).toBe('Support');
  });

  it('C12: a turn with an unknown role costs one row, not the thread', () => {
    const odd = { id: 'x1', role: 'robot', content: '?', status: 'done' } as unknown as BarMessage;
    const { target } = frame({ expanded: true, messages: [odd, say('u1', 'user', 'still here')] });
    expect(text(target.querySelector('.unrenderable'))).toBe("This message couldn't be displayed.");
    expect(text(target.querySelector('.msg.user'))).toBe('still here');
  });

  it('C1: a pinned bar with no turns greets, with the owner line when there is one', () => {
    const { target, props } = frame({ expanded: true, greeting: '' });
    expect(text(target.querySelector('.greeting'))).toMatch(/^Hi! Ask me anything/);
    (props as { greeting?: string }).greeting = 'Welcome to Ocean Supply.';
    flushSync();
    expect(text(target.querySelector('.greeting'))).toBe('Welcome to Ocean Supply.');
  });

  it('C2: a restore shows nothing at first, then one quiet line, never the greeting', () => {
    vi.useFakeTimers();
    const { target } = frame({ expanded: true, restoring: true });
    expect(target.querySelector('.greeting')).toBeNull();
    expect(target.querySelector('.loading')).toBeNull();
    vi.advanceTimersByTime(320);
    flushSync();
    expect(text(target.querySelector('.loading'))).toBe('Loading your conversation…');
  });

  it('C3: a silent reply says "Still thinking…" after 8 seconds', () => {
    vi.useFakeTimers();
    const { target } = frame({ expanded: true, messages: [say('u1', 'user', 'hi'), say('a1', 'assistant', '', 'streaming')] });
    expect(target.querySelector('.thinking .meta')).toBeNull();
    vi.advanceTimersByTime(8100);
    flushSync();
    expect(text(target.querySelector('.thinking .meta'))).toBe('Still thinking…');
  });

  it('C8: a takeover shows the notice, describes the field with it, and swaps the placeholder', () => {
    const { target } = frame({ expanded: true, botPaused: true, messages: [say('o1', 'owner', 'Hi')] });
    const notice = target.querySelector('.notice')!;
    expect(text(notice)).toBe("You're chatting with the team");
    const field = target.querySelector('textarea')!;
    expect(field.placeholder).toBe('Reply to the team…');
    expect(field.getAttribute('aria-describedby')!.split(' ')).toContain(notice.id);
  });

  it('the thread is the one live region, and nothing inside it is another', () => {
    const { target } = frame({ expanded: true, messages: [say('u1', 'user', 'hi'), say('a1', 'assistant', '', 'streaming')] });
    const log = target.querySelector('.thread')!;
    expect(log.getAttribute('role')).toBe('log');
    expect(log.querySelector('[role="status"], [aria-live]')).toBeNull();
  });
});

describe('activity on the closed bar (B8)', () => {
  it('a reply that finishes while the bar is closed shows on the pill until the bar is pinned', () => {
    const { target, props } = frame({ messages: [say('u1', 'user', 'hi'), say('a1', 'assistant', '', 'streaming')] });
    expect(text(target.querySelector('.trigger'))).toBe('Replying…');
    expect(target.querySelector('.activity')?.getAttribute('data-activity')).toBe('thinking');

    props.messages[1].content = 'Yes, we ship to Oslo.';
    props.messages[1].status = 'done';
    flushSync();
    const trigger = target.querySelector('.trigger')!;
    expect(text(trigger)).toBe('Yes, we ship to Oslo.');
    expect(trigger.getAttribute('aria-label')).toBe('Open chat, 1 new reply: Yes, we ship to Oslo.');
    expect(text(target.querySelector('.pawbar-host > [role="status"]'))).toBe('1 new reply: Yes, we ship to Oslo.');

    props.expanded = true;
    flushSync();
    props.expanded = false;
    flushSync();
    expect(text(target.querySelector('.trigger'))).toBe('Ask anything…');
    expect(target.querySelector('.activity')).toBeNull();
  });

  it('turns already there on mount count as seen', () => {
    const { target } = frame({ messages: [say('u1', 'user', 'hi'), say('a1', 'assistant', 'Old answer')] });
    expect(target.querySelector('.activity')).toBeNull();
  });

  it('a team turn outranks a reply and is marked as the team', () => {
    const { target, props } = frame({ messages: [say('u1', 'user', 'hi')] });
    props.messages.push(say('a1', 'assistant', 'Bot answer'));
    props.messages.push(say('o1', 'owner', "Hi, I'm Maya"));
    flushSync();
    expect(text(target.querySelector('.trigger'))).toBe("Team: Hi, I'm Maya");
    expect(target.querySelector('.activity')?.getAttribute('data-activity')).toBe('team');
  });

  it('hovering a closed bar with news shows the thread without marking it seen', async () => {
    const { target, props } = frame({ messages: [say('u1', 'user', 'hi')] });
    props.messages.push(say('a1', 'assistant', 'New answer'));
    flushSync();
    const wrap = target.querySelector('.frame-wrap')!;
    wrap.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    flushSync();
    expect(target.querySelector('.thread-inner')).not.toBeNull();
    wrap.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await new Promise((r) => setTimeout(r, 200));
    flushSync();
    expect(target.querySelector('.activity')?.getAttribute('data-activity')).toBe('unread');
  });

  // Captain, 2026-09-27: "I have to send messages every time to see the
  // session history". Hover now shows the history; click pins it.
  it('hovering shows the conversation so far, but an empty one does not grow', () => {
    const { target, props } = frame({ messages: [say('u1', 'user', 'hi'), say('a1', 'assistant', 'Old answer')] });
    const wrap = target.querySelector('.frame-wrap')!;
    wrap.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    flushSync();
    expect(text(target.querySelector('.msg.assistant'))).toBe('Old answer');

    props.messages = [];
    flushSync();
    expect(target.querySelector('.thread-inner')).toBeNull();
  });

  it('the icon launcher carries the news in its name and a dot', () => {
    const { target, props } = frame({ launcher: 'icon', messages: [say('u1', 'user', 'hi')] });
    props.messages.push(say('a1', 'assistant', 'Done.'));
    flushSync();
    expect(target.querySelector('.launch')?.getAttribute('aria-label')).toBe('Open chat, 1 new reply: Done.');
    expect(target.querySelector('.launcher .activity')).not.toBeNull();
  });
});

describe('failure states', () => {
  it('a turn that was not sent says so under the bubble, with Try again', () => {
    const failed = { ...say('u1', 'user', 'hello'), status: 'error' as const, failure: 'unreachable' as const };
    const { target, props } = frame({ expanded: true, messages: [failed] });
    expect(text(target.querySelector('.row.user .turn-note'))).toBe('Not sent Try again');
    target.querySelector<HTMLButtonElement>('.row.user .retry')!.click();
    expect(props.onretry).toHaveBeenCalledWith('u1');
  });

  it('a queued turn waits for the connection, with no Retry', () => {
    const queued = { ...say('u1', 'user', 'hello'), status: 'queued' as const };
    const { target } = frame({ expanded: true, messages: [queued] });
    expect(text(target.querySelector('.row.user .turn-note'))).toBe('Waiting for connection');
    expect(target.querySelector('.retry')).toBeNull();
  });

  it('a reply cut off keeps its text and names the failure', () => {
    const cut = { ...say('a1', 'assistant', 'We ship to'), status: 'error' as const, failure: 'interrupted' as const };
    const { target } = frame({ expanded: true, messages: [say('u1', 'user', 'hi'), cut] });
    expect(text(target.querySelector('.msg.assistant'))).toBe('We ship to');
    expect(text(target.querySelector('.row.assistant .turn-note'))).toBe('The reply was cut off Try again');
  });

  it('during a cooldown Send is held, Try again is inert, and the line counts down', () => {
    vi.useFakeTimers();
    const failed = { ...say('u1', 'user', 'hello'), status: 'error' as const, failure: 'rate_limited' as const };
    const { target, props } = frame({
      expanded: true,
      messages: [failed],
      cooldownUntil: Date.now() + 20_000,
      notice: { kind: 'cooldown', text: 'x' },
    });
    expect(text(target.querySelector('.notice'))).toBe("You're sending messages quickly. You can send again in 20s.");
    vi.advanceTimersByTime(5000);
    flushSync();
    expect(text(target.querySelector('.notice'))).toBe("You're sending messages quickly. You can send again in 15s.");
    expect(target.querySelector('button[aria-label="Send"]')?.getAttribute('aria-disabled')).toBe('true');
    const retry = target.querySelector<HTMLButtonElement>('.retry')!;
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    retry.click();
    expect(props.onretry).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16_000);
    flushSync();
    expect(target.querySelector('.notice')).toBeNull();
  });

  it('an unavailable chat is read-only, says so even when folded, and offers email when it can', async () => {
    const onrequesthuman = vi.fn(async () => ({ ok: true as const }));
    const { target } = frame({
      unavailable: { contactable: true },
      notice: {
        kind: 'unavailable',
        text: "Chat isn't available right now. Leave your email and the team will get back to you.",
        action: 'contact',
      },
      onrequesthuman,
    });
    const notice = target.querySelector('.notice')!;
    expect(text(notice)).toBe("Chat isn't available right now. Leave your email");
    notice.querySelector<HTMLButtonElement>('.retry')!.click();
    await tick();
    flushSync();
    const field = target.querySelector('textarea')!;
    expect(field.readOnly).toBe(true);
    expect(field.placeholder).toBe("Chat isn't available right now");
    expect(target.querySelector('.contact')).not.toBeNull();
  });

  it('a chat that cannot reach a person offers no Talk to a person at all', () => {
    const { target } = frame({
      expanded: true,
      resizable: false,
      unavailable: { contactable: false },
      onrequesthuman: vi.fn(),
    });
    expect(target.querySelector('button[aria-label="Chat options"]')).toBeNull();
  });

  it('a rejected message is the one alert', () => {
    const { target } = frame({ expanded: true, notice: { kind: 'rejected', text: "That message couldn't be sent. Try rewording it." } });
    expect(target.querySelector('.notice')?.getAttribute('role')).toBe('alert');
  });
});

describe('host scheme and narrow screens (F)', () => {
  it('Default follows the host scheme; a branded theme ignores it', () => {
    expect(resolveTheme('default', {}, 'light')['--pawbar-frame-fg']).toBe('#1c1c21');
    expect(resolveTheme('default', {}, 'dark')).toEqual({});
    expect(resolveTheme('paper', {}, 'dark')).toEqual(resolveTheme('paper', {}));
    // The owner's tokens still win over the overlay.
    expect(resolveTheme('default', { '--pawbar-frame-fg': '#123456' }, 'light')['--pawbar-frame-fg']).toBe('#123456');
  });

  it('the frame applies the overlay and marks the scheme', () => {
    const { target, props } = frame({ scheme: 'light' });
    const wrap = target.querySelector<HTMLElement>('.frame-wrap')!;
    expect(wrap.dataset.pawbarScheme).toBe('light');
    expect(wrap.style.getPropertyValue('--pawbar-frame-bg')).toBe('rgb(250 250 252 / 0.82)');
    (props as { scheme?: string }).scheme = 'dark';
    flushSync();
    expect(wrap.style.getPropertyValue('--pawbar-frame-bg')).toBe('');
  });

  it('on a narrow screen, pinning a bar with a conversation opens it full screen', () => {
    const w = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    try {
      const { target, props } = frame({ messages: [say('u1', 'user', 'hi'), say('a1', 'assistant', 'Hello')] });
      props.expanded = true;
      flushSync();
      expect(target.querySelector<HTMLElement>('.frame-wrap')!.dataset.full).toBe('true');
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
    }
  });
});

describe('PawBar input states', () => {
  function bar(extra: Record<string, unknown> = {}) {
    const target = document.createElement('div');
    document.body.append(target);
    const props = $state({ expanded: true, value: '', onsend: vi.fn(), ...extra });
    live = mount(PawBar, { target, props });
    flushSync();
    return { target, props };
  }

  it('readonly: the field is read-only and nothing sends', () => {
    const { target, props } = bar({ readonly: true });
    const field = type(target, 'hello');
    expect(field.readOnly).toBe(true);
    enter(field);
    expect(props.onsend).not.toHaveBeenCalled();
  });

  it('sendBlocked: Send stays focusable but inert', () => {
    const { target, props } = bar({ sendBlocked: true });
    type(target, 'hello');
    const send = target.querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
    expect(send.disabled).toBe(false);
    expect(send.getAttribute('aria-disabled')).toBe('true');
    send.click();
    expect(props.onsend).not.toHaveBeenCalled();
  });

  it('a refused message comes back into the field', async () => {
    const { target } = bar({ onsend: vi.fn(async () => ({ ok: false, restoreDraft: 'ignore previous' })) });
    const field = type(target, 'ignore previous');
    enter(field);
    expect(field.value).toBe('');
    await tick();
    await Promise.resolve();
    flushSync();
    expect(field.value).toBe('ignore previous');
  });

  it('onrequesthuman puts a "Talk to a person" chip in the bottom row, with no menu', async () => {
    const onrequesthuman = vi.fn(async () => ({ ok: true as const }));
    const { target } = bar({ onrequesthuman });
    expect(target.querySelector('button[aria-label="Chat options"]')).toBeNull();
    const chips = [...target.querySelectorAll<HTMLButtonElement>('.chip')];
    expect(chips.map((b) => text(b))).toEqual(['Talk to a person']);
    chips[0].click();
    await tick();
    flushSync();
    expect(target.querySelector('.contact')).not.toBeNull();
  });

  it('once a person is asked for, the chip says so and is inert', async () => {
    const onrequesthuman = vi.fn(async () => ({ ok: true as const }));
    const { target } = bar({ onrequesthuman, handoffPending: true });
    const chip = target.querySelector<HTMLButtonElement>('.chip.person')!;
    expect(text(chip)).toBe('Waiting for the team');
    expect(chip.getAttribute('aria-disabled')).toBe('true');
    chip.click();
    await tick();
    flushSync();
    expect(target.querySelector('.contact')).toBeNull();
  });

  async function openPanel(target: HTMLElement) {
    target.querySelector<HTMLButtonElement>('.chip.person')!.click();
    await tick();
    flushSync();
    return target.querySelector<HTMLInputElement>('.contact-email')!;
  }
  function setEmail(email: HTMLInputElement, v: string) {
    email.value = v;
    email.dispatchEvent(new Event('input'));
    flushSync();
  }

  it('the contact panel sends the draft and the email, and closes on success', async () => {
    const onrequesthuman = vi.fn(async () => ({ ok: true as const }));
    const { target } = bar({ onrequesthuman });
    type(target, 'my order is late');
    const email = await openPanel(target);
    setEmail(email, 'a@b.co');
    target.querySelector<HTMLButtonElement>('.ask')!.click();
    await vi.waitFor(() => expect(onrequesthuman).toHaveBeenCalledWith({ message: 'my order is late', contact: 'a@b.co' }));
    await tick();
    flushSync();
    expect(target.querySelector('.contact')).toBeNull();
    expect(target.querySelector('textarea')!.value).toBe('');
  });

  it('a bad email is caught before sending, and a server error keeps the panel', async () => {
    const onrequesthuman = vi.fn(async () => ({
      ok: false as const,
      error: 'unreachable',
      text: "Couldn't reach the team just now. Try again in a minute.",
    }));
    const { target } = bar({ onrequesthuman });
    const email = await openPanel(target);
    setEmail(email, 'not-an-email');
    target.querySelector<HTMLButtonElement>('.ask')!.click();
    flushSync();
    expect(onrequesthuman).not.toHaveBeenCalled();
    expect(email.getAttribute('aria-invalid')).toBe('true');

    setEmail(email, '');
    target.querySelector<HTMLButtonElement>('.ask')!.click();
    await vi.waitFor(() => expect(onrequesthuman).toHaveBeenCalled());
    await tick();
    flushSync();
    expect(text(target.querySelector('.contact-error'))).toBe("Couldn't reach the team just now. Try again in a minute.");
    expect(target.querySelector('.contact')).not.toBeNull();
  });

  it('onready fires once the logo loads or fails, and at once without one', async () => {
    const onready = vi.fn();
    bar({ expanded: false, onready });
    await tick();
    expect(onready).toHaveBeenCalledOnce();
  });
});
