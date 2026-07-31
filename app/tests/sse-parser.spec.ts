// tests/sse-parser.spec.ts — Unit coverage for the ported concierge SSE
// plumbing. Created 2026-07-15 (A3 glass bar): the same cases T4 pins for the
// frozen widget (feat/paw-bar-chat-ui:tests/sse-parser.spec.ts), re-homed onto
// vitest. Exercises the pure sse.ts frame parser against the exact wire shape
// ee/paw_bar/router.py::_sse writes (id/event/data lines, `: ping` heartbeats,
// frames split across chunk boundaries) and the chat-client dispatchFrame
// routing (chunk → onChunk, stream_end/error/interrupted terminal).
import { describe, it, expect, vi } from 'vitest';
import { createSseParser } from '../src/lib/sse';
import { dispatchFrame, type ChatCallbacks } from '../src/lib/chat-client';

const CHUNK = 'id: e1\nevent: chunk\ndata: {"content":"We open at 8am!","type":"text"}\n\n';
const END = 'id: e2\nevent: stream_end\ndata: {"assistant_message_id":"m1","cancelled":false}\n\n';
const PERSISTED = 'event: message.persisted\ndata: {"run_id":"r1","client_message_id":"c1"}\n\n';
const PING = ': ping\n\n';

describe('createSseParser', () => {
  it('parses persisted, chunk, then stream_end from a single push', () => {
    const frames = createSseParser().push(PERSISTED + CHUNK + END);
    expect(frames.map((f) => f.event)).toEqual(['message.persisted', 'chunk', 'stream_end']);
    expect(JSON.parse(frames[1].data)).toMatchObject({ content: 'We open at 8am!', type: 'text' });
    expect(frames[1].id).toBe('e1');
  });

  it('buffers a frame split across two chunk boundaries', () => {
    const parser = createSseParser();
    const whole = CHUNK + END;
    const cut = 20;
    const first = parser.push(whole.slice(0, cut));
    const second = parser.push(whole.slice(cut));
    expect(first).toEqual([]);
    expect(second.map((f) => f.event)).toEqual(['chunk', 'stream_end']);
  });

  it('drops `: ping` heartbeats (no data → no frame)', () => {
    const frames = createSseParser().push(PING + CHUNK);
    expect(frames.map((f) => f.event)).toEqual(['chunk']);
  });

  it('normalizes CRLF line endings', () => {
    const crlf = CHUNK.replace(/\n/g, '\r\n');
    const frames = createSseParser().push(crlf);
    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0].data)).toMatchObject({ content: 'We open at 8am!' });
  });
});

function callbacks(): ChatCallbacks & { chunks: string[]; ended: unknown[]; errors: string[] } {
  const chunks: string[] = [];
  const ended: unknown[] = [];
  const errors: string[] = [];
  return {
    chunks,
    ended,
    errors,
    onChunk: (d) => chunks.push(d),
    onEnd: (i) => ended.push(i),
    onError: (m) => errors.push(m),
  };
}

describe('dispatchFrame', () => {
  it('routes a text chunk to onChunk and keeps reading', () => {
    const cb = callbacks();
    const keep = dispatchFrame({ event: 'chunk', data: '{"content":"hi","type":"text"}' }, cb);
    expect(keep).toBe(true);
    expect(cb.chunks).toEqual(['hi']);
  });

  it('suppresses a non-text chunk (thinking must not leak)', () => {
    const cb = callbacks();
    dispatchFrame({ event: 'chunk', data: '{"content":"secret","type":"thinking"}' }, cb);
    expect(cb.chunks).toEqual([]);
  });

  it('treats an untyped chunk as text', () => {
    const cb = callbacks();
    dispatchFrame({ event: 'chunk', data: '{"content":"plain"}' }, cb);
    expect(cb.chunks).toEqual(['plain']);
  });

  it('finalizes on stream_end and stops reading', () => {
    const cb = callbacks();
    const keep = dispatchFrame({ event: 'stream_end', data: '{"assistant_message_id":"m9"}' }, cb);
    expect(keep).toBe(false);
    expect(cb.ended).toEqual([{ assistant_message_id: 'm9', cancelled: undefined }]);
  });

  it('routes error + interrupted to onError and stops', () => {
    const cb = callbacks();
    expect(dispatchFrame({ event: 'error', data: '{"message":"boom"}' }, cb)).toBe(false);
    expect(dispatchFrame({ event: 'interrupted', data: '' }, cb)).toBe(false);
    expect(cb.errors).toEqual(['boom', 'The reply was interrupted.']);
  });

  it('ignores unknown/persisted events without touching callbacks', () => {
    const cb = callbacks();
    const spyEnd = vi.spyOn(cb, 'onEnd');
    expect(dispatchFrame({ event: 'message.persisted', data: '{}' }, cb)).toBe(true);
    expect(spyEnd).not.toHaveBeenCalled();
  });
});
