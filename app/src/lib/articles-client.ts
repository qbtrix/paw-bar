// articles-client.ts — Fetch the site's published articles for the panel's
// "Browse articles" view. Created 2026-07-30 (articles view). Sibling of
// action-client: one fetch, credentials omitted, CORS mode, no retry.
// Contract: GET {endpoint}/paw-bar/articles?widget_id=…&signed_key=…
//   → {"articles":[{title,url,snippet}…]} (≤ARTICLES_CAP), chat refusal shapes.
// EVERY failure — refusal, network error, endpoint absent on an old backend,
// malformed body — returns [] so the view shows the quiet empty state; a
// public widget never shows an error wall. Rows are validated like
// lib/sources: string titles, http(s) urls only (never a javascript: href),
// snippets coerced to strings.

export interface Article {
  title: string;
  url: string;
  snippet: string;
}

export const ARTICLES_CAP = 20;

export interface ArticlesConfig {
  endpoint: string;
  widgetId: string;
  signedKey: string;
}

function isHttpUrl(value: string): boolean {
  try {
    const proto = new URL(value).protocol;
    return proto === 'http:' || proto === 'https:';
  } catch {
    return false;
  }
}

export async function fetchArticles(config: ArticlesConfig, signal?: AbortSignal): Promise<Article[]> {
  const q = new URLSearchParams({ widget_id: config.widgetId, signed_key: config.signedKey });
  let res: Response;
  try {
    res = await fetch(`${config.endpoint.replace(/\/$/, '')}/paw-bar/articles?${q.toString()}`, {
      method: 'GET',
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      signal,
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  let data: { articles?: unknown };
  try {
    data = (await res.json()) as { articles?: unknown };
  } catch {
    return [];
  }
  if (!data || !Array.isArray(data.articles)) return [];
  const out: Article[] = [];
  for (const item of data.articles) {
    if (out.length >= ARTICLES_CAP) break;
    if (!item || typeof item !== 'object') continue;
    const row = item as { title?: unknown; url?: unknown; snippet?: unknown };
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    const url = typeof row.url === 'string' ? row.url.trim() : '';
    if (!title || !isHttpUrl(url)) continue;
    out.push({ title, url, snippet: typeof row.snippet === 'string' ? row.snippet : '' });
  }
  return out;
}
