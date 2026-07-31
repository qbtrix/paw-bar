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

test('open/close messages toggle the iframe box', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  window.dispatchEvent(
    messageEvent(window, { data: { type: 'pawbar:open' }, origin: FRAME_ORIGIN, source: iframe.contentWindow }),
  );
  // Open = full-viewport overlay (the app centers the palette inside it).
  assert.equal(iframe.style.width, '100vw');
  assert.equal(iframe.style.height, '100vh');
  window.dispatchEvent(
    messageEvent(window, { data: { type: 'pawbar:close' }, origin: FRAME_ORIGIN, source: iframe.contentWindow }),
  );
  // Docked bar width = min(BAR_MAX_W, innerWidth - margin) → 720 in jsdom (1024).
  assert.equal(iframe.style.width, '720px');
});

test('resize messages are ignored while open — the overlay stays viewport-sized', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });
  window.dispatchEvent(fromFrame({ type: 'pawbar:open' }));
  window.dispatchEvent(fromFrame({ type: 'pawbar:resize', h: 437 }));
  assert.equal(iframe.style.height, '100vh'); // not 437px
  // After close, content-height reports size the docked box again.
  window.dispatchEvent(fromFrame({ type: 'pawbar:close' }));
  window.dispatchEvent(fromFrame({ type: 'pawbar:resize', h: 72 }));
  assert.equal(iframe.style.height, '72px');
});

test('the docked bar is centered at the bottom, and width reports cannot shrink it', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  // jsdom viewport is 1024×768: bar = 720 wide → left (1024-720)/2 = 152.
  assert.equal(iframe.style.width, '720px');
  assert.equal(iframe.style.left, '152px');
  assert.equal(iframe.style.top, 768 - 96 + 'px'); // bottom-aligned default height
  // A reported width must NOT shrink the bar (loader policy owns bar width).
  window.dispatchEvent(
    messageEvent(window, {
      data: { type: 'pawbar:resize', h: 96, w: 500 },
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
