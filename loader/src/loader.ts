// loader/src/loader.ts — Paw Bar glass-bar loader (A2).
// Created 2026-07-15: the ~2KB zero-dependency IIFE a foreign site pastes in to
// embed the glass concierge. It finds its own <script> tag, reads the embed
// config off it (data-site-key / data-widget-id / data-endpoint), computes the
// host (parent) origin, and mounts the concierge iframe pointing at the A1
// frame endpoint (/paw-bar/frame?key=&w=&po=). The loader owns ONLY the iframe
// box (size + position); the glass app (A3) renders INSIDE the iframe and
// drives the box over postMessage.
//
// 2026-07-15 bar-first docking (captain direction): the docked resting state is
// a center-bottom BAR (width capped at BAR_MAX_W) that the app can flip to a
// minimized CHIP ({pawbar:view}). {pawbar:resize,h,w} sizes the docked box —
// height always, width only for the chip (the bar width is loader policy; using
// the app-reported width for the bar would feed back and shrink it). OPEN is a
// full-viewport overlay (the app draws the dim backdrop + centered palette).
// MOVE: on {pawbar:drag,phase:start} the loader snapshots the dock box, goes
// full-viewport, and replies {pawbar:box,x,y,w,h} so the app can track the
// pointer; {pawbar:drag,phase:end,x,y} adopts the new anchor and persists it
// (host localStorage) so the placement survives reloads. The anchor is the
// box's CENTER-BOTTOM point, so the bar and the (narrower) chip stay pinned to
// the same visual spot; a sub-DRAG_MIN_PX "drag" is a click on the grip and
// adopts nothing (else the default-centered dock gets silently pinned).
//
// SECURITY: inbound messages are honoured ONLY when event.origin === the frame
// origin AND event.source === the iframe's own contentWindow. Every outbound
// post pins targetOrigin to the frame origin — never "*". Idempotent; exposes
// window.PawBar = { open, close } for programmatic control.

const LOADED_FLAG = '__pawBarLoaderLoaded';
const FRAME_PATH = '/paw-bar/frame';
// v2: the anchor is the box's CENTER-BOTTOM point {cx, by}, not a top-left —
// a top-left pins the smaller chip to the bar's left edge when views flip.
const POS_KEY = '__pawbar_pos_v2';
// Pointer travel below this is a click on the grip, not a move — adopting an
// anchor for it would silently pin the default-centered dock forever.
const DRAG_MIN_PX = 4;

// Dock policy. Heights (and the chip width) are app-reported via
// {pawbar:resize}; these are just the pre-report defaults and caps.
const BAR_MAX_W = 720;
const DEFAULT_BAR_H = 96;
const DEFAULT_CHIP = { w: 240, h: 72 };
const MIN_H = 48;
const VIEWPORT_MARGIN = 24; // keep the dock off the very edge on small screens

// The OPEN messenger is a column the size of itself, not a sheet over the page.
// This is the whole difference between a messenger and a modal, and it lives
// here rather than in the app: a full-viewport iframe swallows every click on
// the host page whether or not the app paints a backdrop, because
// `pointer-events` inside a frame cannot hand a click back to the document
// underneath it. Sizing the box to the column is the only way the rest of the
// site stays usable while the bar is open.
//
// Both dimensions are loader POLICY here, unlike the docked bar and chip which
// report their own. The app cannot know the host viewport from inside a 96px
// bar at the moment it opens, and a height that tracked content would resize
// the iframe on every streamed token.
const PANEL_W = 400;
const PANEL_MAX_H = 720;
// Under this there is no room for a column beside the page, so the messenger
// takes the screen. That is the ordinary mobile sheet — the one place where
// covering the page is right, because there is no "beside" on a phone.
const PANEL_MIN_VW = 460;
const PANEL_MIN_VH = 620;

type DockView = 'bar' | 'chip' | 'panel';

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

  // 3. Build the frame URL and mount the docked iframe.
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
  // neither depend on nor inject a stylesheet. One fixed, borderless box;
  // max-*:100v* is a CSS safety net so it can never exceed the viewport.
  iframe.style.cssText = frameStyle();
  iframe.src = src;

  // Dock state. `anchor` is the user-chosen CENTER-BOTTOM point (null = default
  // centered at the viewport bottom); `overlay` = panel open or mid-drag, when
  // the iframe is the whole viewport and dock sizing must not apply. `dragFrom`
  // is the box snapshot at drag start, for the no-move guard and coordinate
  // conversion at drag end.
  let view: DockView = 'bar';
  // Which resting view to fall back to when the panel closes. Without it,
  // `pawbar:close` left `view` at 'panel' and the box stayed panel-sized — the
  // app happens to post an explicit `pawbar:view` too, so this only broke for a
  // host calling PawBar.close() directly. Restoring it here means the loader is
  // correct on its own rather than correct because the app compensates.
  let dockView: 'bar' | 'chip' = 'bar';
  let overlay = false;
  // The visitor asked for the big reading surface (the panel's expand control).
  // Separate from `overlay`, which is the transient drag state, so a window
  // resize mid-expand re-applies fullscreen instead of collapsing the panel.
  let expanded = false;
  let anchor: { cx: number; by: number } | null = readAnchor(win);
  let dragFrom: { x: number; y: number; w: number; h: number } | null = null;
  const size = {
    bar: { w: BAR_MAX_W, h: DEFAULT_BAR_H },
    chip: { w: DEFAULT_CHIP.w, h: DEFAULT_CHIP.h },
    panel: { w: PANEL_W, h: PANEL_MAX_H },
  };

  /** A viewport too small to hold the column beside the page. */
  function panelIsSheet(): boolean {
    const vw = win.innerWidth || 0;
    const vh = win.innerHeight || 0;
    return view === 'panel' && (vw < PANEL_MIN_VW || vh < PANEL_MIN_VH);
  }

  function dockBox(): { x: number; y: number; w: number; h: number } {
    const vw = win.innerWidth || 0;
    const vh = win.innerHeight || 0;
    const maxW = vw ? vw - VIEWPORT_MARGIN : BAR_MAX_W;
    // The bar reports its own width now (it rests as a compact pill and widens
    // on hover), so an invisible 720px box no longer sits across the page
    // eating clicks either side of it. BAR_MAX_W stays as the ceiling.
    const wantW = view === 'bar' ? Math.min(size.bar.w, BAR_MAX_W) : size[view].w;
    const w = Math.min(wantW, maxW);
    const wantH = view === 'panel' ? PANEL_MAX_H : size[view].h;
    const h = vh ? clamp(wantH, MIN_H, vh - VIEWPORT_MARGIN) : Math.max(MIN_H, wantH);
    // Derive this box's top-left from the center-bottom anchor so bar and chip
    // stay visually anchored to the same spot despite their different sizes.
    const cx = anchor ? anchor.cx : (vw || w) / 2;
    const by = anchor ? anchor.by : vh;
    const x = clamp(Math.round(cx - w / 2), 0, Math.max(0, vw - w));
    const y = clamp(Math.round(by - h), 0, Math.max(0, vh - h));
    return { x, y, w, h };
  }

  function applyDock(): void {
    // Expanded on request, or a viewport with no room for a column beside the
    // page. Checked here so a window resize re-decides on every reflow.
    if (expanded || panelIsSheet()) {
      goFullscreen();
      return;
    }
    const b = dockBox();
    iframe.style.left = b.x + 'px';
    iframe.style.top = b.y + 'px';
    iframe.style.width = b.w + 'px';
    iframe.style.height = b.h + 'px';
  }

  function goFullscreen(): void {
    iframe.style.left = '0px';
    iframe.style.top = '0px';
    iframe.style.width = '100vw';
    iframe.style.height = '100vh';
  }

  (doc.body || doc.documentElement).appendChild(iframe);
  applyDock();

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
    const data = ev.data as
      | {
          type?: string;
          h?: unknown;
          w?: unknown;
          view?: unknown;
          phase?: unknown;
          x?: unknown;
          y?: unknown;
          on?: unknown;
        }
      | null;
    if (!data || typeof data !== 'object') return;
    switch (data.type) {
      case 'pawbar:resize': {
        if (overlay) break; // mid-drag the frame is viewport-sized; reports wait
        // The open panel is sized by policy above. Ignoring its reports is what
        // keeps a streaming reply from resizing the iframe on every token.
        if (view === 'panel') break;
        const h = Number(data.h);
        if (Number.isFinite(h)) size[view].h = h;
        const w = Number(data.w);
        if (Number.isFinite(w) && w > 0) size[view].w = w;
        applyDock();
        break;
      }
      case 'pawbar:view': {
        if (data.view === 'bar' || data.view === 'chip' || data.view === 'panel') {
          view = data.view;
          overlay = false;
          if (data.view !== 'panel') {
            dockView = data.view;
            expanded = false;
          }
          applyDock();
        }
        break;
      }
      case 'pawbar:dead':
        // The frame declined to render (concierge disabled / unusable
        // allowlist): remove the iframe entirely so the site shows NOTHING —
        // a declined frame's body is a blank shell, but even its invisible
        // dock sliver shouldn't linger over the page.
        iframe.remove();
        break;
      case 'pawbar:open':
        // Not goFullscreen() any more. The open messenger is a docked column,
        // so the host page keeps its clicks everywhere the column is not.
        view = 'panel';
        overlay = false;
        applyDock();
        break;
      case 'pawbar:expand':
        expanded = data.on === true;
        applyDock();
        break;
      case 'pawbar:close':
        view = dockView;
        overlay = false;
        expanded = false;
        applyDock();
        break;
      case 'pawbar:drag': {
        if (data.phase === 'start') {
          if (overlay) break;
          const b = dockBox();
          dragFrom = b;
          overlay = true;
          goFullscreen();
          postToFrame({ type: 'pawbar:box', x: b.x, y: b.y, w: b.w, h: b.h });
        } else if (data.phase === 'end') {
          const x = Number(data.x);
          const y = Number(data.y);
          const from = dragFrom;
          dragFrom = null;
          const moved =
            from && Number.isFinite(x) && Number.isFinite(y)
              ? Math.abs(x - from.x) + Math.abs(y - from.y) >= DRAG_MIN_PX
              : false;
          if (from && moved) {
            anchor = { cx: x + from.w / 2, by: y + from.h };
            writeAnchor(win, anchor);
          }
          overlay = false;
          applyDock();
        }
        break;
      }
    }
  });

  // Re-clamp the dock on rotation / resize (mobile). The overlay is vw/vh-sized
  // and tracks the viewport by itself.
  win.addEventListener('resize', (): void => {
    if (!overlay) applyDock();
  });

  // 5. Programmatic control for embedders. Resizes the chrome the loader owns
  //    AND forwards a pinned host-intent to the app (forward-compatible: the app
  //    honours pawbar:host-open / pawbar:host-close).
  win.PawBar = {
    open(): void {
      overlay = true;
      goFullscreen();
      postToFrame({ type: 'pawbar:host-open' });
    },
    close(): void {
      overlay = false;
      applyDock();
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

function readAnchor(win: Window): { cx: number; by: number } | null {
  try {
    const raw = win.localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { cx?: unknown; by?: unknown };
    if (Number.isFinite(p.cx) && Number.isFinite(p.by)) {
      return { cx: p.cx as number, by: p.by as number };
    }
  } catch {
    /* storage denied / corrupt — fall back to the default placement */
  }
  return null;
}

function writeAnchor(win: Window, a: { cx: number; by: number }): void {
  try {
    win.localStorage.setItem(POS_KEY, JSON.stringify(a));
  } catch {
    /* storage denied — the placement just doesn't persist */
  }
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

function frameStyle(): string {
  return [
    'position:fixed',
    'left:0',
    'top:0',
    'width:0px',
    'height:0px',
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
