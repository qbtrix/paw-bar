// tests/composer-limit.spec.ts — the composer never sends what the backend
// will refuse. Created 2026-09-26.
//
// THE BUG THIS EXISTS FOR: the paw_bar chat endpoint rejects a `message` over
// 8,000 characters with a 400, and the widget rendered that as the generic
// "Something went wrong" — the visitor lost their long message with no idea
// why. The composer now caps input at MAX_MESSAGE_CHARS (maxlength), refuses to
// send over it (a prefill bypasses maxlength), and shows a calm hint near the
// limit, wired to the textarea via aria-describedby and a polite status region
// whose text changes only when the threshold is crossed (never per keystroke).
//
// Mounts the REAL component under jsdom, like message-row.spec.ts.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import Composer from '../src/components/Composer.svelte';
import { MAX_MESSAGE_CHARS, MESSAGE_LIMIT_HINT_AT } from '../src/lib/composer/limits';

let live: ReturnType<typeof mount> | null = null;

function render() {
  const target = document.createElement('div');
  document.body.append(target);
  const onSend = vi.fn();
  const api = mount(Composer, { target, props: { onSend, onStop: () => {} } });
  live = api;
  flushSync();
  const textarea = target.querySelector('textarea')!;
  const type = (text: string) => {
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
  };
  const send = () => target.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const hint = () => target.querySelector<HTMLElement>('.limit-hint')!;
  return { target, textarea, type, send, hint, onSend, api: api as unknown as { prefill(t: string): void } };
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.replaceChildren();
});

describe('Composer message length cap', () => {
  it('exports the cap the backend enforces', () => {
    expect(MAX_MESSAGE_CHARS).toBe(8000);
    expect(MESSAGE_LIMIT_HINT_AT).toBeLessThan(MAX_MESSAGE_CHARS);
  });

  it('caps typing and pasting with maxlength', () => {
    const { textarea } = render();
    expect(textarea.getAttribute('maxlength')).toBe(String(MAX_MESSAGE_CHARS));
  });

  it('says nothing and describes nothing well below the limit', () => {
    const { textarea, type, hint, send } = render();
    type('Do you ship to Canada?');
    expect(hint().textContent!.trim()).toBe('');
    expect(textarea.hasAttribute('aria-describedby')).toBe(false);
    expect(send().disabled).toBe(false);
  });

  it('shows a calm hint near the limit, tied to the field', () => {
    const { textarea, type, hint, send } = render();
    type('a'.repeat(MESSAGE_LIMIT_HINT_AT));
    expect(hint().textContent!.trim()).toBe('Messages can be up to 8,000 characters.');
    expect(hint().getAttribute('role')).toBe('status');
    expect(textarea.getAttribute('aria-describedby')).toBe(hint().id);
    expect(textarea.hasAttribute('aria-live')).toBe(false);
    // At or under the cap it still sends.
    expect(send().disabled).toBe(false);
  });

  it('sends a message of exactly the limit', () => {
    const { type, send, onSend } = render();
    type('a'.repeat(MAX_MESSAGE_CHARS));
    send().click();
    flushSync();
    expect(onSend).toHaveBeenCalledWith('a'.repeat(MAX_MESSAGE_CHARS));
  });

  it('refuses to send over the limit (a prefill bypasses maxlength)', () => {
    const { type, send, onSend, textarea } = render();
    type('a'.repeat(MAX_MESSAGE_CHARS + 1));
    expect(send().disabled).toBe(true);
    // Enter is the other send path.
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    expect(onSend).not.toHaveBeenCalled();
  });
});
