// tests/contact.spec.ts — Email capture on pending decisions. Created
// 2026-07-30. Pins the ContactStore lifecycle against mocked fetch: the offer
// renders only for found+pending AND a not-yet-flagged visitor (the flag or a
// session dismissal skips the network entirely); submit success sets the
// per-widget flag + the quiet 'sent' state; 422 shows the inline correction;
// any other refusal dismisses silently; and — the privacy pin — the email
// value never lands in the persisted transcript row or anywhere else in
// storage.
import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from 'vitest';

import { hasContactFlag, setContactFlag } from '../src/lib/decision-contact';
import { saveTranscript } from '../src/lib/transcript';
import { ContactStore } from '../src/store/contact.svelte';
import { ChatStore, type Message } from '../src/store/chat.svelte';

const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };
const EMAIL = 'visitor@example.com';

const msg = (over: Partial<Message> = {}): Message => ({
  id: over.id ?? `m-${Math.random().toString(16).slice(2)}`,
  role: over.role ?? 'user',
  content: over.content ?? 'hello',
  status: over.status ?? 'done',
});

// This repo's vitest/jsdom ships a method-less localStorage — shim a
// Map-backed Storage (the workspace's standard fix) instead of chasing it.
let backing: Map<string, string>;
beforeEach(() => {
  backing = new Map<string, string>();
  const map = backing;
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

function decisionResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
  };
}

describe('ContactStore.maybeOffer', () => {
  it('offers when the decision is pending and the visitor is not flagged', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(decisionResponse({ found: true, state: 'pending', reply: '', decided_by: '' }));
    vi.stubGlobal('fetch', fetchMock);

    const store = new ContactStore(config);
    await store.maybeOffer();

    expect(store.status).toBe('offer');
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/paw-bar/events/w1/decision/');
    expect(url).toContain('signed_key=k1');
  });

  it('stays hidden for delivered / not-found / refused / network-dead backends', async () => {
    for (const mock of [
      vi.fn().mockResolvedValue(decisionResponse({ found: true, state: 'delivered' })),
      vi.fn().mockResolvedValue(decisionResponse({ found: false, state: '' })),
      vi.fn().mockResolvedValue(decisionResponse({}, 404)),
      vi.fn().mockRejectedValue(new TypeError('network down')),
    ]) {
      vi.stubGlobal('fetch', mock);
      const store = new ContactStore(config);
      await store.maybeOffer();
      expect(store.status).toBe('hidden');
    }
  });

  it('skips the network entirely when the visitor already left contact', async () => {
    setContactFlag('w1');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const store = new ContactStore(config);
    await store.maybeOffer();

    expect(store.status).toBe('hidden');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never re-offers after a dismiss, even on later pending turns', async () => {
    const fetchMock = vi.fn().mockResolvedValue(decisionResponse({ found: true, state: 'pending' }));
    vi.stubGlobal('fetch', fetchMock);

    const store = new ContactStore(config);
    await store.maybeOffer();
    expect(store.status).toBe('offer');

    store.dismiss();
    expect(store.status).toBe('hidden');

    await store.maybeOffer();
    expect(store.status).toBe('hidden');
    expect(fetchMock).toHaveBeenCalledTimes(1); // the dismissed session never re-polls
  });
});

describe('ContactStore.submit', () => {
  async function offeredStore(submitMock: Mock<(...args: unknown[]) => unknown>): Promise<ContactStore> {
    const fetchMock = vi.fn().mockImplementationOnce(() =>
      Promise.resolve(decisionResponse({ found: true, state: 'pending' })),
    );
    fetchMock.mockImplementation((...args: unknown[]) => submitMock(...args));
    vi.stubGlobal('fetch', fetchMock);
    const store = new ContactStore(config);
    await store.maybeOffer();
    expect(store.status).toBe('offer');
    return store;
  }

  it('success POSTs the exact contract body, sets the flag, and shows the quiet confirmation', async () => {
    const submitMock = vi.fn().mockResolvedValue(decisionResponse({ ok: true, attached: 1 }));
    const store = await offeredStore(submitMock);

    await store.submit(`  ${EMAIL} `);

    expect(store.status).toBe('sent');
    expect(hasContactFlag('w1')).toBe(true);
    const [url, opts] = submitMock.mock.calls[0];
    expect(String(url)).toBe('http://test.local/api/v1/paw-bar/decision-contact');
    expect(JSON.parse(opts.body)).toMatchObject({
      widget_id: 'w1',
      signed_key: 'k1',
      email: EMAIL,
    });
  });

  it('422 shows the inline error and keeps the offer up, unflagged', async () => {
    const submitMock = vi.fn().mockResolvedValue(decisionResponse({ detail: 'invalid_email' }, 422));
    const store = await offeredStore(submitMock);

    await store.submit('not-an-email');

    expect(store.emailError).toBe(true);
    expect(store.status).toBe('offer');
    expect(hasContactFlag('w1')).toBe(false);
  });

  it('any other refusal dismisses quietly without setting the flag', async () => {
    const submitMock = vi.fn().mockResolvedValue(decisionResponse({}, 429));
    const store = await offeredStore(submitMock);

    await store.submit(EMAIL);

    expect(store.status).toBe('hidden');
    expect(store.emailError).toBe(false);
    expect(hasContactFlag('w1')).toBe(false);
  });

  it('the email never lands in the transcript row or any stored value', async () => {
    saveTranscript('w1', [msg({ content: 'q' }), msg({ role: 'assistant', content: 'a' })]);
    const chat = new ChatStore(config);

    const submitMock = vi.fn().mockResolvedValue(decisionResponse({ ok: true, attached: 1 }));
    const store = await offeredStore(submitMock);
    await store.submit(EMAIL);
    expect(store.status).toBe('sent');

    expect(chat.messages.some((m) => m.content.includes(EMAIL))).toBe(false);
    for (const [key, value] of backing.entries()) {
      expect(value.includes(EMAIL), `stored value under ${key} leaked the email`).toBe(false);
      expect(key.includes(EMAIL), `storage key leaked the email`).toBe(false);
    }
  });
});
