// actions/src/actions.ts — the Paw Bar page-actions host script.
//
// An opt-in IIFE a site owner adds beside the loader
// (`<script src="{endpoint}/paw-bar/actions.js" defer>`) so the concierge can
// guide a visitor around the page: go to another page on the same site, scroll
// to a section, or highlight one. The loader stays untouched; this file owns
// everything the bar does to the host document.
//
// Protocol (app -> here, then here -> app):
//   {type:'pawbar:act', id, do, to?, target?, label}
//   {type:'pawbar:act-result', id, ok, error?: 'not_found'|'blocked'|'unsupported'}
//
// Verbs:
//   navigate   `to` must be same-origin. An <a href> on the page pointing at the
//              same path+query+hash is clicked (SPA routers intercept it),
//              otherwise location.assign. Already on that page: scroll to its
//              `#id` fragment if any, else nothing. The reply goes out first: a
//              full navigation unloads the page, and the frame keeps its own
//              arrival marker.
//   scroll_to  `#id` lookup, else the first h1-h4 whose text contains the
//              target (case-folded); scrollIntoView({block:'center'}).
//   highlight  scroll_to plus an overlay box positioned from
//              getBoundingClientRect. After HIGHLIGHT_MS it fades to opacity 0
//              and is removed on transitionend (or a fallback timer); under
//              reduced motion it has no transition and is removed at once.
//              A new highlight, a navigate, or a popstate removes it
//              immediately, so it never boxes content from a previous route.
//              The element's own styles are never touched.
//
// SECURITY: a message is honoured only when ev.origin is the frame origin AND
// ev.source is the contentWindow of the Paw Bar iframe (an iframe on that
// origin whose path ends in /paw-bar/frame). Replies are pinned to the frame
// origin, never '*'. The frame origin is the script's own src origin, or
// data-endpoint when given. Idempotent across double includes.

const LOADED_FLAG = '__pawBarActionsLoaded';
const SELF_PATH = /\/paw-bar\/actions\.js$/;
const FRAME_PATH = /\/paw-bar\/frame$/;
const ID_TARGET = /^#[A-Za-z][\w-]{0,63}$/;
const TARGET_MAX = 120;
const HIGHLIGHT_MS = 2000;
const FADE_MS = 300;

type ActError = 'not_found' | 'blocked' | 'unsupported';
type ActWindow = Window & typeof globalThis & { [LOADED_FLAG]?: boolean };

(function boot(win: ActWindow): void {
  if (win[LOADED_FLAG]) return;
  const doc = win.document;
  const script =
    (doc.currentScript as HTMLScriptElement | null) ||
    Array.from(doc.scripts)
      .reverse()
      .find((s) => SELF_PATH.test(s.src.split(/[?#]/)[0]));
  if (!script) return;
  let frameOrigin: string;
  try {
    frameOrigin = new URL(script.getAttribute('data-endpoint') || script.src, win.location.href).origin;
  } catch {
    return;
  }
  if (frameOrigin === 'null') return;
  win[LOADED_FLAG] = true;

  let overlay: HTMLElement | null = null;
  let overlayTimer = 0;

  // The Paw Bar iframe that sent this message, or null.
  function frameFor(source: MessageEventSource | null): HTMLIFrameElement | null {
    if (!source) return null;
    for (const f of Array.from(doc.querySelectorAll('iframe'))) {
      if (f.contentWindow !== source) continue;
      try {
        const u = new URL(f.src);
        if (u.origin === frameOrigin && FRAME_PATH.test(u.pathname)) return f;
      } catch {
        /* not ours */
      }
    }
    return null;
  }

  const norm = (p: string): string => p.replace(/\/+$/, '') || '/';

  function navigate(to: unknown): ActError | (() => void) {
    clearOverlay();
    if (typeof to !== 'string') return 'unsupported';
    let url: URL;
    try {
      url = new URL(to, win.location.href);
    } catch {
      return 'blocked';
    }
    const loc = win.location;
    if (url.origin !== loc.origin) return 'blocked';
    const want = norm(url.pathname) + url.search;
    if (want === norm(loc.pathname) + loc.search) {
      // Already here: a `#id` fragment means "this section", anything else is done.
      const el = url.hash ? find(url.hash) : null;
      return () => el?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    }
    const link = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]')).find(
      (a) =>
        a.origin === loc.origin &&
        norm(a.pathname) + a.search === want &&
        a.hash === url.hash &&
        !a.hasAttribute('download') &&
        (!a.target || a.target === '_self'),
    );
    return () => (link ? link.click() : loc.assign(url.href));
  }

  function find(target: unknown): Element | null {
    if (typeof target !== 'string' || target.length > TARGET_MAX || /[<>]/.test(target)) return null;
    if (ID_TARGET.test(target)) {
      const el = doc.getElementById(target.slice(1));
      if (el) return el;
    }
    const q = target.trim().toLowerCase();
    if (!q) return null;
    for (const h of Array.from(doc.querySelectorAll('h1,h2,h3,h4'))) {
      if ((h.textContent || '').toLowerCase().includes(q)) return h;
    }
    return null;
  }

  function reduced(): boolean {
    try {
      return win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  function clearOverlay(): void {
    win.clearTimeout(overlayTimer);
    overlay?.remove();
    overlay = null;
  }

  // Timed end of a highlight: fade out, then remove. Immediate clears skip this.
  function fadeOverlay(): void {
    if (!overlay || reduced()) return clearOverlay();
    overlay.addEventListener('transitionend', clearOverlay, { once: true });
    overlayTimer = win.setTimeout(clearOverlay, FADE_MS + 100);
    overlay.style.opacity = '0';
  }

  function highlight(el: Element): void {
    clearOverlay();
    const r = el.getBoundingClientRect();
    const box = doc.createElement('div');
    box.setAttribute('data-pawbar-highlight', '');
    box.setAttribute('aria-hidden', 'true');
    const pad = 6;
    // Document coordinates on <html>, so a smooth scroll in progress does not
    // move it off its target, and a positioned <body> cannot offset it.
    box.style.cssText =
      'position:absolute;pointer-events:none;z-index:2147483646;box-sizing:border-box;' +
      'border:3px solid #3b82f6;border-radius:10px;box-shadow:0 0 0 6px rgba(59,130,246,.25);' +
      `top:${r.top + win.scrollY - pad}px;left:${r.left + win.scrollX - pad}px;` +
      `width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;` +
      (reduced() ? '' : `transition:opacity ${FADE_MS}ms;`);
    doc.documentElement.appendChild(box);
    overlay = box;
    overlayTimer = win.setTimeout(fadeOverlay, HIGHLIGHT_MS);
  }

  function run(d: Record<string, unknown>): ActError | (() => void) {
    if (d.do === 'navigate') return navigate(d.to);
    if (d.do !== 'scroll_to' && d.do !== 'highlight') return 'unsupported';
    const el = find(d.target);
    if (!el) return 'not_found';
    return () => {
      el.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
      if (d.do === 'highlight') highlight(el);
    };
  }

  // Back/forward in an SPA: the highlighted element is likely gone.
  win.addEventListener('popstate', clearOverlay);

  win.addEventListener('message', (ev: MessageEvent): void => {
    if (ev.origin !== frameOrigin) return;
    const d = ev.data as Record<string, unknown> | null;
    if (!d || typeof d !== 'object' || d.type !== 'pawbar:act' || typeof d.id !== 'string') return;
    const frame = frameFor(ev.source);
    const target = frame?.contentWindow;
    if (!target) return;
    let out: ActError | (() => void);
    try {
      out = run(d);
    } catch {
      out = 'unsupported';
    }
    const ok = typeof out === 'function';
    target.postMessage(
      { type: 'pawbar:act-result', id: d.id, ok, ...(ok ? {} : { error: out }) },
      frameOrigin,
    );
    if (ok) {
      try {
        (out as () => void)();
      } catch {
        /* the reply already went; a broken host handler is the host's */
      }
    }
  });
})(window as ActWindow);
