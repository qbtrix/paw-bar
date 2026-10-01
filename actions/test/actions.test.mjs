// actions/test/actions.test.mjs — jsdom tests for the page-actions host script.
// Runs dist/actions.js (the shipped IIFE, so build first) inside a jsdom host
// page with a Paw Bar iframe, forges `pawbar:act` messages with explicit origin
// and source, and records the `pawbar:act-result` replies the script posts.
// Covers: spoofed source/origin ignored, cross-origin navigate refused, anchor
// click vs location.assign, #id and heading lookups, overlay cleanup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const BUNDLE = readFileSync(new URL('../dist/actions.js', import.meta.url), 'utf8');

const HOST_ORIGIN = 'https://shop.example.com';
const ENDPOINT = 'https://api.pawbar.dev/api/v1';
const FRAME_ORIGIN = 'https://api.pawbar.dev';

const mounted = [];
test.after(() => mounted.forEach((w) => w.close()));

function mount({ body = '', path = '/', reducedMotion = false, endpointAttr = null } = {}) {
  const navigations = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (/navigation/i.test(String(e.message))) navigations.push(e.message);
  });
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    url: HOST_ORIGIN + path,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  mounted.push(window);
  window.matchMedia = (q) => ({
    matches: /reduced-motion/.test(q) ? reducedMotion : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  });
  // jsdom has no layout; record the call instead.
  window.__scrolled = [];
  window.Element.prototype.scrollIntoView = function (opts) {
    window.__scrolled.push({ el: this, opts });
  };

  const iframe = window.document.createElement('iframe');
  iframe.src = ENDPOINT + '/paw-bar/frame?key=k&w=w';
  window.document.body.appendChild(iframe);
  const replies = [];
  Object.defineProperty(iframe.contentWindow, 'postMessage', {
    // Re-made in this realm: jsdom objects carry the window's prototypes.
    value: (data, origin) => replies.push({ data: JSON.parse(JSON.stringify(data)), origin }),
    configurable: true,
  });

  const s = window.document.createElement('script');
  if (endpointAttr) s.setAttribute('data-endpoint', endpointAttr);
  // An inline script has no src, so currentScript.src is ''. Give the IIFE the
  // src it would have when served, the way a real include sees it.
  Object.defineProperty(s, 'src', { get: () => ENDPOINT + '/paw-bar/actions.js' });
  s.textContent = BUNDLE;
  window.document.body.appendChild(s);
  return { window, iframe, replies, navigations };
}

function act(window, data, { origin = FRAME_ORIGIN, source } = {}) {
  const ev = new window.MessageEvent('message', { data, origin });
  Object.defineProperty(ev, 'source', { value: source, configurable: true });
  window.dispatchEvent(ev);
}

test('replies to a real frame message, pinned to the frame origin', () => {
  const { window, iframe, replies } = mount({ body: '<h2 id="returns">Returns</h2>' });
  act(window, { type: 'pawbar:act', id: 'a1', do: 'scroll_to', target: '#returns', label: 'Returns' }, { source: iframe.contentWindow });
  assert.deepEqual(replies, [{ data: { type: 'pawbar:act-result', id: 'a1', ok: true }, origin: FRAME_ORIGIN }]);
  assert.equal(window.__scrolled.length, 1);
  assert.equal(window.__scrolled[0].el.id, 'returns');
  assert.equal(window.__scrolled[0].opts.block, 'center');
});

test('ignores a message with the right origin but a spoofed source', () => {
  const { window, replies } = mount({ body: '<h2 id="returns">Returns</h2>' });
  act(window, { type: 'pawbar:act', id: 'a1', do: 'scroll_to', target: '#returns', label: 'x' }, { source: window });
  assert.equal(replies.length, 0);
  assert.equal(window.__scrolled.length, 0);
});

test('ignores a message from the real source but the wrong origin', () => {
  const { window, iframe, replies } = mount({ body: '<h2 id="returns">Returns</h2>' });
  act(window, { type: 'pawbar:act', id: 'a1', do: 'scroll_to', target: '#returns', label: 'x' }, { origin: HOST_ORIGIN, source: iframe.contentWindow });
  assert.equal(replies.length, 0);
});

test('ignores an iframe on the frame origin that is not the Paw Bar frame', () => {
  const { window, replies } = mount({ body: '<h2 id="returns">Returns</h2>' });
  const other = window.document.createElement('iframe');
  other.src = FRAME_ORIGIN + '/somewhere-else';
  window.document.body.appendChild(other);
  act(window, { type: 'pawbar:act', id: 'a1', do: 'scroll_to', target: '#returns', label: 'x' }, { source: other.contentWindow });
  assert.equal(replies.length, 0);
});

test('ignores non-act messages and acts without a string id', () => {
  const { window, iframe, replies } = mount();
  act(window, { type: 'pawbar:resize', h: 10 }, { source: iframe.contentWindow });
  act(window, { type: 'pawbar:act', do: 'navigate', to: '/x', label: 'x' }, { source: iframe.contentWindow });
  assert.equal(replies.length, 0);
});

test('navigate refuses a cross-origin target', () => {
  const { window, iframe, replies, navigations } = mount();
  act(window, { type: 'pawbar:act', id: 'n1', do: 'navigate', to: 'https://evil.example/x', label: 'x' }, { source: iframe.contentWindow });
  assert.deepEqual(replies[0].data, { type: 'pawbar:act-result', id: 'n1', ok: false, error: 'blocked' });
  assert.equal(navigations.length, 0);
});

test('navigate refuses a javascript: target', () => {
  const { window, iframe, replies } = mount();
  act(window, { type: 'pawbar:act', id: 'n1', do: 'navigate', to: 'javascript:alert(1)', label: 'x' }, { source: iframe.contentWindow });
  assert.equal(replies[0].data.ok, false);
  assert.equal(replies[0].data.error, 'blocked');
});

test('navigate clicks a matching link on the page (SPA routers intercept it)', () => {
  const { window, iframe, replies, navigations } = mount({
    body: '<a id="dl" href="/products/cairn-boot" download>dl</a><a id="nt" href="/products/cairn-boot" target="_blank">nt</a><a id="go" href="/products/cairn-boot/">Cairn</a>',
  });
  const clicked = [];
  for (const a of window.document.querySelectorAll('a')) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      clicked.push(a.id);
    });
  }
  act(window, { type: 'pawbar:act', id: 'n2', do: 'navigate', to: HOST_ORIGIN + '/products/cairn-boot', label: 'Cairn boot' }, { source: iframe.contentWindow });
  assert.deepEqual(replies[0].data, { type: 'pawbar:act-result', id: 'n2', ok: true });
  assert.deepEqual(clicked, ['go']);
  assert.equal(navigations.length, 0);
});

test('navigate falls back to location.assign when no link matches', () => {
  const { window, iframe, replies, navigations } = mount({ body: '<a href="/other">Other</a>' });
  act(window, { type: 'pawbar:act', id: 'n3', do: 'navigate', to: '/products/cairn-boot', label: 'Cairn boot' }, { source: iframe.contentWindow });
  assert.equal(replies[0].data.ok, true);
  // jsdom does not navigate; it reports that it was asked to.
  assert.equal(navigations.length, 1);
});

test('navigate to the page the visitor is already on is a no-op success', () => {
  const { window, iframe, replies, navigations } = mount({ path: '/returns/' });
  act(window, { type: 'pawbar:act', id: 'n4', do: 'navigate', to: '/returns', label: 'Returns' }, { source: iframe.contentWindow });
  assert.equal(replies[0].data.ok, true);
  assert.equal(navigations.length, 0);
});

test('scroll_to matches a heading by text, case-folded', () => {
  const { window, iframe, replies } = mount({ body: '<p>Shipping returns</p><h3>Free <em>Returns</em> policy</h3><h2>Returns again</h2>' });
  act(window, { type: 'pawbar:act', id: 's1', do: 'scroll_to', target: 'free returns', label: 'Returns' }, { source: iframe.contentWindow });
  assert.equal(replies[0].data.ok, true);
  assert.equal(window.__scrolled[0].el.tagName, 'H3');
});

test('scroll_to reports not_found, and refuses markup in the target', () => {
  const { window, iframe, replies } = mount({ body: '<h2>Returns</h2>' });
  act(window, { type: 'pawbar:act', id: 's2', do: 'scroll_to', target: 'warranty', label: 'x' }, { source: iframe.contentWindow });
  act(window, { type: 'pawbar:act', id: 's3', do: 'scroll_to', target: '<h2>', label: 'x' }, { source: iframe.contentWindow });
  assert.deepEqual(replies.map((r) => r.data.error), ['not_found', 'not_found']);
  assert.equal(window.__scrolled.length, 0);
});

test('an unknown verb is unsupported', () => {
  const { window, iframe, replies } = mount();
  act(window, { type: 'pawbar:act', id: 'u1', do: 'click', target: '#x', label: 'x' }, { source: iframe.contentWindow });
  assert.deepEqual(replies[0].data, { type: 'pawbar:act-result', id: 'u1', ok: false, error: 'unsupported' });
});

test('highlight draws one overlay, leaves the element alone, and removes it after 2s', async () => {
  const { window, iframe, replies } = mount({ body: '<section id="boots" style="color: red">Boots</section>' });
  const el = window.document.getElementById('boots');
  const before = el.getAttribute('style');
  act(window, { type: 'pawbar:act', id: 'h1', do: 'highlight', target: '#boots', label: 'Boots' }, { source: iframe.contentWindow });
  act(window, { type: 'pawbar:act', id: 'h2', do: 'highlight', target: '#boots', label: 'Boots' }, { source: iframe.contentWindow });
  assert.equal(replies.length, 2);
  assert.equal(window.document.querySelectorAll('[data-pawbar-highlight]').length, 1, 'a second highlight replaces the first');
  const box = window.document.querySelector('[data-pawbar-highlight]');
  assert.equal(box.style.pointerEvents, 'none');
  assert.match(box.style.transition, /opacity/);
  assert.equal(el.getAttribute('style'), before);
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal(window.document.querySelectorAll('[data-pawbar-highlight]').length, 0);
});

test('highlight has no transition under reduced motion', () => {
  const { window, iframe } = mount({ body: '<h2 id="a">A</h2>', reducedMotion: true });
  act(window, { type: 'pawbar:act', id: 'h3', do: 'highlight', target: '#a', label: 'A' }, { source: iframe.contentWindow });
  const box = window.document.querySelector('[data-pawbar-highlight]');
  assert.equal(box.style.transition, '');
  assert.equal(window.__scrolled[0].opts.behavior, 'auto');
});

test('scroll_to does not draw an overlay', () => {
  const { window, iframe } = mount({ body: '<h2 id="a">A</h2>' });
  act(window, { type: 'pawbar:act', id: 's4', do: 'scroll_to', target: '#a', label: 'A' }, { source: iframe.contentWindow });
  assert.equal(window.document.querySelectorAll('[data-pawbar-highlight]').length, 0);
});

test('data-endpoint overrides the frame origin', () => {
  const { window, iframe, replies } = mount({ body: '<h2 id="a">A</h2>', endpointAttr: 'https://other.pawbar.dev/api/v1' });
  act(window, { type: 'pawbar:act', id: 'e1', do: 'scroll_to', target: '#a', label: 'A' }, { source: iframe.contentWindow });
  assert.equal(replies.length, 0, 'the frame is not on the overridden origin');
});

test('is idempotent: a second include adds no second listener', () => {
  const { window, iframe, replies } = mount({ body: '<h2 id="a">A</h2>' });
  const s = window.document.createElement('script');
  s.textContent = BUNDLE;
  window.document.body.appendChild(s);
  act(window, { type: 'pawbar:act', id: 'i1', do: 'scroll_to', target: '#a', label: 'A' }, { source: iframe.contentWindow });
  assert.equal(replies.length, 1);
});

test('navigate to a section of the current page scrolls to it', () => {
  const { window, iframe, replies, navigations } = mount({ path: '/faq', body: '<h2 id="returns">Returns</h2>' });
  act(window, { type: 'pawbar:act', id: 'n5', do: 'navigate', to: HOST_ORIGIN + '/faq/#returns', label: 'Returns' }, { source: iframe.contentWindow });
  assert.equal(replies[0].data.ok, true);
  assert.equal(window.__scrolled[0].el.id, 'returns');
  assert.equal(navigations.length, 0);
});

test('navigate with a fragment skips a link that would drop it', () => {
  const { window, iframe, navigations } = mount({ body: '<a id="go" href="/products/cairn-boot">Cairn</a>' });
  let clicked = 0;
  window.document.getElementById('go').addEventListener('click', (e) => {
    e.preventDefault();
    clicked++;
  });
  act(window, { type: 'pawbar:act', id: 'n6', do: 'navigate', to: '/products/cairn-boot#reviews', label: 'Reviews' }, { source: iframe.contentWindow });
  assert.equal(clicked, 0);
  assert.equal(navigations.length, 1);
});
