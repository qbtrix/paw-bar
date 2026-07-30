// tests/quick-actions.spec.ts — The panel header's quick-actions contract.
// Created 2026-07-30. Pins the two testable halves of the Crisp-style menu:
// ChatStore.reset() ("New conversation") wipes the in-memory thread, the error,
// AND the persisted localStorage row; serializeTranscript ("Download
// transcript") produces the exact plain-text export as a pure function — the
// component's Blob/anchor download is a thin wrapper around it. Menu open/close
// lives as trivial view state inside GlassShell, so it isn't re-pinned here.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { loadTranscript, saveTranscript, serializeTranscript } from '../src/lib/transcript';
import { ChatStore, type Message } from '../src/store/chat.svelte';

const msg = (over: Partial<Message> = {}): Message => ({
  id: over.id ?? `m-${Math.random().toString(16).slice(2)}`,
  role: over.role ?? 'user',
  content: over.content ?? 'hello',
  status: over.status ?? 'done',
});

// This repo's vitest/jsdom ships a method-less localStorage — shim a
// Map-backed Storage (the workspace's standard fix) instead of chasing it.
beforeEach(() => {
  const map = new Map<string, string>();
  const shim = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  vi.stubGlobal('localStorage', shim);
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChatStore.reset (new conversation)', () => {
  const config = { endpoint: 'http://t.local', widgetId: 'w1', siteKey: 'k1' };

  it('clears the messages, the error, and the persisted row', () => {
    saveTranscript('w1', [msg({ content: 'q' }), msg({ role: 'assistant', content: 'a' })]);
    const store = new ChatStore(config);
    expect(store.messages).toHaveLength(2); // hydrated — the row exists
    store.error = 'stale error';

    store.reset();

    expect(store.messages).toEqual([]);
    expect(store.error).toBeNull();
    expect(store.isStreaming).toBe(false);
    expect(window.localStorage.getItem('pawbar.transcript.v1.w1')).toBeNull();
    // A fresh store (= an iframe reload) starts empty too — nothing rehydrates.
    expect(new ChatStore(config).messages).toEqual([]);
  });

  it('leaves a sibling widget row alone', () => {
    saveTranscript('w1', [msg()]);
    saveTranscript('w2', [msg({ content: 'other site' })]);
    new ChatStore(config).reset();
    expect(loadTranscript('w2')).toHaveLength(1);
  });
});

describe('serializeTranscript (download transcript)', () => {
  it('produces the header + Visitor/Concierge lines with a blank line per turn', () => {
    const text = serializeTranscript(
      [
        msg({ content: 'Do you deliver?' }),
        msg({ role: 'assistant', content: 'Yes, within 5 miles.' }),
        msg({ content: 'Great, thanks!' }),
      ],
      'Concierge',
      new Date('2026-07-30T12:00:00Z'),
    );
    expect(text).toBe(
      'Concierge conversation — 2026-07-30\n' +
        '\n' +
        'Visitor: Do you deliver?\n' +
        'Concierge: Yes, within 5 miles.\n' +
        '\n' +
        'Visitor: Great, thanks!\n',
    );
  });

  it('skips empty turns and serializes an empty thread to the header alone', () => {
    const withEmpty = serializeTranscript(
      [msg({ content: 'q' }), msg({ role: 'assistant', content: '', status: 'error' })],
      'Concierge',
      new Date('2026-07-30T12:00:00Z'),
    );
    expect(withEmpty).toBe('Concierge conversation — 2026-07-30\n\nVisitor: q\n');
    expect(serializeTranscript([], 'Concierge', new Date('2026-07-30T12:00:00Z'))).toBe(
      'Concierge conversation — 2026-07-30\n\n',
    );
  });
});
