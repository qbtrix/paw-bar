// tests/page-actions-store.spec.ts — ChatStore and page actions. A reply's
// `action` frame is held until stream_end, attached to the reply and run then
// (never mid-stream, never on a stopped reply); the result sets the line's
// state; a navigate writes the arrival marker, and arrived(url) turns it into
// "Here's the page". No runner, or no host script, leaves a navigate as a link.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ChatStore } from '../src/store/chat.svelte';
import type { ActResult, PageAction } from '../src/lib/page-actions';

const enc = (s: string) => new TextEncoder().encode(s);
const CHUNK = 'event: chunk\ndata: {"content":"Here are the Cairn boots.","type":"text"}\n\n';
const END = 'event: stream_end\ndata: {"assistant_message_id":"m1","cancelled":false}\n\n';
const TO = 'https://shop.example.com/products/cairn-boot';
const NAV = { do: 'navigate', to: TO, label: 'Cairn boot' };
const actionFrame = (a: object) => `event: action\ndata: ${JSON.stringify({ type: 'action', action: a })}\n\n`;
const base = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc(p));
      c.close();
    },
  });
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function reply(...parts: string[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: streamOf(...parts) }));
}

describe('ChatStore page actions', () => {
  it('runs the action after stream_end and marks it done', async () => {
    reply(CHUNK + actionFrame(NAV) + END);
    let ranWhileStreaming: boolean | null = null;
    const store = new ChatStore({
      ...base,
      runAction: vi.fn(async (a: PageAction): Promise<ActResult> => {
        ranWhileStreaming = store.isStreaming;
        expect(a).toEqual(NAV);
        return { ok: true };
      }),
    });
    await store.send('boots?');
    await flush();
    expect(ranWhileStreaming).toBe(false);
    expect(store.messages[1].action).toEqual({ ...NAV, state: 'done' });
  });

  it('writes the arrival marker before a navigate, and arrived() says so once', async () => {
    reply(CHUNK + actionFrame(NAV) + END);
    let markerAtRun: string | null = null;
    const store = new ChatStore({
      ...base,
      runAction: async () => {
        markerAtRun = localStorage.getItem('pawbar.arrival.v1.w1');
        return { ok: true };
      },
    });
    await store.send('boots?');
    await flush();
    expect(markerAtRun).toContain(TO);

    // The navigation reloads the frame: a new store restores the thread.
    const after = new ChatStore({ ...base, runAction: async () => ({ ok: true }) });
    expect(after.messages[1].action?.state).toBe('done');
    expect(after.arrived('https://shop.example.com/')).toBe(false);
    expect(after.arrived(TO + '/')).toBe(true);
    expect(after.messages[1].action?.state).toBe('arrived');
    expect(after.arrived(TO)).toBe(false);
  });

  it('a not_found result says it could not, and clears the marker', async () => {
    reply(CHUNK + actionFrame(NAV) + END);
    const store = new ChatStore({ ...base, runAction: async () => ({ ok: false, error: 'not_found' }) });
    await store.send('boots?');
    await flush();
    expect(store.messages[1].action?.state).toBe('failed');
    expect(localStorage.getItem('pawbar.arrival.v1.w1')).toBeNull();
  });

  it('no host script: a navigate becomes a link, a highlight goes away', async () => {
    reply(CHUNK + actionFrame(NAV) + END);
    const store = new ChatStore({ ...base, runAction: async () => ({ ok: false, error: 'no_host' }) });
    await store.send('boots?');
    await flush();
    expect(store.messages[1].action?.state).toBe('fallback');

    reply(CHUNK + actionFrame({ do: 'highlight', target: '#returns', label: 'Returns' }) + END);
    await store.send('returns?');
    await flush();
    expect(store.messages[3].action).toBeUndefined();
  });

  it('without a runner a navigate is a link straight away', async () => {
    reply(CHUNK + actionFrame(NAV) + END);
    const store = new ChatStore(base);
    await store.send('boots?');
    expect(store.messages[1].action?.state).toBe('fallback');
  });

  it('keeps only the first action of a reply and ignores invalid ones', async () => {
    const run = vi.fn(async () => ({ ok: true }) as ActResult);
    reply(CHUNK + actionFrame({ do: 'click', label: 'x' }) + actionFrame(NAV) + actionFrame({ ...NAV, label: 'Second' }) + END);
    const store = new ChatStore({ ...base, runAction: run });
    await store.send('boots?');
    await flush();
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(NAV);
  });

  it('never runs an action on a reply without text or one that errored', async () => {
    const run = vi.fn(async () => ({ ok: true }) as ActResult);
    reply(actionFrame(NAV) + END);
    const store = new ChatStore({ ...base, runAction: run });
    await store.send('boots?');
    reply(CHUNK + actionFrame(NAV) + 'event: error\ndata: {}\n\n');
    await store.send('again?');
    await flush();
    expect(run).not.toHaveBeenCalled();
  });
});
