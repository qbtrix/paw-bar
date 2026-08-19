// loader/test/loader.test.mjs — jsdom unit tests for the glass-bar loader (A2).
// Created 2026-07-15: loads the built dist/loader.js IIFE inside a jsdom host
// page and proves the security-critical contract deterministically —
//   • config off the <script> tag → correct frame URL (key/w/po, encoded),
//   • exactly one iframe, and idempotent on a second include,
//   • inbound messages honoured ONLY when origin AND source both match,
//   • a spoofed origin (and a spoofed source) is ignored — no resize,
//   • outbound host-intents pin targetOrigin to the frame origin, never "*".
// jsdom lets us forge event.origin / event.source and spy on the iframe's
// postMessage — control a real browser can't give us for these assertions.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const BUNDLE = readFileSync(new URL('../dist/loader.js', import.meta.url), 'utf8');

const HOST_ORIGIN = 'https://shop.example.com';
const API_ENDPOINT = 'https://api.pawbar.dev/api/v1';
const FRAME_ORIGIN = 'https://api.pawbar.dev';

// Boot a jsdom host page and run the loader IIFE off a <script> carrying config.
function mount({
  endpoint = API_ENDPOINT,
  siteKey = 'sk_live_123',
  widgetId = 'w_abc',
  // The host page's own styling, which is what the colour-scheme detector reads.
  hostStyle = '',
  prefersDark = false,
} = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head><style>${hostStyle}</style></head><body></body></html>`,
    {
      url: HOST_ORIGIN + '/products',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
    },
  );
  const { window } = dom;
  // jsdom has no real matchMedia; the detector's last resort needs one.
  // Drivable, so the OS-change path below is reachable: a stub with a no-op
  // addEventListener would let the loader mount and quietly make that test
  // impossible to write.
  window.__schemeListeners = [];
  window.__prefersDark = prefersDark;
  window.matchMedia = (q) => {
    const isScheme = /prefers-color-scheme:\s*dark/.test(q);
    return {
      get matches() {
        return isScheme ? window.__prefersDark : false;
      },
      media: q,
      addEventListener(_type, fn) {
        if (isScheme) window.__schemeListeners.push(fn);
      },
      removeEventListener() {},
    };
  };
  appendLoader(window, { endpoint, siteKey, widgetId });
  return window;
}

function appendLoader(window, { endpoint, siteKey, widgetId }) {
  const s = window.document.createElement('script');
  if (siteKey != null) s.setAttribute('data-site-key', siteKey);
  if (widgetId != null) s.setAttribute('data-widget-id', widgetId);
  if (endpoint != null) s.setAttribute('data-endpoint', endpoint);
  s.textContent = BUNDLE;
  window.document.body.appendChild(s);
}

function onlyIframe(window) {
  const frames = window.document.querySelectorAll('iframe');
  assert.equal(frames.length, 1, 'exactly one iframe');
  return frames[0];
}

// Forge a MessageEvent with an explicit origin + source (jsdom drops source from
// the constructor init, so pin it directly).
function messageEvent(window, { data, origin, source }) {
  const ev = new window.MessageEvent('message', { data, origin });
  Object.defineProperty(ev, 'source', { value: source, configurable: true });
  return ev;
}

test('reads script config into an encoded frame URL', () => {
  const window = mount();
  const url = new URL(onlyIframe(window).src);
  assert.equal(url.origin + url.pathname, FRAME_ORIGIN + '/api/v1/paw-bar/frame');
  assert.equal(url.searchParams.get('key'), 'sk_live_123');
  assert.equal(url.searchParams.get('w'), 'w_abc');
  assert.equal(url.searchParams.get('po'), HOST_ORIGIN);
});

test('defaults the endpoint to the script origin + /api/v1', () => {
  // No data-endpoint → derive from the (inline) script origin = the host page.
  const window = mount({ endpoint: null });
  const url = new URL(onlyIframe(window).src);
  assert.equal(url.origin + url.pathname, HOST_ORIGIN + '/api/v1/paw-bar/frame');
});

test('is idempotent — a second include adds no second iframe', () => {
  const window = mount();
  appendLoader(window, { endpoint: API_ENDPOINT, siteKey: 'sk_live_123', widgetId: 'w_abc' });
  assert.equal(window.document.querySelectorAll('iframe').length, 1);
});

test('missing required config creates no iframe', () => {
  const window = mount({ siteKey: null });
  assert.equal(window.document.querySelectorAll('iframe').length, 0);
});

test('resizes on a message from the real frame (origin + source both match)', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  window.dispatchEvent(
    messageEvent(window, {
      data: { type: 'pawbar:resize', h: 437 },
      origin: FRAME_ORIGIN,
      source: iframe.contentWindow,
    }),
  );
  assert.equal(iframe.style.height, '437px');
});

test('IGNORES a spoofed-origin message — no resize', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const before = iframe.style.height;
  window.dispatchEvent(
    messageEvent(window, {
      data: { type: 'pawbar:resize', h: 999 },
      origin: 'https://evil.example', // wrong origin, right source
      source: iframe.contentWindow,
    }),
  );
  assert.equal(iframe.style.height, before);
  assert.notEqual(iframe.style.height, '999px');
});

test('IGNORES a right-origin but wrong-source message — no resize', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const before = iframe.style.height;
  window.dispatchEvent(
    messageEvent(window, {
      data: { type: 'pawbar:resize', h: 999 },
      origin: FRAME_ORIGIN, // right origin, wrong source (the top window)
      source: window,
    }),
  );
  assert.equal(iframe.style.height, before);
});

test('open docks a COLUMN, not a viewport overlay — the host page keeps its clicks', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  window.dispatchEvent(
    messageEvent(window, { data: { type: 'pawbar:open' }, origin: FRAME_ORIGIN, source: iframe.contentWindow }),
  );
  // THE point of the open state, and the reason this test is worth its length:
  // a full-viewport iframe eats every click on the host page whether or not the
  // app paints a backdrop, because pointer-events inside a frame cannot hand a
  // click back to the document underneath. Sizing the box to the column is the
  // only thing that makes this a messenger rather than a modal — so if someone
  // ever restores goFullscreen() here, this is the test that says why not.
  assert.notEqual(iframe.style.width, '100vw');
  assert.notEqual(iframe.style.height, '100vh');
  // jsdom viewport is 1024x768: PANEL_W 400 → left (1024-400)/2 = 312,
  // height min(PANEL_MAX_H 720, 768-24) = 720 → top 768-720 = 48.
  assert.equal(iframe.style.width, '400px');
  assert.equal(iframe.style.height, '720px');
  assert.equal(iframe.style.left, '312px');
  assert.equal(iframe.style.top, '48px');

  window.dispatchEvent(
    messageEvent(window, { data: { type: 'pawbar:close' }, origin: FRAME_ORIGIN, source: iframe.contentWindow }),
  );
  // Close restores the RESTING view on its own, without the app having to post
  // a second pawbar:view to correct it.
  assert.equal(iframe.style.width, '384px');
});

test('the open panel ignores resize reports — a streaming reply cannot resize the frame', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });
  window.dispatchEvent(fromFrame({ type: 'pawbar:open' }));
  window.dispatchEvent(fromFrame({ type: 'pawbar:resize', h: 437, w: 300 }));
  // Both panel dimensions are loader policy. If the box tracked content, every
  // token of a streamed answer would resize the iframe under the visitor.
  assert.equal(iframe.style.height, '720px');
  assert.equal(iframe.style.width, '400px');
  // After close, content reports size the docked box again.
  window.dispatchEvent(fromFrame({ type: 'pawbar:close' }));
  window.dispatchEvent(fromFrame({ type: 'pawbar:resize', h: 72 }));
  assert.equal(iframe.style.height, '72px');
});

test('a viewport too small for a column beside the page gets the full-screen sheet', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 780, configurable: true });
  window.dispatchEvent(
    messageEvent(window, { data: { type: 'pawbar:open' }, origin: FRAME_ORIGIN, source: iframe.contentWindow }),
  );
  // On a phone there is no "beside the page" to leave clickable, so covering it
  // is the ordinary mobile sheet rather than the modal we just removed.
  assert.equal(iframe.style.width, '100vw');
  assert.equal(iframe.style.height, '100vh');
});

test('expand is opt-in and reversible: full-viewport, then back to the column', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });
  window.dispatchEvent(fromFrame({ type: 'pawbar:open' }));
  window.dispatchEvent(fromFrame({ type: 'pawbar:expand', on: true }));
  assert.equal(iframe.style.width, '100vw');
  window.dispatchEvent(fromFrame({ type: 'pawbar:expand', on: false }));
  assert.equal(iframe.style.width, '400px');
  assert.equal(iframe.style.height, '720px');
});

test('the docked bar is centered at the bottom, and its width is POLICY, not a report', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });
  // jsdom viewport is 1024x768: BAR_W 384 → left (1024-384)/2.
  assert.equal(iframe.style.width, '384px');
  assert.equal(iframe.style.left, '320px');
  assert.equal(iframe.style.top, 768 - 96 + 'px'); // bottom-aligned default height

  // The bar's HEIGHT tracks content (a composer growing to a second line)...
  window.dispatchEvent(fromFrame({ type: 'pawbar:resize', h: 122, w: 999 }));
  assert.equal(iframe.style.height, '122px');
  // ...and its WIDTH ignores whatever the app reports, because the app is laid
  // out INSIDE this box and cannot see the host viewport. Anything it derives
  // from its own current width closes a loop, and it did: `min(360px, 100%)`
  // resolved against the frame, so a bar restored from the minimized chip came
  // back 133px wide and could never grow again.
  assert.equal(iframe.style.width, '384px');
});

test('the bar comes back full width after being minimized to the chip', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });

  window.dispatchEvent(fromFrame({ type: 'pawbar:view', view: 'chip' }));
  window.dispatchEvent(fromFrame({ type: 'pawbar:resize', h: 67, w: 117 }));
  assert.equal(iframe.style.width, '117px', 'the chip IS content-sized');

  // The regression this exists for: restoring the bar left the box at whatever
  // the chip had shrunk it to, because the app sized itself against the frame
  // it happened to be in at the time.
  window.dispatchEvent(fromFrame({ type: 'pawbar:view', view: 'bar' }));
  assert.equal(iframe.style.width, '384px');
});

test('the bar never exceeds the viewport, so a phone cannot clip it', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  Object.defineProperty(window, 'innerWidth', { value: 320, configurable: true });
  window.dispatchEvent(
    messageEvent(window, {
      data: { type: 'pawbar:view', view: 'bar' },
      origin: FRAME_ORIGIN,
      source: iframe.contentWindow,
    }),
  );
  // 320 - VIEWPORT_MARGIN. The app fills whatever box it is given, so the pill
  // is narrower on a phone rather than cut off at the frame edge.
  assert.equal(iframe.style.width, '296px');
  assert.equal(iframe.style.left, '12px');
});

test('pawbar:view chip docks a content-sized chip box', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });
  window.dispatchEvent(fromFrame({ type: 'pawbar:view', view: 'chip' }));
  window.dispatchEvent(fromFrame({ type: 'pawbar:resize', h: 64, w: 180 }));
  assert.equal(iframe.style.width, '180px'); // chip honours the reported width
  assert.equal(iframe.style.height, '64px');
  window.dispatchEvent(fromFrame({ type: 'pawbar:view', view: 'bar' }));
  assert.equal(iframe.style.width, '384px'); // back to bar policy width
});

test('drag: start goes full-viewport and replies with the box; end docks at the new anchor', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const posts = [];
  Object.defineProperty(iframe.contentWindow, 'postMessage', {
    value: (data, targetOrigin) => posts.push({ data, targetOrigin }),
    configurable: true,
  });
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });

  window.dispatchEvent(fromFrame({ type: 'pawbar:drag', phase: 'start' }));
  assert.equal(iframe.style.width, '100vw');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].data.type, 'pawbar:box');
  assert.equal(posts[0].data.x, 320);
  assert.equal(posts[0].data.w, 384);
  assert.equal(posts[0].targetOrigin, FRAME_ORIGIN); // pinned, never "*"

  window.dispatchEvent(fromFrame({ type: 'pawbar:drag', phase: 'end', x: 40, y: 60 }));
  assert.equal(iframe.style.left, '40px');
  assert.equal(iframe.style.top, '60px');
  assert.equal(iframe.style.width, '384px');
});

test('the anchor is center-bottom: the chip re-docks centered where the bar was', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });
  // Move the bar (384×96) to x:100,y:60 → anchor center-bottom = (292, 156).
  window.dispatchEvent(fromFrame({ type: 'pawbar:drag', phase: 'start' }));
  window.dispatchEvent(fromFrame({ type: 'pawbar:drag', phase: 'end', x: 100, y: 60 }));
  // Flip to a 180×64 chip: it should center on the same point, not keep x:100.
  window.dispatchEvent(fromFrame({ type: 'pawbar:view', view: 'chip' }));
  window.dispatchEvent(fromFrame({ type: 'pawbar:resize', h: 64, w: 180 }));
  assert.equal(iframe.style.left, 292 - 90 + 'px');
  assert.equal(iframe.style.top, 156 - 64 + 'px');
});

test('a no-move drag adopts no anchor — the dock stays default-centered', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });
  window.dispatchEvent(fromFrame({ type: 'pawbar:drag', phase: 'start' }));
  // Released where it started (320, 672 in the 1024×768 jsdom viewport).
  window.dispatchEvent(fromFrame({ type: 'pawbar:drag', phase: 'end', x: 320, y: 672 }));
  assert.equal(window.localStorage.getItem('__pawbar_pos_v2'), null);
  // Still default-centered, so a viewport-dependent recompute keeps centering.
  assert.equal(iframe.style.left, '320px');
});

test('window.PawBar.open() pins its outbound post to the frame origin (never "*")', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const calls = [];
  Object.defineProperty(iframe.contentWindow, 'postMessage', {
    value: (data, targetOrigin) => calls.push({ data, targetOrigin }),
    configurable: true,
  });

  window.PawBar.open();

  assert.equal(calls.length, 1);
  // .data is created in jsdom's realm — compare the field, not the object shape.
  assert.equal(calls[0].data.type, 'pawbar:host-open');
  assert.equal(calls[0].targetOrigin, FRAME_ORIGIN);
  assert.notEqual(calls[0].targetOrigin, '*');
});

test('window.PawBar.open() docks the same column the message path does', () => {
  const window = mount();
  const iframe = onlyIframe(window);

  window.PawBar.open();

  // The host's own "Chat with us" button and the widget's launcher are the same
  // widget. This used to call goFullscreen() while the message path docked a
  // column, so which door the visitor came through decided whether the frame
  // covered the page — and only one of the two was ever looked at.
  assert.equal(iframe.style.width, '400px');
  assert.equal(iframe.style.height, '720px');
  assert.notEqual(iframe.style.width, '100vw');
});

test('window.PawBar.close() returns to the resting dock', () => {
  const window = mount();
  const iframe = onlyIframe(window);

  window.PawBar.open();
  window.PawBar.close();

  assert.equal(iframe.style.width, '384px');
});

// ── The clipping bug (2026-08-19) ────────────────────────────────────────────
// Reported by the captain: hovering the resting bar showed the input CUT OFF
// for a beat before the frame caught up. Root cause is a CHASE, not a paint
// bug. The app animated the pill's width in CSS; a ResizeObserver reported each
// intermediate width; the loader then started its OWN 260ms box transition
// toward a target the content had already left behind. Two transitions on the
// same quantity means the outer one is permanently behind the inner one — and
// an iframe clips whatever overflows it, so the content the frame had not
// caught up to yet simply was not drawn.
//
// The app side stopped animating its width (the bar is one width now). This
// pins the loader half: a content-size report must land on the box IMMEDIATELY.
// The frame is the clip boundary, so it may never be smaller than the content
// it is clipping — not even for one eased frame.
test('a resize report sizes the box instantly — an animated box lags content and clips it', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });

  window.dispatchEvent(fromFrame({ type: 'pawbar:resize', h: 56 }));
  assert.equal(iframe.style.height, '56px');
  assert.equal(iframe.style.transition, 'none', 'content reports must not be eased');

  // A grown composer (a second line of text) is the case that matters: the bar
  // is bottom-anchored and grows upward, so an eased height clips the top of
  // the input the visitor is typing into.
  window.dispatchEvent(fromFrame({ type: 'pawbar:resize', h: 122 }));
  assert.equal(iframe.style.height, '122px');
  assert.equal(iframe.style.transition, 'none');
});

// The counterpart: a view change IS still animated. Both endpoints are known up
// front there, so there is no moving target to chase and the motion is a state
// change the visitor asked for and can watch.
test('a view change still eases the box', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  window.dispatchEvent(
    messageEvent(window, {
      data: { type: 'pawbar:view', view: 'chip' },
      origin: FRAME_ORIGIN,
      source: iframe.contentWindow,
    }),
  );
  assert.match(iframe.style.transition, /width \d+ms/);
});

// ── Host-page dismissal for in-frame overlays (2026-08-19) ──────────────────
// A menu opened inside the frame cannot see a click on the host page, so it
// used to hang open over a page the visitor had already moved on from. The app
// declares the overlay window; the loader watches its own document only for
// that duration and answers with a bare type.
test('while an overlay is up, a host-page click is reported to the frame', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const posts = [];
  Object.defineProperty(iframe.contentWindow, 'postMessage', {
    value: (data, targetOrigin) => posts.push({ data, targetOrigin }),
    configurable: true,
  });
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });

  // Nothing open: a host-page click tells the frame nothing.
  window.document.body.dispatchEvent(
    new window.PointerEvent('pointerdown', { bubbles: true }),
  );
  assert.equal(posts.length, 0, 'silent until an overlay declares itself');

  window.dispatchEvent(fromFrame({ type: 'pawbar:overlay', on: true }));
  window.document.body.dispatchEvent(
    new window.PointerEvent('pointerdown', { bubbles: true }),
  );
  assert.equal(posts.length, 1);
  assert.equal(posts[0].data.type, 'pawbar:host-pointerdown');
  // Nothing about the host page crosses the boundary — no coordinates, no
  // target, no selector. The frame learns THAT they clicked away, never where.
  // (Compared as keys rather than deepEqual: the payload is built inside the
  // jsdom realm, so its prototype is not Node's and deepStrictEqual refuses a
  // pair that is otherwise identical.)
  assert.deepEqual([...Object.keys(posts[0].data)], ['type']);
  // And it stays pinned to the frame origin like every other outbound message.
  assert.equal(posts[0].targetOrigin, FRAME_ORIGIN);

  // A pointerdown on the iframe itself is the frame's own business.
  iframe.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
  assert.equal(posts.length, 1);

  // Closing the overlay goes silent again. The listener itself is permanent
  // (one boolean test per click — cheaper in bytes than an add/remove pair
  // against a 2KB budget); what must not be permanent is a message crossing the
  // frame boundary on every click the visitor makes on somebody else's site.
  window.dispatchEvent(fromFrame({ type: 'pawbar:overlay', on: false }));
  window.document.body.dispatchEvent(
    new window.PointerEvent('pointerdown', { bubbles: true }),
  );
  assert.equal(posts.length, 1);
});

test('a spoofed overlay declaration installs nothing', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const posts = [];
  Object.defineProperty(iframe.contentWindow, 'postMessage', {
    value: (data) => posts.push(data),
    configurable: true,
  });
  // Right shape, wrong origin — the same gate every other message goes through.
  window.dispatchEvent(
    messageEvent(window, {
      data: { type: 'pawbar:overlay', on: true },
      origin: 'https://evil.example',
      source: iframe.contentWindow,
    }),
  );
  window.document.body.dispatchEvent(
    new window.PointerEvent('pointerdown', { bubbles: true }),
  );
  assert.equal(posts.length, 0);
});


// ── Host colour scheme (2026-08-19) ─────────────────────────────────────────
// "i see dark mode only" — the widget shipped one dark palette and wore it on
// light storefronts. The frame is cross-origin and can see nothing of the page
// around it, so THIS is the only code that can answer the question. It rides on
// the frame URL rather than a postMessage so the answer is there for the first
// paint; sent after boot, every visitor on a light site would watch the widget
// flip.
function schemeOf(window) {
  return new URL(onlyIframe(window).src).searchParams.get('s');
}

test('a light host page asks for a light widget', () => {
  assert.equal(schemeOf(mount({ hostStyle: 'body { background: #ffffff }' })), 'l');
});

test('a dark host page asks for a dark widget', () => {
  assert.equal(schemeOf(mount({ hostStyle: 'body { background: #0e1117 }' })), 'd');
});

test("an explicit color-scheme on the host beats its own background", () => {
  // A site that declares `color-scheme` is STATING which it is, and that is
  // better evidence than a colour we inferred — a dark site mid-repaint, or one
  // whose body is white while the real ground is painted by a wrapper.
  assert.equal(
    schemeOf(mount({ hostStyle: ':root { color-scheme: dark } body { background: #ffffff }' })),
    'd',
  );
  assert.equal(
    schemeOf(mount({ hostStyle: ':root { color-scheme: light } body { background: #000000 }' })),
    'l',
  );
});

test('`color-scheme: light dark` states nothing, so the background decides', () => {
  // The both-supported declaration is a capability, not a choice.
  assert.equal(
    schemeOf(mount({ hostStyle: ':root { color-scheme: light dark } body { background: #101014 }' })),
    'd',
  );
});

test('a transparent page falls through to the visitor', () => {
  // Nothing to measure: no declared scheme, and a body with no background of
  // its own. The visitor's OS is the last thing we know.
  assert.equal(schemeOf(mount({ prefersDark: true })), 'd');
  assert.equal(schemeOf(mount({ prefersDark: false })), 'l');
});

test('luminance decides mid-tones, not hue', () => {
  // A saturated but BRIGHT brand colour is a light page. Picking on hue, or on
  // a single channel, gets this backwards.
  assert.equal(schemeOf(mount({ hostStyle: 'body { background: rgb(255, 214, 10) }' })), 'l');
  // ...and a saturated dark one is a dark page.
  assert.equal(schemeOf(mount({ hostStyle: 'body { background: rgb(40, 10, 60) }' })), 'd');
});

test('the scheme rides alongside the other frame params, not instead of them', () => {
  const url = new URL(onlyIframe(mount({ hostStyle: 'body { background: #fff }' })).src);
  assert.equal(url.searchParams.get('key'), 'sk_live_123');
  assert.equal(url.searchParams.get('w'), 'w_abc');
  assert.equal(url.searchParams.get('po'), HOST_ORIGIN);
  assert.equal(url.searchParams.get('s'), 'l');
});

test('an OS theme change re-reads the host and tells the frame', () => {
  // A site that follows the OS changes underneath us with the page still open.
  // The frame cannot see that; this is the only signal it gets. A page with its
  // OWN in-page toggle still needs a reload — see hostScheme() for why that is
  // not worth a MutationObserver on a customer's document.
  const window = mount({ prefersDark: false });
  const iframe = onlyIframe(window);
  const posts = [];
  Object.defineProperty(iframe.contentWindow, 'postMessage', {
    value: (data, targetOrigin) => posts.push({ data, targetOrigin }),
    configurable: true,
  });

  assert.equal(new URL(iframe.src).searchParams.get('s'), 'l', 'booted light');

  window.__prefersDark = true;
  window.__schemeListeners.forEach((fn) => fn({ matches: true }));

  assert.equal(posts.length, 1);
  assert.equal(posts[0].data.type, 'pawbar:scheme');
  assert.equal(posts[0].data.s, 'd');
  assert.equal(posts[0].targetOrigin, FRAME_ORIGIN); // pinned, never "*"
});

test('an OS change on a page that states its own scheme changes nothing', () => {
  // The host declared `color-scheme: light`. It is light whatever the visitor's
  // desktop is doing, so the re-read has to come back light too.
  const window = mount({ hostStyle: ':root { color-scheme: light }', prefersDark: false });
  const iframe = onlyIframe(window);
  const posts = [];
  Object.defineProperty(iframe.contentWindow, 'postMessage', {
    value: (data) => posts.push(data),
    configurable: true,
  });

  window.__prefersDark = true;
  window.__schemeListeners.forEach((fn) => fn({ matches: true }));

  assert.equal(posts.length, 1);
  assert.equal(posts[0].s, 'l');
});
