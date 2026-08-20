// tests/articles.spec.ts — The "Browse articles" fetch. Created 2026-07-30.
// Pins fetchArticles against mocked fetch: the happy path hits the exact
// contract URL and returns validated rows; malformed rows, unsafe urls, and
// over-cap payloads are trimmed; and EVERY failure shape (refusal, network
// error, endpoint absent on an old backend, malformed body) returns [] so the
// panel shows the quiet empty state — a public widget never gets an error wall.
import { describe, it, expect, vi, afterEach } from 'vitest';

import { ARTICLES_CAP, fetchArticles } from '../src/lib/articles-client';

const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', signedKey: 'k1' };

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
  };
}

describe('fetchArticles', () => {
  it('fetches the contract URL and returns the validated list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        articles: [
          { title: 'Our story', url: 'https://cafe.example/story', snippet: 'How it began.' },
          { title: 'No snippet', url: 'https://cafe.example/plain' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const list = await fetchArticles(config);

    expect(list).toEqual([
      { title: 'Our story', url: 'https://cafe.example/story', snippet: 'How it began.' },
      { title: 'No snippet', url: 'https://cafe.example/plain', snippet: '' },
    ]);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://test.local/api/v1/paw-bar/articles?widget_id=w1&signed_key=k1');
    expect(opts.credentials).toBe('omit');
    expect(opts.mode).toBe('cors');
  });

  it('drops malformed rows and unsafe urls, and caps the list', async () => {
    const many = Array.from({ length: ARTICLES_CAP + 5 }, (_, i) => ({
      title: `Post ${i}`,
      url: `https://cafe.example/${i}`,
      snippet: '',
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          articles: [
            { title: 'Evil', url: 'javascript:alert(1)', snippet: 'x' },
            { title: '', url: 'https://cafe.example/untitled' },
            { url: 'https://cafe.example/no-title' },
            'garbage',
            null,
            { title: 'Numbers', url: 'https://cafe.example/n', snippet: 42 },
            ...many,
          ],
        }),
      ),
    );

    const list = await fetchArticles(config);

    expect(list).toHaveLength(ARTICLES_CAP);
    expect(list[0]).toEqual({ title: 'Numbers', url: 'https://cafe.example/n', snippet: '' });
    expect(list.every((a) => a.url.startsWith('https://'))).toBe(true);
  });

  it('returns [] for an empty list and for every failure shape', async () => {
    const cases = [
      vi.fn().mockResolvedValue(jsonResponse({ articles: [] })),
      vi.fn().mockResolvedValue(jsonResponse({}, 404)), // endpoint absent (old backend)
      vi.fn().mockResolvedValue(jsonResponse({}, 429)),
      vi.fn().mockResolvedValue(jsonResponse('not-an-object')),
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) }),
      vi.fn().mockRejectedValue(new TypeError('network down')),
    ];
    for (const mock of cases) {
      vi.stubGlobal('fetch', mock);
      expect(await fetchArticles(config)).toEqual([]);
    }
  });

  // Same shape as the sources bug: HomeTab and HelpTab both key their lists on
  // article.url, so two rows pointing at one page is a render-time throw.
  it('drops a repeated url', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          articles: [
            { title: 'Shipping', url: 'https://ocean.example/shipping', snippet: 'a' },
            { title: 'Shipping (v2)', url: 'https://ocean.example/shipping', snippet: 'b' },
            { title: 'Returns', url: 'https://ocean.example/returns', snippet: 'c' },
          ],
        }),
      ),
    );
    const list = await fetchArticles(config);
    expect(list.map((a) => a.url)).toEqual([
      'https://ocean.example/shipping',
      'https://ocean.example/returns',
    ]);
  });
});
