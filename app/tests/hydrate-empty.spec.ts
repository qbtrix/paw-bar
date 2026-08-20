// tests/hydrate-empty.spec.ts — an empty answer from the server must not erase
// the visitor's history. Created 2026-08-21.
//
// #hydrate treats `[]` as "the server says this thread really is empty" and
// adopts it over the restored cache. Two things make that a data-loss bug rather
// than a freshness policy:
//
//   1. saveTranscript() with an empty list REMOVES the row. So the adopted
//      emptiness is not just displayed, it is written back — the turns are gone
//      from the device too, and every later reload has nothing to restore.
//   2. `[]` is not a reliable "empty" signal. The messages endpoint finds runs by
//      session_key `cloud:concierge:<pocket>:<conversation_id>:<agent>`, but the
//      chat endpoint writes `conversation_key = conversation.id if conversation
//      is not None else body.customer_ref`. A turn recorded under the customer_ref
//      spelling — any turn whose conversation row was missing when it was written
//      — is invisible to a per-conversation read, which then answers 200 with an
//      empty list. The endpoint also documents `messages or []` for "a site with
//      transcripts off".
//
// So the widget asks "what do you have for this conversation", is told "nothing"
// for reasons that have nothing to do with whether the visitor talked, and
// deletes their conversation. A 404 is handled correctly already (null → keep
// the cache); it is the 200-with-nothing that destroys.
//
// The cache holding turns is itself evidence those turns happened. An empty
// answer can leave the panel as it is; it must never be the reason history is
// deleted.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatStore } from '../src/store/chat.svelte';
import { loadTranscript, saveTranscript, saveActiveConversationId } from '../src/lib/transcript';

const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };
const CONV = 'ppc-1a02105f807-cmpc';

const TURNS = [
  { id: 'a', role: 'user' as const, content: 'Hey', status: 'done' as const },
  { id: 'b', role: 'assistant' as const, content: 'Welcome to Darpan.', status: 'done' as const },
];

/** The reload the visitor performs: a stored thread, a pointer at it, and the
 *  server answering 200 with the given messages. */
function reload(serverMessages: unknown[]) {
  window.localStorage.clear();
  saveTranscript('w1', TURNS, CONV);
  saveActiveConversationId('w1', CONV);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: serverMessages }) }),
  );
  return new ChatStore(config);
}

const settle = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('hydrating a conversation the server reports as empty', () => {
  it('leaves the restored thread on screen', async () => {
    const store = reload([]);
    expect(store.messages).toHaveLength(2); // the cache painted

    await settle();

    expect(store.messages.map((m) => m.content)).toEqual(['Hey', 'Welcome to Darpan.']);
  });

  it('does not delete the row from the device', async () => {
    reload([]);

    await settle();

    expect(loadTranscript('w1', CONV)).toHaveLength(2);
  });

  it('still adopts a server answer that actually has turns', async () => {
    const store = reload([
      { role: 'user', content: 'Hey', created_at: '2026-08-20T21:18:00Z' },
      { role: 'assistant', content: 'Welcome to Darpan.', created_at: '2026-08-20T21:18:02Z' },
      { role: 'user', content: 'Where are you?', created_at: '2026-08-20T21:19:00Z' },
    ]);

    await settle();

    // The server is the record when it HAS the record — this is the whole point
    // of the read, and it must keep working.
    expect(store.messages).toHaveLength(3);
    expect(store.messages[2].content).toBe('Where are you?');
  });
});
