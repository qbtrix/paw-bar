// tests/visitor-tz.spec.ts — the visitor's timezone on every chat request.
// chat-client sends `tz` (an IANA zone name from Intl) so the concierge can
// offer booking slots in the visitor's own clock. Only a plausible zone name
// is sent; anything else leaves the key off the body (never null).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamConciergeChat, visitorTimeZone, type ChatCallbacks } from '../src/lib/chat-client';

const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', signedKey: 'k1', customerRef: 'c1' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function sentBody(): Promise<Record<string, unknown>> {
  const end = new TextEncoder().encode('event: stream_end\ndata: {}\n\n');
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream({ start: (c) => (c.enqueue(end), c.close()) }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  const cb: ChatCallbacks = { onChunk: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
  await streamConciergeChat(config, 'hello', cb);
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(String(init.body));
}

function stubZone(zone: unknown) {
  const real = Intl.DateTimeFormat;
  // A plain function, so the code under test can still call it with `new`.
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale?: string, opts?: Intl.DateTimeFormatOptions) {
    if (opts?.timeZone) return new real(locale, opts);
    return { resolvedOptions: () => ({ timeZone: zone }) } as unknown as Intl.DateTimeFormat;
  } as typeof Intl.DateTimeFormat);
}

describe('visitorTimeZone', () => {
  it('accepts real IANA names', () => {
    for (const z of ['Europe/Amsterdam', 'America/Argentina/Buenos_Aires', 'Asia/Kolkata', 'UTC', 'Etc/GMT+5']) {
      expect(visitorTimeZone(z), z).toBe(z);
    }
  });

  it('refuses anything that is not a plausible zone', () => {
    for (const z of ['', 'Mars/Olympus_Mons', 'Europe/Amsterdam<script>', '../../etc', 'a'.repeat(80), 42, null]) {
      expect(visitorTimeZone(z), String(z)).toBeNull();
    }
  });
});

describe('the chat request carries tz', () => {
  it("sends the runtime's zone", async () => {
    stubZone('Europe/Amsterdam');
    expect((await sentBody()).tz).toBe('Europe/Amsterdam');
  });

  it('leaves the key off when the runtime zone is unusable', async () => {
    stubZone('Not a zone');
    const body = await sentBody();
    expect('tz' in body).toBe(false);
    expect(body).toMatchObject({ widget_id: 'w1', message: 'hello' });
  });
});
