// actions/src/actions.ts — the Paw Bar page-actions host script.
//
// An opt-in IIFE a site owner adds beside the loader
// (`<script src="{endpoint}/paw-bar/actions.js" defer>`) so the concierge can
// act on the host page: guide verbs, and tools the site declares. The loader
// stays untouched; this file owns everything the bar does to the host document.
//
// Protocol (frame -> here -> frame):
//   {type:'pawbar:act', id, do, to?, target?, label} | {..., do:'tool', name, args}
//   -> {type:'pawbar:act-result', id, ok, error?, message?}
//   {type:'pawbar:tools-request'} -> {type:'pawbar:tools', tools:[{name,
//   description, inputSchema, confirm}]}, also sent ~50 ms after registrations.
//
// Guide verbs: navigate (same origin only; clicks a matching <a href> so SPA
// routers intercept, else location.assign; the reply goes first), scroll_to
// (#id, else the first h1-h4 containing the text), highlight (scroll_to plus
// an overlay box that fades after HIGHLIGHT_MS, at once under reduced motion,
// and is cleared by a new highlight, a navigate or popstate; the element's own
// styles are never touched).
//
// Site tools: `window.pawbarTools` is a queue, so script order does not matter:
// items queued before load are drained and push is replaced. Only an outline
// is checked here, to stay inside the gzip budget (name, description <= 200,
// execute, a {type:'object'} schema with valid property names, <= SCHEMA_MAX
// chars of compact JSON, <= TOOLS_MAX tools, a repeated name replaces); the
// frame (app/src/lib/page-tools) and the server apply the full schema and args
// rules. A refused tool gets a console warning. do:'tool' runs execute(args)
// (absent args = {}) with a TOOL_MS timeout; ok unless it threw or returned
// {ok:false} (`failed`); a string `message` goes back clipped to 160.
//
// SECURITY: a message is honoured only when ev.origin is the frame origin AND
// ev.source is the contentWindow of the Paw Bar iframe (an iframe on that
// origin whose path ends in /paw-bar/frame). Replies and the tool list are
// pinned to the frame origin, never '*'. The frame origin is the script's own
// src origin, or data-endpoint when given. Idempotent across double includes.

const LOADED_FLAG = '__pawBarActionsLoaded';
const SELF_PATH = /\/paw-bar\/actions\.js$/;
const FRAME_PATH = /\/paw-bar\/frame$/;
const ID_TARGET = /^#[A-Za-z][\w-]{0,63}$/;
const TARGET_MAX = 120;
const HIGHLIGHT_MS = 2000;
const FADE_MS = 300;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const ARG_NAME = /^[A-Za-z]\w{0,39}$/;
const TOOLS_MAX = 12;
const SCHEMA_MAX = 2048;
const TOOL_MS = 10000;

type ActError = 'not_found' | 'blocked' | 'unsupported';
type Data = Record<string, any>;
type ActWindow = Window & typeof globalThis & { [LOADED_FLAG]?: boolean; pawbarTools?: any };

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
  let sendTimer = 0;
  // name -> [what the frame sees, execute]
  const tools = new Map<string, [Data, (args: Data) => unknown]>();

  // The Paw Bar iframe's window: the one that sent `source`, or with no
  // source given, the first on the page. Null when there is none.
  function frameWin(source?: MessageEventSource | null): Window | null {
    for (const f of Array.from(doc.querySelectorAll('iframe'))) {
      const w = f.contentWindow;
      if (!w || (source !== undefined && w !== source)) continue;
      try {
        const u = new URL(f.src);
        if (u.origin === frameOrigin && FRAME_PATH.test(u.pathname)) return w;
      } catch {
        /* not ours */
      }
    }
    return null;
  }

  function addTool(t: Data): void {
    try {
      const s = t.inputSchema;
      const j = JSON.stringify(s);
      if (
        typeof t.name == 'string' &&
        TOOL_NAME.test(t.name) &&
        typeof t.description == 'string' &&
        t.description.trim() &&
        t.description.length <= 200 &&
        typeof t.execute == 'function' &&
        s.type == 'object' &&
        Object.keys(s.properties || {}).every((k) => ARG_NAME.test(k)) &&
        j.length <= SCHEMA_MAX &&
        (tools.size < TOOLS_MAX || tools.has(t.name))
      ) {
        const w = { name: t.name, description: t.description, inputSchema: JSON.parse(j), confirm: t.confirm !== false };
        tools.set(t.name, [w, t.execute]);
        return;
      }
    } catch {
      /* rejected below */
    }
    console.warn('[paw-bar] tool rejected:', t && t.name);
  }

  function sendTools(w = frameWin()): void {
    w?.postMessage({ type: 'pawbar:tools', tools: Array.from(tools.values(), (t) => t[0]) }, frameOrigin);
  }

  function sendSoon(): void {
    win.clearTimeout(sendTimer);
    sendTimer = win.setTimeout(sendTools, 50);
  }

  function runTool(d: Data, reply: (r: Data) => void): void {
    const t = tools.get(d.name);
    const a = d.args ?? {};
    if (!t || !a || typeof a != 'object' || Array.isArray(a)) {
      return reply({ ok: false, error: t ? 'unsupported' : 'not_found' });
    }
    let done = 0;
    const fin = (r: Data) => {
      if (!done++) {
        win.clearTimeout(timer);
        reply(r);
      }
    };
    const timer = win.setTimeout(() => fin({ ok: false, error: 'timeout' }), TOOL_MS);
    new Promise((res) => res(t[1](a))).then(
      (r: any) => {
        const ok = !(r && r.ok === false);
        const m = r && typeof r.message == 'string' ? r.message.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
        fin({ ok, ...(ok ? {} : { error: 'failed' }), ...(m ? { message: m } : {}) });
      },
      () => fin({ ok: false, error: 'failed' }),
    );
  }

  // The queue: drain what the page pushed before we loaded, then take over push.
  const queue = Array.isArray(win.pawbarTools) ? win.pawbarTools : (win.pawbarTools = []);
  queue.splice(0).forEach(addTool);
  queue.push = (...ts: Data[]): number => {
    ts.forEach(addTool);
    sendSoon();
    return tools.size;
  };
  if (tools.size) sendSoon();

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
    const d = ev.data as Data | null;
    if (!d || typeof d !== 'object') return;
    const ask = d.type === 'pawbar:tools-request';
    if (!ask && (d.type !== 'pawbar:act' || typeof d.id !== 'string')) return;
    const target = frameWin(ev.source);
    if (!target) return;
    if (ask) return sendTools(target);
    if (d.do === 'tool') {
      return runTool(d, (r) => target.postMessage({ type: 'pawbar:act-result', id: d.id, ...r }, frameOrigin));
    }
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
