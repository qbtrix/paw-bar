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
function mount({ endpoint = API_ENDPOINT, siteKey = 'sk_live_123', widgetId = 'w_abc' } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: HOST_ORIGIN + '/products',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
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
  assert.equal(iframe.style.width, '720px');
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

test('the docked bar is centered at the bottom, and its box hugs the reported width', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  // jsdom viewport is 1024x768: bar defaults to the 720 cap → left (1024-720)/2.
  assert.equal(iframe.style.width, '720px');
  assert.equal(iframe.style.left, '152px');
  assert.equal(iframe.style.top, 768 - 96 + 'px'); // bottom-aligned default height
  // The bar rests as a compact pill now, so its width IS reported. Pinning the
  // box at 720 would leave ~295px of invisible iframe either side of a 130px
  // pill, silently swallowing clicks on the host page's own content.
  window.dispatchEvent(
    messageEvent(window, {
      data: { type: 'pawbar:resize', h: 56, w: 148 },
      origin: FRAME_ORIGIN,
      source: iframe.contentWindow,
    }),
  );
  assert.equal(iframe.style.width, '148px');
  assert.equal(iframe.style.left, (1024 - 148) / 2 + 'px');
  // ...but the cap still holds against a runaway report.
  window.dispatchEvent(
    messageEvent(window, {
      data: { type: 'pawbar:resize', h: 56, w: 5000 },
      origin: FRAME_ORIGIN,
      source: iframe.contentWindow,
    }),
  );
  assert.equal(iframe.style.width, '720px');
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
  assert.equal(iframe.style.width, '720px'); // back to bar policy width
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
  assert.equal(posts[0].data.x, 152);
  assert.equal(posts[0].data.w, 720);
  assert.equal(posts[0].targetOrigin, FRAME_ORIGIN); // pinned, never "*"

  window.dispatchEvent(fromFrame({ type: 'pawbar:drag', phase: 'end', x: 40, y: 60 }));
  assert.equal(iframe.style.left, '40px');
  assert.equal(iframe.style.top, '60px');
  assert.equal(iframe.style.width, '720px');
});

test('the anchor is center-bottom: the chip re-docks centered where the bar was', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });
  // Move the bar (720×96) to x:100,y:60 → anchor center-bottom = (460, 156).
  window.dispatchEvent(fromFrame({ type: 'pawbar:drag', phase: 'start' }));
  window.dispatchEvent(fromFrame({ type: 'pawbar:drag', phase: 'end', x: 100, y: 60 }));
  // Flip to a 180×64 chip: it should center on the same point, not keep x:100.
  window.dispatchEvent(fromFrame({ type: 'pawbar:view', view: 'chip' }));
  window.dispatchEvent(fromFrame({ type: 'pawbar:resize', h: 64, w: 180 }));
  assert.equal(iframe.style.left, 460 - 90 + 'px');
  assert.equal(iframe.style.top, 156 - 64 + 'px');
});

test('a no-move drag adopts no anchor — the dock stays default-centered', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });
  window.dispatchEvent(fromFrame({ type: 'pawbar:drag', phase: 'start' }));
  // Released where it started (152, 672 in the 1024×768 jsdom viewport).
  window.dispatchEvent(fromFrame({ type: 'pawbar:drag', phase: 'end', x: 152, y: 672 }));
  assert.equal(window.localStorage.getItem('__pawbar_pos_v2'), null);
  // Still default-centered, so a viewport-dependent recompute keeps centering.
  assert.equal(iframe.style.left, '152px');
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

  assert.equal(iframe.style.width, '720px');
});
