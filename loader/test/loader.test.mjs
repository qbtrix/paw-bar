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
  assert.equal(iframe.style.width, '300px'); // collapsed width
});

test('resize messages are ignored while open — the overlay stays viewport-sized', () => {
  const window = mount();
  const iframe = onlyIframe(window);
  const fromFrame = (data) =>
    messageEvent(window, { data, origin: FRAME_ORIGIN, source: iframe.contentWindow });
  window.dispatchEvent(fromFrame({ type: 'pawbar:open' }));
  window.dispatchEvent(fromFrame({ type: 'pawbar:resize', h: 437 }));
  assert.equal(iframe.style.height, '100vh'); // not 437px
  // After close, content-height reports size the pill box again.
  window.dispatchEvent(fromFrame({ type: 'pawbar:close' }));
  window.dispatchEvent(fromFrame({ type: 'pawbar:resize', h: 72 }));
  assert.equal(iframe.style.height, '72px');
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
