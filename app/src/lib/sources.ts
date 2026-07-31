// sources.ts — Shared validation for per-reply source citations. Created
// 2026-07-30 (sources on replies): the chat stream's optional `event: sources`
// frame and the persisted transcript rows both carry untrusted
// server/agent-authored {title, url} pairs, so one sanitizer gates BOTH entry
// points: strings only, http(s) URLs only (a javascript: or data: URL must
// never become an href on the public origin), capped at SOURCES_CAP. Pure —
// no DOM, no fetch — so it unit-tests beside the SSE parser.

export interface Source {
  title: string;
  url: string;
}

export const SOURCES_CAP = 3;

function isHttpUrl(value: string): boolean {
  try {
    const proto = new URL(value).protocol;
    return proto === 'http:' || proto === 'https:';
  } catch {
    return false;
  }
}

/** Coerce an unknown payload (SSE frame data or a stored transcript row) into
 *  a safe Source list. Anything malformed is dropped, never thrown on. */
export function sanitizeSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  const out: Source[] = [];
  for (const item of value) {
    if (out.length >= SOURCES_CAP) break;
    if (!item || typeof item !== 'object') continue;
    const title = typeof (item as { title?: unknown }).title === 'string' ? (item as { title: string }).title.trim() : '';
    const url = typeof (item as { url?: unknown }).url === 'string' ? (item as { url: string }).url.trim() : '';
    if (!title || !isHttpUrl(url)) continue;
    out.push({ title, url });
  }
  return out;
}
