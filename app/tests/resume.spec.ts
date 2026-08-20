// tests/resume.spec.ts — a returning visitor gets their thread back.
// Created 2026-08-21 from a live report: "i had a chat but i don't see my chat
// history". The captain's localStorage carried the whole diagnosis.
//
// Dump 1 (accumulated over days) — the active pointer names a conversation that
// has no stored row, while two OTHER conversations hold the turns:
//     pawbar.active.v1.<w>                    ppc-1a02105f807-cmpc
//     pawbar.transcript.v2.<w>.ppc-1a01f616d7c-mxgl   {2 turns}
//     pawbar.transcript.v2.<w>.ppc-1a0204946ed-r5vb   {2 turns}
//
// Dump 2 (after clearing storage, one fresh chat) — the row is filed under the
// SENTINEL, and no pointer was ever written:
//     pawbar.transcript.v2.<w>.active         {2 turns}
//
// Dump 2 is how dump 1 is built. A turn sent before the conversation list has
// loaded is persisted under key(widgetId, '') — the literal ".active" — because
// the store has no id yet. When the list finally names the conversation,
// adoptConversation() takes the id and writes the pointer but leaves the turns
// behind under the sentinel. The next reload resumes the named conversation,
// finds nothing filed under it, and paints an empty panel: pointer to one place,
// turns in another. Repeat, and you get dump 1.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatStore } from '../src/store/chat.svelte';
import { loadTranscript, saveTranscript } from '../src/lib/transcript';

const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };

beforeEach(() => {
  window.localStorage.clear();
  // The server read is a separate concern and is NOT the safety net here: the
  // site owner can switch transcript retention off, Safari blocks this frame's
  // storage outright, and the deployed bundle predates the hydrate entirely.
  // A failed read returns null and leaves the cache alone, which is exactly the
  // state this file is about.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const TURNS = [
  { id: '0b6fe659', role: 'user' as const, content: 'Hey', status: 'done' as const },
  { id: 'f90e2bc3', role: 'assistant' as const, content: 'Hey there! Welcome to Darpan.', status: 'done' as const },
];

describe('a thread started before the conversation had a name', () => {
  it('is filed under the sentinel, exactly as the captain saw', () => {
    // What the widget does today when a turn is sent before the list loads.
    saveTranscript('w1', TURNS, '');

    expect(window.localStorage.getItem('pawbar.transcript.v2.w1.active')).toBeTruthy();
  });

  it('survives being adopted by the conversation the server names', () => {
    saveTranscript('w1', TURNS, '');
    const store = new ChatStore(config);
    expect(store.messages).toHaveLength(2); // the cache paints, so far so good

    // The Messages list lands and names the conversation in progress.
    store.adoptConversation('ppc-1a02105f807-cmpc');

    // THE BUG: the turns must move with the id. Otherwise the pointer names a
    // conversation whose row is empty and the sentinel row is orphaned.
    expect(loadTranscript('w1', 'ppc-1a02105f807-cmpc')).toHaveLength(2);
  });

  it('is still there after the reload that adoption sets up', () => {
    saveTranscript('w1', TURNS, '');
    const first = new ChatStore(config);
    first.adoptConversation('ppc-1a02105f807-cmpc');

    // The iframe reloads on every host-page navigation — this is the common
    // case, not an edge one.
    const second = new ChatStore(config);

    expect(second.conversationId).toBe('ppc-1a02105f807-cmpc');
    expect(second.messages.map((m) => m.content)).toEqual([
      'Hey',
      'Hey there! Welcome to Darpan.',
    ]);
  });

  it('does not strand the sentinel row for the NEXT conversation to inherit', () => {
    saveTranscript('w1', TURNS, '');
    new ChatStore(config).adoptConversation('ppc-first');

    // A second visitor-session adopting a different id must not pick up turns
    // that already belong to ppc-first — the same once-only rule the v1 legacy
    // migration follows.
    const later = new ChatStore({ ...config });
    later.adoptConversation('ppc-second');

    expect(loadTranscript('w1', 'ppc-second')).toEqual([]);
  });
});
