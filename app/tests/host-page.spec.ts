// tests/host-page.spec.ts — the host page the bar sits on, as it goes out on
// every chat request. Created 2026-09-27 (CR-7, "the loader sends the page").
// The loader posts {pawbar:page, url, title} into the frame; lib/host-page
// normalizes it (origin + pathname only, title clipped to 120) and
// chat-client adds it to the POST /paw-bar/chat body as `page`. With nothing
// received, the key is absent from the body, never null. Also pins that the
// stream tolerates a `sources` frame in the CR-3 shape ({items:[{id,title,url}]})
// and any unknown event without breaking the turn.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getHostPage,
  normalizeHostPage,
  resetHostPage,
  setHostPage,
  HOST_TITLE_MAX,
} from '../src/lib/host-page';
import { dispatchFrame, streamConciergeChat, type ChatCallbacks } from '../src/lib/chat-client';

const config = {
  endpoint: 'http://test.local/api/v1',
  widgetId: 'w1',
  signedKey: 'k1',
  customerRef: 'c1',
};
const enc = (s: string) => new TextEncoder().encode(s);
function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc(p));
      c.close();
    },
  });
}
const END = 'event: stream_end\ndata: {}\n\n';

function callbacks(): ChatCallbacks & { [k: string]: ReturnType<typeof vi.fn> } {
  return {
    onChunk: vi.fn(),
    onEnd: vi.fn(),
    onError: vi.fn(),
    onSources: vi.fn(),
    onHumanReplying: vi.fn(),
  };
}

async function sentBody(): Promise<Record<string, unknown>> {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, body: streamOf(END) }));
  vi.stubGlobal('fetch', fetchMock);
  await streamConciergeChat(config, 'hello', callbacks());
  const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
  return JSON.parse(String(calls[0][1].body));
}

afterEach(() => {
  resetHostPage();
  vi.unstubAllGlobals();
});

describe('normalizeHostPage', () => {
  it('keeps origin + pathname and drops the query string and hash', () => {
    expect(
      normalizeHostPage({ url: 'https://shop.example.com/p/boots?token=abc&email=a@b.c#reviews', title: 'Boots' }),
    ).toEqual({ url: 'https://shop.example.com/p/boots', title: 'Boots' });
  });

  it('clips the title to 120 characters and trims it', () => {
    const page = normalizeHostPage({ url: 'https://shop.example.com/', title: '  ' + 'x'.repeat(300) });
    expect(HOST_TITLE_MAX).toBe(120);
    expect(page?.title).toBe('x'.repeat(120));
  });

  it('clips by code point, never splitting an emoji into a lone surrogate', () => {
    const page = normalizeHostPage({ url: 'https://shop.example.com/', title: 'x'.repeat(119) + '\u{1F97E}tail' });
    expect(page?.title).toBe('x'.repeat(119) + '\u{1F97E}');
    // No lone surrogate anywhere in the clipped title.
    expect(page?.title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it('drops a lone surrogate left by the loader cutting an emoji at 120', () => {
    // The loader clips by UTF-16 unit (bytes are scarce there), so its title
    // can end in half an emoji.
    const page = normalizeHostPage({ url: 'https://shop.example.com/', title: 'x'.repeat(119) + '\uD83E' });
    expect(page?.title).toBe('x'.repeat(119));
  });

  it('keeps a page with no title as an empty string, never null', () => {
    expect(normalizeHostPage({ url: 'https://shop.example.com/a' })).toEqual({
      url: 'https://shop.example.com/a',
      title: '',
    });
  });

  it('rejects anything that is not an http(s) page', () => {
    expect(normalizeHostPage(null)).toBeNull();
    expect(normalizeHostPage('https://shop.example.com/')).toBeNull();
    expect(normalizeHostPage({ url: 'javascript:alert(1)', title: 't' })).toBeNull();
    expect(normalizeHostPage({ url: 'not a url', title: 't' })).toBeNull();
    expect(normalizeHostPage({ url: 42, title: 't' })).toBeNull();
  });

  it('a bad message does not wipe a good page already received', () => {
    setHostPage({ url: 'https://shop.example.com/a', title: 'A' });
    setHostPage({ url: 'ftp://x/y' });
    expect(getHostPage()).toEqual({ url: 'https://shop.example.com/a', title: 'A' });
  });
});

describe('the chat request carries the host page', () => {
  it('sends page {url, title} with no query or hash', async () => {
    setHostPage({ url: 'https://shop.example.com/cart?session=s3cr3t#step-2', title: 'Your cart' });
    const body = await sentBody();
    expect(body.page).toEqual({ url: 'https://shop.example.com/cart', title: 'Your cart' });
    expect(JSON.stringify(body)).not.toContain('s3cr3t');
    expect(JSON.stringify(body)).not.toContain('step-2');
    // Everything the server already reads is still there.
    expect(body).toMatchObject({ widget_id: 'w1', signed_key: 'k1', customer_ref: 'c1', message: 'hello' });
  });

  it('clips a long title on the wire', async () => {
    setHostPage({ url: 'https://shop.example.com/', title: 'y'.repeat(500) });
    const body = await sentBody();
    expect((body.page as { title: string }).title).toHaveLength(120);
  });

  it('omits the field entirely when the page is unknown', async () => {
    const body = await sentBody();
    expect('page' in body).toBe(false);
  });
});

describe('stream tolerance', () => {
  it('routes a CR-3 `sources` frame ({items:[{id,title,url}]}) to onSources', () => {
    const cb = callbacks();
    const cont = dispatchFrame(
      {
        event: 'sources',
        data: JSON.stringify({ items: [{ id: 'kb1', title: 'Returns policy', url: 'https://shop.example.com/returns' }] }),
      },
      cb,
    );
    expect(cont).toBe(true);
    expect(cb.onSources).toHaveBeenCalledWith([{ title: 'Returns policy', url: 'https://shop.example.com/returns' }]);
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('a malformed `sources` frame is ignored, not an error', () => {
    const cb = callbacks();
    expect(dispatchFrame({ event: 'sources', data: '{not json' }, cb)).toBe(true);
    expect(dispatchFrame({ event: 'sources', data: '{"items":"nope"}' }, cb)).toBe(true);
    expect(cb.onSources).not.toHaveBeenCalled();
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('a whole stream with sources and an unknown event still finishes the turn', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: streamOf(
        'event: chunk\ndata: {"content":"Hi","type":"text"}\n\n',
        'event: brand_new_thing\ndata: {"x":1}\n\n',
        'event: sources\ndata: {"items":[{"id":"a","title":"A","url":"https://s.example/a"}]}\n\n',
        END,
      ),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const cb = callbacks();
    await streamConciergeChat(config, 'q', cb);
    expect(cb.onChunk).toHaveBeenCalledWith('Hi');
    expect(cb.onSources).toHaveBeenCalledTimes(1);
    expect(cb.onEnd).toHaveBeenCalledTimes(1);
    expect(cb.onError).not.toHaveBeenCalled();
  });
});
