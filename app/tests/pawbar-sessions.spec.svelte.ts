// tests/pawbar-sessions.spec.svelte.ts — sessions and compliance in the new bar
// (2026-09-27; PRD V4, V5, V8, V12, V13).
// ⋯ gets "New conversation" (inert on an empty thread) and, above one
// conversation, "Conversations (N)", which swaps the thread for a list that is
// not a live log; a row opens that conversation and Escape goes back.
// "↓ New message" shows when a scrolling thread grows under a reader who has
// scrolled up, and an emptied thread starts over. The bar's own state
// survives a page load per tab: it comes back closed as a continue pill (no
// dot, no announcement), the draft returns on the first pin and not on load,
// and nothing is written before the first open or while consent is required.
// The AI disclosure is always under the open bar and cannot be blanked.
// Consent holds a send until Accept, then sends it once.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

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
import PawBarFrame, { DEFAULT_DISCLOSURE, type BarConversation, type BarMessage } from '../src/components/bar/PawBarFrame.svelte';
import { SESSION_KEY_PREFIX, readBarSession, writeBarSession } from '../src/lib/bar-session';

let live: ReturnType<typeof mount> | null = null;
beforeEach(() => sessionStorage.clear());
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

const say = (id: string, role: BarMessage['role'], content: string, status: BarMessage['status'] = 'done'): BarMessage => ({
  id,
  role,
  content,
  status,
});
const conv = (id: string, preview: string, extra: Partial<BarConversation> = {}): BarConversation => ({
  id,
  state: 'open',
  preview,
  lastMessageAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  active: false,
  ...extra,
});

function frame(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  // Loose on purpose: each test sets whichever props it is about.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: Record<string, any> & { messages: BarMessage[] } = $state({
    messages: [] as BarMessage[],
    expanded: false,
    onsend: vi.fn(),
    ...extra,
  });
  live = mount(PawBarFrame, { target, props: props as never });
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
function openMenu(target: HTMLElement) {
  target.querySelector<HTMLButtonElement>('button[aria-label="Chat options"]')!.click();
  flushSync();
  return [...target.querySelectorAll<HTMLButtonElement>('.menu-item')];
}
const item = (items: HTMLButtonElement[], label: string) => items.find((b) => text(b)?.startsWith(label));
const hover = (target: HTMLElement) => {
  target.querySelector('.frame-wrap')!.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
  flushSync();
};

describe('conversations in ⋯ (V8, V11)', () => {
  it('"New conversation" is inert on an empty thread and calls onnewconversation otherwise', async () => {
    const onnewconversation = vi.fn();
    const { target, props } = frame({ expanded: true, resizable: false, onnewconversation });
    let items = openMenu(target);
    const inert = item(items, 'New conversation')!;
    expect(inert.getAttribute('aria-disabled')).toBe('true');
    inert.click();
    flushSync();
    expect(onnewconversation).not.toHaveBeenCalled();

    props.messages = [say('u1', 'user', 'hi'), say('a1', 'assistant', 'Hello')];
    flushSync();
    items = openMenu(target);
    items = items.length ? items : openMenu(target);
    item(items, 'New conversation')!.click();
    await tick();
    expect(onnewconversation).toHaveBeenCalledOnce();
  });

  it('the list item only shows above one conversation', () => {
    const { target, props } = frame({
      expanded: true,
      onopenconversation: vi.fn(),
      conversations: [conv('c1', 'Shipping to Oslo')],
    });
    expect(item(openMenu(target), 'Conversations')).toBeUndefined();
    openMenu(target); // close
    props.conversations = [conv('c1', 'Shipping to Oslo'), conv('c2', 'Gift ideas')];
    flushSync();
    expect(text(item(openMenu(target), 'Conversations')!)).toBe('Conversations (2)');
  });

  it('the list replaces the thread, is not a live log, marks the current one, and a row opens it', () => {
    const onopenconversation = vi.fn();
    const { target } = frame({
      expanded: true,
      conversationId: 'c1',
      messages: [say('u1', 'user', 'hi')],
      onopenconversation,
      conversations: [conv('c1', 'Shipping to Oslo', { active: true }), conv('c2', 'Gift ideas', { state: 'needs_human' })],
    });
    item(openMenu(target), 'Conversations')!.click();
    flushSync();
    const region = target.querySelector('.thread')!;
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-live')).toBe('off');
    expect(target.querySelector('.msg.user')).toBeNull();
    const rows = [...target.querySelectorAll<HTMLButtonElement>('.history-row')];
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual(['true', null]);
    expect(text(rows[1])).toContain('Waiting on team');
    expect(text(rows[0])).toContain('5m');

    rows[1].click();
    flushSync();
    expect(onopenconversation).toHaveBeenCalledWith('c2');
    expect(target.querySelector('.thread')!.getAttribute('role')).toBe('log');
  });

  it('Escape inside the list goes back to the thread without folding the bar', () => {
    const { target, props } = frame({
      expanded: true,
      messages: [say('u1', 'user', 'hi')],
      onopenconversation: vi.fn(),
      conversations: [conv('c1', 'a'), conv('c2', 'b')],
    });
    item(openMenu(target), 'Conversations')!.click();
    flushSync();
    target.querySelector('.history-row')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(target.querySelector('.history-row')).toBeNull();
    expect(props.expanded).toBe(true);
  });
});

describe('"↓ New message" (V5)', () => {
  function scrolledUp(el: HTMLElement) {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 300 });
    el.scrollTop = 100;
    el.dispatchEvent(new Event('scroll'));
    flushSync();
  }

  it('shows when a turn arrives while the reader is scrolled up, and jumping hides it', () => {
    // Full screen always scrolls; jsdom measures nothing, so a card never would.
    const { target, props } = frame({ expanded: true, fullscreen: true, messages: [say('u1', 'user', 'hi'), say('a1', 'assistant', 'One')] });
    const thread = target.querySelector<HTMLElement>('.thread')!;
    thread.scrollTo = vi.fn() as unknown as typeof thread.scrollTo;
    scrolledUp(thread);
    expect(target.querySelector('.jump')).toBeNull();

    props.messages.push(say('o1', 'owner', 'Hi, Maya here'));
    flushSync();
    const jump = target.querySelector<HTMLButtonElement>('.jump')!;
    expect(text(jump)).toBe('New message');
    jump.click();
    flushSync();
    expect(thread.scrollTo).toHaveBeenCalled();
    expect(target.querySelector('.jump')).toBeNull();
  });

  it('an emptied thread (a new conversation) takes the pill away and follows again', () => {
    const { target, props } = frame({ expanded: true, fullscreen: true, messages: [say('u1', 'user', 'hi')] });
    scrolledUp(target.querySelector<HTMLElement>('.thread')!);
    props.messages.push(say('a1', 'assistant', 'Hello'));
    flushSync();
    expect(target.querySelector('.jump')).not.toBeNull();
    props.messages = [];
    flushSync();
    expect(target.querySelector('.jump')).toBeNull();
    props.messages = [say('u2', 'user', 'new start')];
    flushSync();
    expect(target.querySelector('.jump')).toBeNull();
  });

  it('a card that does not scroll never shows it', () => {
    const { target, props } = frame({ expanded: true, messages: [say('u1', 'user', 'hi')] });
    scrolledUp(target.querySelector<HTMLElement>('.thread')!);
    props.messages.push(say('a1', 'assistant', 'Hello'));
    flushSync();
    expect(target.querySelector('.jump')).toBeNull();
  });

  it('does not show for a reader already at the bottom', () => {
    const { target, props } = frame({ expanded: true, messages: [say('u1', 'user', 'hi')] });
    props.messages.push(say('a1', 'assistant', 'Hello'));
    flushSync();
    expect(target.querySelector('.jump')).toBeNull();
  });
});

describe('across page loads (V12)', () => {
  const thread = [say('u1', 'user', 'Do you ship to Oslo?'), say('a1', 'assistant', 'Yes, in 3 to 5 days.\n\nMore detail here.')];

  it('nothing is written before the bar has opened once', () => {
    frame({ persistKey: 'w1', messages: thread });
    expect(sessionStorage.getItem(SESSION_KEY_PREFIX + 'w1')).toBeNull();
  });

  it('writes the pin and the draft once the bar has opened', () => {
    const { target } = frame({ persistKey: 'w1', messages: thread, expanded: true });
    type(target, 'and to Bergen?');
    const saved = readBarSession('w1')!;
    expect(saved.open).toBe(true);
    expect(saved.draft).toBe('and to Bergen?');
  });

  it('a bar that was open comes back closed, as a continue pill with no dot and no announcement', () => {
    writeBarSession('w1', { open: true, full: false, draft: '', scroll: null, at: Date.now() });
    const { target } = frame({ persistKey: 'w1', messages: thread });
    expect(target.querySelector('textarea')).toBeNull();
    const trigger = target.querySelector('.trigger')!;
    expect(text(trigger)).toBe('Yes, in 3 to 5 days. More detail here.');
    expect(trigger.getAttribute('aria-label')).toBe('Open chat, continue the conversation: Yes, in 3 to 5 days. More detail here.');
    expect(target.querySelector('.activity')).toBeNull();
    expect(text(target.querySelector('.pawbar-host > [role="status"]'))).toBe('');
  });

  it('opening the continue pill restores full screen, and the pill does not come back', () => {
    writeBarSession('w1', { open: true, full: true, draft: '', scroll: null, at: Date.now() });
    const { target, props } = frame({ persistKey: 'w1', messages: thread });
    props.expanded = true;
    flushSync();
    expect(target.querySelector('.frame-wrap')!.getAttribute('data-full')).toBe('true');
    props.expanded = false;
    props.fullscreen = false;
    flushSync();
    expect(text(target.querySelector('.trigger'))).toBe('Ask anything…');
  });

  it('the draft comes back on the first pin, never on load', () => {
    writeBarSession('w1', { open: false, full: false, draft: 'half a question', scroll: null, at: Date.now() });
    const { target, props } = frame({ persistKey: 'w1', messages: thread });
    expect(target.querySelector('textarea')).toBeNull();
    props.expanded = true;
    flushSync();
    expect(target.querySelector('textarea')!.value).toBe('half a question');
  });

  it('a stale snapshot is ignored', () => {
    writeBarSession('w1', { open: true, full: false, draft: '', scroll: null, at: Date.now() - 31 * 60_000 });
    const { target } = frame({ persistKey: 'w1', messages: thread });
    expect(text(target.querySelector('.trigger'))).toBe('Ask anything…');
  });

  it('news outranks the continue pill', () => {
    writeBarSession('w1', { open: true, full: false, draft: '', scroll: null, at: Date.now() });
    const { target, props } = frame({ persistKey: 'w1', messages: [...thread] });
    props.messages.push(say('o1', 'owner', 'Maya here'));
    flushSync();
    expect(text(target.querySelector('.trigger'))).toBe('Team: Maya here');
  });
});

describe('AI disclosure (Art. 50)', () => {
  it('shows under the open bar and describes the field', () => {
    const { target } = frame({ expanded: true });
    const line = target.querySelector('.credit')!;
    expect(line.textContent).toContain(DEFAULT_DISCLOSURE);
    const id = line.querySelector('[id^="pbf-ai-"]')!.id;
    expect(target.querySelector('textarea')!.getAttribute('aria-describedby')!.split(' ')).toContain(id);
  });

  it('the owner can reword it but not blank it', () => {
    const { target, props } = frame({ expanded: true, disclosure: 'Bloom’s AI helper' });
    expect(target.querySelector('.credit')!.textContent).toContain('Bloom’s AI helper');
    props.disclosure = '   ';
    flushSync();
    expect(target.querySelector('.credit')!.textContent).toContain(DEFAULT_DISCLOSURE);
  });

  it('shows on hover too, and links the privacy policy when there is one', () => {
    const { target } = frame({ privacyHref: 'https://example.com/privacy' });
    hover(target);
    const link = target.querySelector<HTMLAnchorElement>('.credit a[href="https://example.com/privacy"]')!;
    expect(link.textContent).toBe('Privacy');
    expect(link.target).toBe('_blank');
  });
});

describe('consent (V13)', () => {
  it('holds a send, keeps the draft, and sends it once after Accept', async () => {
    const onconsent = vi.fn();
    const { target, props } = frame({ expanded: true, consent: 'required', onconsent });
    expect(text(target.querySelector('.consent'))).toContain('To chat, we store a conversation ID');

    const field = type(target, 'Do you ship to Oslo?');
    enter(field);
    await tick();
    flushSync();
    expect(props.onsend).not.toHaveBeenCalled();
    expect(target.querySelector('textarea')!.value).toBe('Do you ship to Oslo?');
    expect(text(target.querySelector('.consent'))).toContain('To send this');

    [...target.querySelectorAll<HTMLButtonElement>('.consent button')].find((b) => b.textContent === 'Accept')!.click();
    flushSync();
    expect(onconsent).toHaveBeenCalledWith(true);
    props.consent = 'granted';
    flushSync();
    expect(props.onsend).toHaveBeenCalledOnce();
    expect(props.onsend).toHaveBeenCalledWith('Do you ship to Oslo?');
    expect(target.querySelector('textarea')!.value).toBe('');
    expect(target.querySelector('.consent')).toBeNull();
  });

  it('"Not now" hides the step, drops the held message, and keeps the draft', async () => {
    const onconsent = vi.fn();
    const { target, props } = frame({ expanded: true, consent: 'required', onconsent });
    enter(type(target, 'hello'));
    await tick();
    flushSync();
    [...target.querySelectorAll<HTMLButtonElement>('.consent button')].find((b) => b.textContent === 'Not now')!.click();
    flushSync();
    expect(onconsent).toHaveBeenCalledWith(false);
    expect(target.querySelector('.consent')).toBeNull();
    props.consent = 'granted';
    flushSync();
    expect(props.onsend).not.toHaveBeenCalled();
    expect(target.querySelector('textarea')!.value).toBe('hello');
  });

  it('writes nothing to session storage while consent is required', () => {
    const { target } = frame({ expanded: true, consent: 'required', persistKey: 'w1' });
    type(target, 'draft');
    expect(sessionStorage.getItem(SESSION_KEY_PREFIX + 'w1')).toBeNull();
  });

  it('an unavailable chat does not ask for consent', () => {
    const { target } = frame({ expanded: true, consent: 'required', unavailable: { contactable: false } });
    expect(target.querySelector('.consent')).toBeNull();
  });
});
