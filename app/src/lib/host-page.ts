// host-page.ts — The page the bar is embedded on, as the concierge should see it.
// Created 2026-09-27 (CR-7, "the loader sends the page"): the frame is a
// cross-origin document and cannot read the host page, so the LOADER posts
// {pawbar:page, url, title} into it on load (loader/src/loader.ts). BarShell
// hands that message here; chat-client reads getHostPage() and sends it as
// `page` on every POST /paw-bar/chat.
//
// The loader already strips the query string and hash, and this module strips
// them again: the message is still input from another document, and a token or
// email in a query string must never reach our API even from an older or
// tampered loader. Only http(s) URLs survive. The title is trimmed and clipped
// to HOST_TITLE_MAX. Nothing received means null, and chat-client then leaves
// the field off the request entirely (no nulls on the wire).

export interface HostPage {
  url: string;
  title: string;
}

export const HOST_TITLE_MAX = 120;

let current: HostPage | null = null;

/** Coerce an untrusted {url, title} into a HostPage, or null. Never throws. */
export function normalizeHostPage(value: unknown): HostPage | null {
  if (!value || typeof value !== 'object') return null;
  const { url, title } = value as { url?: unknown; title?: unknown };
  if (typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return {
    url: parsed.origin + parsed.pathname,
    title: typeof title === 'string' ? title.trim().slice(0, HOST_TITLE_MAX) : '',
  };
}

/** Record what the loader said. A malformed message keeps the last good page. */
export function setHostPage(value: unknown): void {
  const page = normalizeHostPage(value);
  if (page) current = page;
}

export function getHostPage(): HostPage | null {
  return current;
}

/** Tests only: forget the page between cases. */
export function resetHostPage(): void {
  current = null;
}
