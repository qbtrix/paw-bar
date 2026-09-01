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
// {pawbar:bar,compact,expanded} (2026-08-22) is the docked bar's resting-width
// INTENT — the app says which state it is in, this loader owns both widths
// (BAR_W_REST / BAR_W) and eases between them. Never a measured width: see
// BAR_W_REST for the clipping bug that distinction exists to prevent.
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
// 2026-09-01 THE OPEN MESSENGER REPLACES THE BROWSING (captain direction). Two
// changes that are really one product decision: the docked column grew from
// 400x720 to 520x840 (PANEL_W / PANEL_MAX_H), and the host page behind it is now
// blurred and dimmed by a SCRIM this loader paints — a plain div in the host
// document, under the frame, that also takes the click that dismisses the panel.
// It is a host-document element rather than a full-viewport iframe on purpose:
// see the SCRIM_* block for why the obvious implementation is the modal the
// 2026-08-19 work removed. This deliberately reverses "the host page stays
// usable while the bar is open" — an open bar is now the foreground, and one
// click on the page puts it back.
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
// The COMPACT resting width (2026-08-22). The bar can rest as a narrow pill and
// widen to BAR_W when the visitor hovers, focuses or starts typing — the
// behaviour that was removed on 2026-08-19, rebuilt so that it cannot clip.
//
// It is loader policy for the same reason BAR_W is, and the reason is the whole
// design: the app declares an INTENT ({pawbar:bar,compact,expanded}), never a
// measured width, and this file runs the ONE transition between the two numbers
// while the app stays width:100% of whatever box it is given. The old morph had
// the app easing its own width, a ResizeObserver reporting each intermediate
// value, and this loader starting a fresh eased transition toward a target the
// content had already passed — the frame permanently a step behind the content
// it was clipping. Content that fills its frame cannot overflow it, however the
// frame is moving.
//
// 236 is sized to hold the mascot plus the resting question ("Ask about this
// site") without truncating it; the app hides the grip, the minimize control
// and the send button while it rests, so this is not BAR_W's contents squeezed
// into two thirds of the room.
const BAR_W_REST = 236;
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
//
// WIDENED 2026-09-01 (captain direction). 400x720 was sized as a chat column
// beside a page the visitor was still reading. The product it has to carry now
// is the opposite: an open bar is meant to REPLACE the browsing, so the answer
// — not the page behind it — is the thing being read. A 400px column wraps a
// code block or a product card into a ribbon and puts every table into a
// horizontal scroller. 520 holds ~72 characters of prose at the app's body
// size, which is a reading measure rather than a chat gutter.
const PANEL_W = 520;
const PANEL_MAX_H = 840;
// Under this there is no room for a column beside the page, so the messenger
// takes the screen. That is the ordinary mobile sheet — the one place where
// covering the page is right, because there is no "beside" on a phone.
//
// VW tracks PANEL_W and must stay ahead of it: at exactly PANEL_W the "column"
// is the whole viewport with no page either side of it, which is a sheet
// wearing a column's rounded corners. 600 leaves 40px of page on each flank at
// the threshold. VH is deliberately NOT raised to match PANEL_MAX_H — the
// height already clamps to the viewport in dockBox(), so a short laptop gets a
// shorter column rather than a full-screen takeover it never asked for.
const PANEL_MIN_VW = 600;
const PANEL_MIN_VH = 620;

// ── The host page behind an open messenger (2026-09-01) ───────────────────────
// A blurred, dimmed scrim painted on the HOST page, under the frame.
//
// This deliberately reverses the 2026-08-19 decision that the host page stays
// usable while the bar is open, and the reversal is a product call rather than
// a regression: an open bar is now meant to replace the browsing, so the page
// behind it should read as set aside rather than as something still being used.
// The scrim is what makes a 520px column read as the foreground instead of a
// widget parked over live content.
//
// IT IS A HOST-DOCUMENT ELEMENT, NOT A BIGGER IFRAME, and that distinction is
// the whole reason this is safe. Making the frame full-viewport to paint a
// backdrop is what the August work removed: `pointer-events` inside a frame
// cannot hand a click back to the document underneath, so a full-viewport frame
// swallows every click on the page whether or not it paints anything. A plain
// div in the host document blurs the page, takes the click itself, and closes
// the panel with it — one click back to the page rather than none.
//
// Blur AND dim, not blur alone: `backdrop-filter` is unsupported often enough
// (and disabled by some privacy settings) that a scrim relying on it alone
// would be invisible on those pages, leaving the column floating over sharp
// live content. The rgba dim is the floor that always paints; the blur is the
// enhancement on top of it.
const SCRIM_BLUR_PX = 10;
const SCRIM_DIM = 'rgba(9,11,15,0.42)';
// The dim carries the whole effect where the blur cannot paint, so it has to be
// heavier there — the same 0.42 over an unblurred page reads as a faint tint
// rather than a page that has been set aside.
const SCRIM_DIM_NO_BLUR = 'rgba(9,11,15,0.58)';

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
/** How a box write travels. 'none' snaps, 'box' eases all four edges, 'width'
 *  eases the horizontal pair and applies height instantly — see setBox. */
type Motion = 'none' | 'box' | 'width';

interface PawBarApi {
  open(): void;
  close(): void;
}

type LoaderWindow = Window &
  typeof globalThis & { PawBar?: PawBarApi; [key: string]: unknown };

/** Does this page ask us not to mount? (`?pawbar=off`)
 *
 *  For the owner's appearance preview. The dashboard frames the REAL published
 *  site so a theme can be judged on the page it will sit on, and overlays its own
 *  owner-preview bar — the one that accepts live token updates. The framed page
 *  would otherwise grow a SECOND bar: the public embed, showing the SAVED look,
 *  sitting behind the one being edited. Two bars, and the wrong one is the one
 *  that responds.
 *
 *  Not a security control, and it does not need to be. A visitor who adds this to
 *  a URL hides a widget on a page they are already looking at, which costs
 *  nobody anything. The site owner's own switch is `concierge_enabled`, which is
 *  server-side and cannot be talked out of by a query string.
 */
function suppressed(win: LoaderWindow): boolean {
  try {
    return new URLSearchParams(win.location.search).get('pawbar') === 'off';
  } catch {
    return false;
  }
}

(function bootstrap(win: LoaderWindow): void {
  // Idempotent: a duplicate paste / double-include must be a silent no-op.
  if (win[LOADED_FLAG]) return;
  if (suppressed(win)) return;

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
  //
  // `s` is the HOST PAGE'S colour scheme, and it goes in the URL rather than a
  // postMessage on purpose: the frame needs it in time for its first paint. Sent
  // after boot it would arrive a frame or two late, and every visitor on a light
  // site would watch a dark widget flip. The frame treats it as a default the
  // owner's own tokens still override.
  const src =
    endpoint +
    FRAME_PATH +
    '?key=' +
    encodeURIComponent(siteKey) +
    '&w=' +
    encodeURIComponent(widgetId) +
    '&po=' +
    encodeURIComponent(parentOrigin) +
    '&s=' +
    hostScheme(win);

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
  // The docked bar's resting width, as declared by the app. `barCompact` is the
  // owner's setting (and is false on a coarse pointer, where there is no hover
  // to expand with); `barOpen` is whether the visitor is in it right now.
  let barCompact = false;
  let barOpen = false;
  // When the in-flight bar width transition is due to finish. A content resize
  // that lands mid-expand must not kill it: applyDock('none') rewrites
  // `transition` to none, which would abandon the eased width wherever it had
  // got to and snap the rest. Inside this window a resize re-applies with
  // 'width' instead, so the height it is reporting still lands instantly (the
  // frame may never be shorter than the content it clips) while the width keeps
  // travelling to the same target.
  let barMotionUntil = 0;
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
    const wantW =
      view === 'bar' ? (barCompact && !barOpen ? BAR_W_REST : BAR_W) : size[view].w;
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
  function setBox(x: string, y: string, w: string, h: string, motion: Motion): void {
    const m = reduced() ? 'none' : motion;
    // 'width' eases the horizontal pair ONLY, and leaves height to apply in the
    // same frame it arrives. That distinction is what lets the compact bar
    // expand on hover without re-opening the clipping bug: the frame is the
    // clip boundary for everything the app draws, so a HEIGHT that lags content
    // shows as a cut-off composer — but a WIDTH may ease freely, because the
    // app is width:100% of this box and its content reflows to whatever the
    // frame currently is rather than to some target of its own.
    iframe.style.transition =
      m === 'box'
        ? `left ${BOX_MS}ms ${BOX_EASE}, top ${BOX_MS}ms ${BOX_EASE}, width ${BOX_MS}ms ${BOX_EASE}, height ${BOX_MS}ms ${BOX_EASE}`
        : m === 'width'
          ? `left ${BOX_MS}ms ${BOX_EASE}, width ${BOX_MS}ms ${BOX_EASE}`
          : 'none';
    iframe.style.left = x;
    iframe.style.top = y;
    iframe.style.width = w;
    iframe.style.height = h;
  }

  // The scrim is created on FIRST OPEN, never at boot. The loader runs on
  // someone else's page and should add exactly one node to it until the visitor
  // actually asks for something; a permanently parked full-viewport div — even
  // an invisible one — is a thing host pages trip over (their own outside-click
  // handlers, their screenshot tooling, their DOM diffing).
  let scrim: HTMLDivElement | null = null;
  let scrimOn = false;

  function ensureScrim(): HTMLDivElement {
    if (scrim) return scrim;
    const el = doc.createElement('div');
    // Inert to assistive tech: it is a visual treatment of the page behind the
    // messenger, not content, and the messenger itself is the thing to read.
    el.setAttribute('aria-hidden', 'true');
    // Does this browser actually PAINT a backdrop-filter? Property-presence on
    // the style object rather than CSS.supports(): it asks the same question in
    // a fraction of the bytes, and this file has a gzip budget. The answer
    // matters because the dim has to carry the whole effect where the blur
    // cannot paint — see SCRIM_DIM_NO_BLUR.
    const bs = el.style as CSSStyleDeclaration & { webkitBackdropFilter?: string };
    const blur = 'backdropFilter' in bs || 'webkitBackdropFilter' in bs;
    el.style.cssText =
      'position:fixed;left:0;top:0;width:100%;height:100%;border:0;margin:0;' +
      // One below the frame's 2147483647. The frame must stay on top of the
      // scrim it sits in front of, and both on top of the page.
      'padding:0;z-index:2147483646;opacity:0;pointer-events:none;' +
      'background-color:' +
      (blur ? SCRIM_DIM : SCRIM_DIM_NO_BLUR);
    if (blur) bs.webkitBackdropFilter = bs.backdropFilter = `blur(${SCRIM_BLUR_PX}px)`;
    // Pointerdown rather than click: a click only lands after the pointer goes
    // back UP on the same element, so a visitor who presses on the scrim and
    // drifts a few pixels gets nothing. This is a dismissal, and dismissals
    // should answer the press.
    el.addEventListener('pointerdown', (ev: Event): void => {
      // An in-frame menu is showing, and the capture listener below has already
      // told the frame to dismiss it. Closing the whole panel on the same press
      // would take away the conversation the visitor was only trying to get
      // back to.
      if (overlayOpen) return;
      ev.preventDefault();
      view = dockView;
      overlay = false;
      expanded = false;
      applyDock('box');
      postToFrame({ type: 'pawbar:host-close' });
    });
    (doc.body || doc.documentElement).appendChild(el);
    scrim = el;
    return el;
  }

  /** Show or hide the scrim. Idempotent — applyDock() runs on every window
   *  resize, and re-writing `opacity` to the value it already holds would
   *  restart the fade under a visitor who is only resizing their window. */
  function setScrim(on: boolean): void {
    if (on === scrimOn) return;
    scrimOn = on;
    // Nothing to hide if it was never built — the common case, since most
    // visitors never open the bar at all.
    if (!on && !scrim) return;
    const el = ensureScrim();
    el.style.transition = reduced() ? 'none' : `opacity ${BOX_MS}ms ${BOX_EASE}`;
    // The frame is growing from a pill into a column over the same BOX_MS with
    // the same curve, so the page recedes exactly as the messenger arrives.
    el.style.opacity = on ? '1' : '0';
    // Only ever a click target while it is actually covering the page. Left on
    // through the fade-out it would eat the visitor's first click back onto the
    // site, which is the click they just asked for by dismissing us.
    el.style.pointerEvents = on ? 'auto' : 'none';
  }

  function applyDock(motion: Motion = 'none'): void {
    // The page behind us is dimmed for exactly as long as the messenger is
    // open. Here rather than in the message handler because this is the ONE
    // function every state change routes through — an open, a close, a
    // programmatic PawBar.open(), and a window resize that re-decides whether
    // the column has become a sheet.
    setScrim(view === 'panel');
    // Expanded on request, or a viewport with no room for a column beside the
    // page. Checked here so a window resize re-decides on every reflow.
    if (expanded || panelIsSheet()) {
      goFullscreen(motion);
      return;
    }
    const b = dockBox();
    setBox(b.x + 'px', b.y + 'px', b.w + 'px', b.h + 'px', motion);
  }

  function goFullscreen(motion: Motion = 'none'): void {
    setBox('0px', '0px', '100vw', '100vh', motion);
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

  // The visitor can change their OS setting with the page open, and a site
  // that follows it changes underneath us. Re-read and tell the frame; it is one
  // listener and it is the only scheme change we can see without watching the
  // host's DOM. A site with its OWN in-page toggle still needs a reload — see
  // hostScheme() for why that is not worth a MutationObserver on someone else's
  // document.
  const schemeQuery = win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)');
  if (schemeQuery && schemeQuery.addEventListener) {
    schemeQuery.addEventListener('change', (): void => {
      postToFrame({ type: 'pawbar:scheme', s: hostScheme(win) });
    });
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
          compact?: unknown;
          expanded?: unknown;
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
        applyDock(Date.now() < barMotionUntil ? 'width' : 'none');
        break;
      }
      case 'pawbar:bar': {
        // The docked bar's resting width. Honoured only while the bar is the
        // view: the chip and the open column have their own policy above, and a
        // stray intent arriving during either would argue with it.
        const compact = data.compact === true;
        const open = data.expanded === true;
        if (compact === barCompact && open === barOpen) break;
        barCompact = compact;
        barOpen = open;
        if (view !== 'bar') break;
        barMotionUntil = Date.now() + BOX_MS;
        applyDock('width');
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
          applyDock('box');
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
        // Take the scrim with it. A frame that has declined to render can never
        // post `pawbar:close`, so a scrim left behind would blur and swallow
        // the whole page with nothing on top of it to dismiss it.
        if (scrim) {
          scrim.remove();
          scrim = null;
          scrimOn = false;
        }
        break;
      case 'pawbar:open':
        // Not goFullscreen() any more. The open messenger is a docked column,
        // so the host page keeps its clicks everywhere the column is not.
        view = 'panel';
        overlay = false;
        // THE open. The box grows from the pill to the column while the panel
        // flies in inside it, so the two read as one movement.
        applyDock('box');
        break;
      case 'pawbar:expand':
        expanded = data.on === true;
        applyDock('box');
        break;
      case 'pawbar:overlay':
        watchHostPointer(data.on === true);
        break;
      case 'pawbar:close':
        view = dockView;
        overlay = false;
        expanded = false;
        applyDock('box');
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
      applyDock('box');
      postToFrame({ type: 'pawbar:host-open' });
    },
    close(): void {
      view = dockView;
      overlay = false;
      expanded = false;
      applyDock('box');
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

/**
 * Which way round the HOST page reads: 'l' (light) or 'd' (dark).
 *
 * This is the one thing the loader can answer and the frame cannot — the frame
 * is a cross-origin document and can see nothing of the page around it. Three
 * signals, most explicit first:
 *
 *   1. `color-scheme` on the host's :root. A site that sets it is STATING which
 *      it is, and that beats anything inferred.
 *   2. The effective page background. Walked body → html because a body with no
 *      background is transparent and the colour lives on html. Relative
 *      luminance decides, so a mid-grey site lands on the right side rather
 *      than on a guess about hue.
 *   3. The visitor's OS preference, when the page says nothing either way.
 *
 * Deliberately NOT watched with a MutationObserver: a site's own dark-mode
 * toggle usually swaps a class on :root, but which class, on which element, is
 * per-site, and observing an arbitrary customer's document on every mutation to
 * catch it is a real cost on their page for a case a reload already fixes.
 */
function hostScheme(win: Window): string {
  const doc = win.document;
  try {
    const declared = win.getComputedStyle(doc.documentElement).colorScheme || '';
    const dark = declared.indexOf('dark') >= 0;
    const light = declared.indexOf('light') >= 0;
    if (dark !== light) return dark ? 'd' : 'l';

    const roots = [doc.body, doc.documentElement];
    for (let i = 0; i < roots.length; i++) {
      const el = roots[i];
      if (!el) continue;
      const parts = win.getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      // A transparent or barely-there background tells us nothing; keep walking.
      if (!parts || parts.length < 3 || (parts.length > 3 && +parts[3] < 0.5)) continue;
      const lum = (0.2126 * +parts[0] + 0.7152 * +parts[1] + 0.0722 * +parts[2]) / 255;
      return lum < 0.5 ? 'd' : 'l';
    }
  } catch {
    /* a hostile or exotic host document — fall through to the visitor */
  }
  return win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches ? 'd' : 'l';
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
