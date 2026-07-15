// loader/src/loader.ts — Paw Bar glass-bar loader (A2).
// Created 2026-07-15: the ~2KB zero-dependency IIFE a foreign site pastes in to
// embed the glass concierge. It finds its own <script> tag, reads the embed
// config off it (data-site-key / data-widget-id / data-endpoint), computes the
// host (parent) origin, and mounts a fixed bottom-right iframe pointing at the
// A1 frame endpoint (/paw-bar/frame?key=&w=&po=). The loader owns ONLY the
// launcher chrome + iframe sizing; the glass app (A3) renders INSIDE the iframe
// and drives open/close/resize via postMessage.
//
// SECURITY: inbound messages are honoured ONLY when event.origin === the frame
// origin AND event.source === the iframe's own contentWindow. Every outbound
// post pins targetOrigin to the frame origin — never "*". Idempotent; exposes
// window.PawBar = { open, close } for programmatic control.

const LOADED_FLAG = '__pawBarLoaderLoaded';
const FRAME_PATH = '/paw-bar/frame';

// Launcher chrome boxes (px). The loader owns these; the app reports its content
// height via {pawbar:resize,h} and toggles state via {pawbar:open|close}.
const COLLAPSED = { w: 300, h: 96 };
const EXPANDED = { w: 420, h: 640 };
const MIN_H = 48;
const VIEWPORT_MARGIN = 24; // keep the box off the very edge on small screens

interface PawBarApi {
  open(): void;
  close(): void;
}

type LoaderWindow = Window &
  typeof globalThis & { PawBar?: PawBarApi; [key: string]: unknown };

(function bootstrap(win: LoaderWindow): void {
  // Idempotent: a duplicate paste / double-include must be a silent no-op.
  if (win[LOADED_FLAG]) return;

  const doc = win.document;

  // 1. Locate our own <script> tag and read the embed config off it.
  const script =
    (doc.currentScript as HTMLScriptElement | null) ??
    lastScriptWith('data-site-key', doc);
  if (!script) return;

  const siteKey = attr(script, 'data-site-key');
  const widgetId = attr(script, 'data-widget-id');
  if (!siteKey || !widgetId) {
    // Missing required config — fail quietly; embedders find it in the console.
    warn('missing data-site-key or data-widget-id');
    return;
  }

  const endpoint = normalizeEndpoint(
    attr(script, 'data-endpoint') || originOf(script.src) + '/api/v1',
  );
  let frameOrigin: string;
  try {
    frameOrigin = new URL(endpoint).origin;
  } catch {
    warn('invalid data-endpoint');
    return;
  }

  // Mark loaded only after the config validates, so a broken first include does
  // not block a corrected second one.
  win[LOADED_FLAG] = true;

  // 2. The origin the iframe must post back to is the host page's origin.
  const parentOrigin = resolveParentOrigin(win);

  // 3. Build the frame URL and mount the collapsed iframe.
  const src =
    endpoint +
    FRAME_PATH +
    '?key=' +
    encodeURIComponent(siteKey) +
    '&w=' +
    encodeURIComponent(widgetId) +
    '&po=' +
    encodeURIComponent(parentOrigin);

  const iframe = doc.createElement('iframe');
  iframe.title = 'Site concierge';
  iframe.setAttribute('allow', 'clipboard-write');
  // Inline styles are required here: the loader runs on a foreign page and must
  // neither depend on nor inject a stylesheet. One fixed, borderless, bottom-
  // right box; max-*:100v* is a CSS safety net so it can never exceed the
  // viewport even before JS clamps it.
  iframe.style.cssText = frameStyle(COLLAPSED.w, COLLAPSED.h);
  iframe.src = src;
  (doc.body || doc.documentElement).appendChild(iframe);

  let expanded = false;

  function applyBox(w: number, h: number): void {
    const vw = win.innerWidth || 0;
    const vh = win.innerHeight || 0;
    iframe.style.width = (vw ? Math.min(w, vw - VIEWPORT_MARGIN) : w) + 'px';
    iframe.style.height =
      (vh ? clamp(h, MIN_H, vh - VIEWPORT_MARGIN) : Math.max(MIN_H, h)) + 'px';
  }

  function setExpanded(next: boolean): void {
    expanded = next;
    const box = next ? EXPANDED : COLLAPSED;
    applyBox(box.w, box.h);
  }

  function setHeight(h: number): void {
    applyBox((expanded ? EXPANDED : COLLAPSED).w, h);
  }

  function postToFrame(msg: Record<string, unknown>): void {
    // ALWAYS pin to the frame origin — never "*".
    const target = iframe.contentWindow;
    if (target) target.postMessage(msg, frameOrigin);
  }

  // 4. postMessage handshake — accept ONLY messages provably from our iframe:
  //    exact origin match AND source-identity match. Anything else is ignored.
  win.addEventListener('message', (ev: MessageEvent): void => {
    if (ev.origin !== frameOrigin) return;
    if (ev.source !== iframe.contentWindow) return;
    const data = ev.data as { type?: string; h?: unknown } | null;
    if (!data || typeof data !== 'object') return;
    switch (data.type) {
      case 'pawbar:resize': {
        const h = Number(data.h);
        if (Number.isFinite(h)) setHeight(h);
        break;
      }
      case 'pawbar:open':
        setExpanded(true);
        break;
      case 'pawbar:close':
        setExpanded(false);
        break;
    }
  });

  // Re-clamp to the viewport on rotation / resize (mobile).
  win.addEventListener('resize', (): void => {
    const box = expanded ? EXPANDED : COLLAPSED;
    applyBox(box.w, parseInt(iframe.style.height, 10) || box.h);
  });

  // 5. Programmatic control for embedders. Resizes the chrome the loader owns
  //    AND forwards a pinned host-intent to the app (forward-compatible: the app
  //    ignores unknown message types today, honours them once it listens).
  win.PawBar = {
    open(): void {
      setExpanded(true);
      postToFrame({ type: 'pawbar:host-open' });
    },
    close(): void {
      setExpanded(false);
      postToFrame({ type: 'pawbar:host-close' });
    },
  };
})(window as LoaderWindow);

// ── helpers ─────────────────────────────────────────────────────────────────

function attr(el: Element, name: string): string {
  return (el.getAttribute(name) || '').trim();
}

function lastScriptWith(dataAttr: string, doc: Document): HTMLScriptElement | null {
  const list = doc.querySelectorAll<HTMLScriptElement>('script[' + dataAttr + ']');
  return list.length ? list[list.length - 1] : null;
}

function originOf(url: string): string {
  try {
    return new URL(url, location.href).origin;
  } catch {
    return location.origin;
  }
}

function normalizeEndpoint(ep: string): string {
  return ep.replace(/\/+$/, '');
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function resolveParentOrigin(win: Window): string {
  // The iframe posts to window.parent (this loader's window); its origin is the
  // value the frame must target. location.origin is correct in every nesting
  // case EXCEPT a sandboxed / opaque origin ("null"), where we best-effort
  // recover the real host origin from the ancestor chain, then the referrer.
  const own = win.location.origin;
  if (own && own !== 'null') return own;
  try {
    const ao = win.location.ancestorOrigins;
    if (ao && ao.length && ao[0] && ao[0] !== 'null') return ao[0];
  } catch {
    /* ancestorOrigins unsupported (Firefox) — fall through */
  }
  try {
    if (win.document.referrer) {
      const o = new URL(win.document.referrer).origin;
      if (o && o !== 'null') return o;
    }
  } catch {
    /* malformed referrer — fall through */
  }
  return own;
}

function warn(msg: string): void {
  try {
    console.warn('[PawBar] ' + msg);
  } catch {
    /* no console */
  }
}

function frameStyle(w: number, h: number): string {
  return [
    'position:fixed',
    'right:0',
    'bottom:0',
    'width:' + w + 'px',
    'height:' + h + 'px',
    'max-width:100vw',
    'max-height:100vh',
    'border:0',
    'margin:0',
    'padding:0',
    'z-index:2147483647',
    'color-scheme:normal',
    'background:transparent',
  ].join(';');
}

export {};
