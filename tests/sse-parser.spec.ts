// tests/sse-parser.spec.ts — Unit coverage for the concierge chat SSE plumbing.
// Created: 2026-07-14 (Paw Bar chat UI, T4) — pure Node tests (no browser, no live
//   backend): the sse.ts frame parser against the exact wire shape
//   ee/paw_bar/router.py::_sse writes (id/event/data lines, `: ping` heartbeats,
//   frames split across chunk boundaries) and the chat-client dispatchFrame
//   routing (chunk → onChunk, stream_end/error/interrupted terminal).

import { test, expect } from '@playwright/test';
import { createSseParser } from '../src/sse';
import { dispatchFrame, type ChatCallbacks } from '../src/chat-client';

// A realistic stream: run announced, one text chunk, a heartbeat, then the end —
// exactly the frame shapes concierge_chat's gen() emits.
const CHUNK = 'id: e1\nevent: chunk\ndata: {"content":"We open at 8am!","type":"text"}\n\n';
const END = 'id: e2\nevent: stream_end\ndata: {"assistant_message_id":"m1","cancelled":false}\n\n';
const PERSISTED = 'event: message.persisted\ndata: {"run_id":"r1","client_message_id":"c1"}\n\n';
const PING = ': ping\n\n';

test.describe('createSseParser', () => {
  test('parses chunk then stream_end from a single push', () => {
    const parser = createSseParser();
    const frames = parser.push(PERSISTED + CHUNK + END);

    expect(frames.map((f) => f.event)).toEqual(['message.persisted', 'chunk', 'stream_end']);
    expect(JSON.parse(frames[1].data)).toMatchObject({ content: 'We open at 8am!', type: 'text' });
    expect(JSON.parse(frames[2].data)).toMatchObject({ assistant_message_id: 'm1' });
    expect(frames[1].id).toBe('e1');
  });

  test('buffers a frame split across two chunk boundaries', () => {
    const parser = createSseParser();
    const whole = CHUNK + END;
    const cut = 20; // mid-frame byte boundary
    const first = parser.push(whole.slice(0, cut));
    const second = parser.push(whole.slice(cut));

    // Nothing completes until the first frame's blank line arrives.
    expect(first).toEqual([]);
    expect(second.map((f) => f.event)).toEqual(['chunk', 'stream_end']);
  });

  test('ignores `: ping` heartbeat frames', () => {
    const parser = createSseParser();
    const frames = parser.push(PING + CHUNK + PING);
    expect(frames.map((f) => f.event)).toEqual(['chunk']);
  });

  test('joins multi-line data with a newline', () => {
    const parser = createSseParser();
    const frames = parser.push('event: chunk\ndata: line one\ndata: line two\n\n');
    expect(frames[0].data).toBe('line one\nline two');
  });

  test('normalizes CRLF line endings', () => {
    const parser = createSseParser();
    const frames = parser.push('event: chunk\r\ndata: {"content":"hi"}\r\n\r\n');
    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0].data)).toMatchObject({ content: 'hi' });
  });
});

function spyCallbacks(): { cb: ChatCallbacks; chunks: string[]; ended: number; errors: string[] } {
  const chunks: string[] = [];
  const errors: string[] = [];
  let ended = 0;
  const cb: ChatCallbacks = {
    onChunk: (d) => chunks.push(d),
    onEnd: () => {
      ended += 1;
    },
    onError: (m) => errors.push(m),
  };
  return {
    cb,
    chunks,
    get ended() {
      return ended;
    },
    errors,
  };
}

test.describe('dispatchFrame', () => {
  test('a chunk frame appends its content and keeps reading', () => {
    const s = spyCallbacks();
    const terminal = dispatchFrame({ event: 'chunk', data: '{"content":"Hi","type":"text"}' }, s.cb);
    expect(terminal).toBe(true); // not terminal — keep the stream open
    expect(s.chunks).toEqual(['Hi']);
  });

  test('a non-text chunk is not appended to a public reply', () => {
    const s = spyCallbacks();
    dispatchFrame({ event: 'chunk', data: '{"content":"secret plan","type":"thinking"}' }, s.cb);
    expect(s.chunks).toEqual([]);
  });

  test('stream_end finalizes and stops reading', () => {
    const s = spyCallbacks();
    const cont = dispatchFrame({ event: 'stream_end', data: '{"assistant_message_id":"m1"}' }, s.cb);
    expect(cont).toBe(false);
    expect(s.ended).toBe(1);
  });

  test('an error frame surfaces its message and stops reading', () => {
    const s = spyCallbacks();
    const cont = dispatchFrame({ event: 'error', data: '{"message":"rate limited"}' }, s.cb);
    expect(cont).toBe(false);
    expect(s.errors).toEqual(['rate limited']);
  });

  test('message.persisted is ignored and keeps reading', () => {
    const s = spyCallbacks();
    const cont = dispatchFrame({ event: 'message.persisted', data: '{"run_id":"r1"}' }, s.cb);
    expect(cont).toBe(true);
    expect(s.chunks).toEqual([]);
    expect(s.errors).toEqual([]);
  });
});
