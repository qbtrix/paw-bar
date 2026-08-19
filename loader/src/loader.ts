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
// {pawbar:overlay,on} tells this loader an in-frame menu/popover is showing, so
// a click on the HOST page answers {pawbar:host-pointerdown} and dismisses it.
// a center-bottom BAR (width is loader policy, BAR_W) that the app can flip to a
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
//
// The BAR's width is loader POLICY as of 2026-08-19, not an app report, for the
// same reason the panel's is: the app is laid out inside this box and cannot
// see the host viewport, so anything it derives from its own current width is a
// feedback loop. It had one — `width: min(360px, 100%)` — and restoring the bar
// from the minimized chip resolved that `100%` against the CHIP's frame, so the
// bar came back 133px wide and could never grow again. A single number here,
// clamped to the viewport below, has no loop to close. The chip still reports
// its own width because it is genuinely content-sized ("Ask" is as wide as the
// word), and nothing derives from it.
const BAR_W = 384;
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

// The box GROWS into the open column instead of snapping to it. This has to
// live in the loader because the loader owns the iframe rect: the app can only
// animate its own content, so a panel that slid in beautifully still did so
// inside a frame that had already jumped from 256x96 to 400x720 in one frame.
// Both halves move together now — the box expands while the panel flies in.
//
// Dimensions rather than a transform: the iframe's content is laid out against
// its real size, so scaling it would squash the text and then snap it back.
// It is one fixed element for a quarter of a second, not a scroll-linked
// effect.
const BOX_MS = 260;
// Exponential ease-out — the same curve family as --pawbar-ease inside the app,
// so the frame and its contents decelerate together rather than racing.
const BOX_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

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
    bar: { w: BAR_W, h: DEFAULT_BAR_H },
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
    const maxW = vw ? vw - VIEWPORT_MARGIN : BAR_W;
    // The bar is exactly BAR_W (clamped to the viewport), so the pill FILLS its
    // frame — there is no invisible slack either side of it eating clicks on
    // the host page, which is what an app-reported width was protecting against
    // back when the bar rested at 148px and grew on hover. It does neither now.
    const wantW = view === 'bar' ? BAR_W : size[view].w;
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

  /** The visitor's OS setting, read live — people change it while a page is
   *  open, and a cached answer would keep animating at them until reload. */
  function reduced(): boolean {
    return !!win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Write the box. `animate` is opt-in per call rather than a standing style,
   *  because three cases must stay instant:
   *    - the FIRST placement (there is nothing to grow from, and a box sliding
   *      in from 0x0 on page load is a widget announcing itself)
   *    - every frame of a drag (a transition here lags the box behind the
   *      pointer, which feels broken rather than smooth)
   *    - a window resize (the box is tracking a viewport that already moved)
   */
  function setBox(x: string, y: string, w: string, h: string, animate: boolean): void {
    iframe.style.transition =
      animate && !reduced()
        ? `left ${BOX_MS}ms ${BOX_EASE}, top ${BOX_MS}ms ${BOX_EASE}, width ${BOX_MS}ms ${BOX_EASE}, height ${BOX_MS}ms ${BOX_EASE}`
        : 'none';
    iframe.style.left = x;
    iframe.style.top = y;
    iframe.style.width = w;
    iframe.style.height = h;
  }

  function applyDock(animate = false): void {
    // Expanded on request, or a viewport with no room for a column beside the
    // page. Checked here so a window resize re-decides on every reflow.
    if (expanded || panelIsSheet()) {
      goFullscreen(animate);
      return;
    }
    const b = dockBox();
    setBox(b.x + 'px', b.y + 'px', b.w + 'px', b.h + 'px', animate);
  }

  function goFullscreen(animate = false): void {
    setBox('0px', '0px', '100vw', '100vh', animate);
  }

  (doc.body || doc.documentElement).appendChild(iframe);
  applyDock();

  // ── Host-page dismissal for in-frame overlays (2026-08-19) ────────────────
  // Outside-click dismissal inside the frame can only see pointer events inside
  // the FRAME. A visitor who opened the quick menu or the cart popover and then
  // clicked the site itself left it hanging open over a page they had moved on
  // from. The app declares the overlay window with {pawbar:overlay,on} and this
  // listener exists only for its duration — a permanent document-wide listener
  // on a customer's page, firing on every click they ever make, is not a cost
  // this widget gets to impose for a popover that is closed 99% of the time.
  //
  // What crosses the boundary is a bare type. No coordinates, no target, no
  // selector — the frame learns THAT the visitor clicked away, never where or
  // on what.
  //
  // One listener, attached once and gated by a flag, rather than added and
  // removed around each overlay: at a 2KB gzipped budget the add/remove pair
  // cost more bytes than it saved work, and what it saves is a boolean test per
  // click. Nothing is posted while the flag is false, which was the actual
  // concern — a message per click on somebody's whole site.
  let overlayOpen = false;
  function watchHostPointer(on: boolean): void {
    overlayOpen = on;
  }
  // Capture, so a host page that stops propagation in its own handlers cannot
  // leave our overlay stuck open. A pointerdown INSIDE the iframe is reported
  // on the iframe element itself; the frame handles those on its own and must
  // not be told twice.
  doc.addEventListener(
    'pointerdown',
    (ev: Event): void => {
      if (overlayOpen && ev.target !== iframe) postToFrame({ type: 'pawbar:host-pointerdown' });
    },
    true,
  );

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
        // Width is honoured for the CHIP only — the bar's is policy above, and
        // storing a reported one would put the loop back.
        const w = Number(data.w);
        if (view !== 'bar' && Number.isFinite(w) && w > 0) size[view].w = w;
        // INSTANT, never eased. The frame is the clip boundary for everything
        // the app draws, so it may never be smaller than the content it is
        // clipping — not for one eased frame.
        //
        // This used to animate, to "travel with" a pill that widened on hover.
        // That made the box CHASE the content: the app animated its own width,
        // a ResizeObserver reported each intermediate value, and each report
        // restarted a 260ms box transition toward a target the content had
        // already moved past. Two transitions on one quantity means the outer
        // one is permanently behind — and the visitor saw the composer cut off
        // for a beat before the frame caught up (the captain's 2026-08-19
        // report). The app stopped animating its width in the same change; this
        // is the half that guarantees the frame can never lag content again.
        applyDock(false);
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
          // Animated: bar↔chip is a state the visitor asked for and can watch.
          applyDock(true);
        }
        break;
      }
      case 'pawbar:dead':
        // The frame declined to render (concierge disabled / unusable
        // allowlist): remove the iframe entirely so the site shows NOTHING —
        // a declined frame's body is a blank shell, but even its invisible
        // dock sliver shouldn't linger over the page.
        watchHostPointer(false);
        iframe.remove();
        break;
      case 'pawbar:open':
        // Not goFullscreen() any more. The open messenger is a docked column,
        // so the host page keeps its clicks everywhere the column is not.
        view = 'panel';
        overlay = false;
        // THE open. The box grows from the pill to the column while the panel
        // flies in inside it, so the two read as one movement.
        applyDock(true);
        break;
      case 'pawbar:expand':
        expanded = data.on === true;
        applyDock(true);
        break;
      case 'pawbar:overlay':
        watchHostPointer(data.on === true);
        break;
      case 'pawbar:close':
        view = dockView;
        overlay = false;
        expanded = false;
        applyDock(true);
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
    // Must match `pawbar:open` exactly. It used to call goFullscreen(), so a
    // site with its own "Chat with us" button got the viewport-covering frame
    // the message path had already stopped producing — the same widget behaving
    // two different ways depending on which door the visitor came through.
    open(): void {
      view = 'panel';
      overlay = false;
      applyDock(true);
      postToFrame({ type: 'pawbar:host-open' });
    },
    close(): void {
      view = dockView;
      overlay = false;
      expanded = false;
      applyDock(true);
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
