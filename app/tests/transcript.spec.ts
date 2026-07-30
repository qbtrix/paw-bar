// tests/transcript.spec.ts — Conversation-continuity persistence. Created
// 2026-07-30 (UX gap: reopening the bar showed an empty transcript). Pins the
// lib/transcript contract (round-trip, per-widget namespacing, cap, TTL
// expiry, malformed-row deletion, streaming-status coercion) and the
// ChatStore's constructor hydrate. jsdom provides localStorage.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import {
  loadTranscript,
  saveTranscript,
  clearTranscript,
  TRANSCRIPT_CAP,
  TRANSCRIPT_TTL_MS,
} from '../src/lib/transcript';
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('transcript persistence', () => {
  it('round-trips a thread per widget', () => {
    saveTranscript('w1', [msg({ content: 'hi' }), msg({ role: 'assistant', content: 'hello!' })]);
    const restored = loadTranscript('w1');
    expect(restored).toHaveLength(2);
    expect(restored[0].content).toBe('hi');
    expect(restored[1].role).toBe('assistant');
    // Sibling widget on the same (shared frame) origin sees nothing.
    expect(loadTranscript('w2')).toEqual([]);
  });

  it('drops streaming turns on save and coerces statuses on load', () => {
    saveTranscript('w1', [
      msg({ content: 'q' }),
      msg({ role: 'assistant', content: 'partial', status: 'streaming' }),
    ]);
    const restored = loadTranscript('w1');
    expect(restored).toHaveLength(1); // the streaming turn was not persisted
    expect(restored.every((m) => m.status !== 'streaming')).toBe(true);
  });

  it('caps the stored thread', () => {
    const many = Array.from({ length: TRANSCRIPT_CAP + 20 }, (_, i) =>
      msg({ id: `m-${i}`, content: `turn ${i}` }),
    );
    saveTranscript('w1', many);
    const restored = loadTranscript('w1');
    expect(restored).toHaveLength(TRANSCRIPT_CAP);
    expect(restored.at(-1)?.content).toBe(`turn ${TRANSCRIPT_CAP + 19}`);
  });

  it('expires after the TTL and deletes the row', () => {
    vi.useFakeTimers();
    saveTranscript('w1', [msg()]);
    vi.setSystemTime(Date.now() + TRANSCRIPT_TTL_MS + 1000);
    expect(loadTranscript('w1')).toEqual([]);
    expect(window.localStorage.getItem('pawbar.transcript.v1.w1')).toBeNull();
  });

  it('deletes a malformed row instead of throwing', () => {
    window.localStorage.setItem('pawbar.transcript.v1.w1', '{not json');
    expect(loadTranscript('w1')).toEqual([]);
    expect(window.localStorage.getItem('pawbar.transcript.v1.w1')).toBeNull();
  });

  it('clearTranscript removes the row', () => {
    saveTranscript('w1', [msg()]);
    clearTranscript('w1');
    expect(loadTranscript('w1')).toEqual([]);
  });
});

describe('ChatStore hydrate', () => {
  it('constructor restores the persisted thread for its widget', () => {
    saveTranscript('w1', [msg({ content: 'earlier question' }), msg({ role: 'assistant', content: 'earlier answer' })]);
    const store = new ChatStore({ endpoint: 'http://t.local', widgetId: 'w1', siteKey: 'k1' });
    expect(store.messages).toHaveLength(2);
    expect(store.messages[1].content).toBe('earlier answer');
    expect(store.isStreaming).toBe(false);
  });

  it('constructor starts empty for a widget with no history', () => {
    const store = new ChatStore({ endpoint: 'http://t.local', widgetId: 'w-fresh', siteKey: 'k1' });
    expect(store.messages).toEqual([]);
  });
});
