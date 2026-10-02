// actions/test/actions.test.mjs — jsdom tests for the page-actions host script.
// Runs dist/actions.js (the shipped IIFE, so build first) inside a jsdom host
// page with a Paw Bar iframe, forges `pawbar:act` messages with explicit origin
// and source, and records the `pawbar:act-result` replies the script posts.
// Covers: spoofed source/origin ignored, cross-origin navigate refused, anchor
// click vs location.assign, #id and heading lookups, the overlay fade (and its
// absence under reduced motion), and the overlay cleared by navigate/popstate.
// Site tools: the window.pawbarTools queue (drained, push replaced), the
// checks and limits kept here, the pawbar:tools post (debounced, on request,
// never to a spoofed asker), and do:'tool' runs: result message, failure,
// throw, unknown name, absent args, and the 10 s timeout (shortened here).

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

function mount({ body = '', path = '/', reducedMotion = false, endpointAttr = null, before = null } = {}) {
  const navigations = [];
  const warns = [];
  const vc = new VirtualConsole();
  vc.on('warn', (...args) => warns.push(args.join(' ')));
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

  if (before) before(window);
  const s = window.document.createElement('script');
  if (endpointAttr) s.setAttribute('data-endpoint', endpointAttr);
  // An inline script has no src, so currentScript.src is ''. Give the IIFE the
  // src it would have when served, the way a real include sees it.
  Object.defineProperty(s, 'src', { get: () => ENDPOINT + '/paw-bar/actions.js' });
  s.textContent = BUNDLE;
  window.document.body.appendChild(s);
  return { window, iframe, replies, navigations, warns };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await sleep(2100);
  // Fades first: still there, opacity 0, then removed once the fade is over
  // (jsdom fires no transitionend, so the fallback timer does it).
  assert.equal(window.document.querySelectorAll('[data-pawbar-highlight]').length, 1, 'fades before removal');
  assert.equal(box.style.opacity, '0');
  await sleep(500);
  assert.equal(window.document.querySelectorAll('[data-pawbar-highlight]').length, 0);
});

test('a faded highlight is removed on transitionend', async () => {
  const { window, iframe } = mount({ body: '<h2 id="a">A</h2>' });
  act(window, { type: 'pawbar:act', id: 'h4', do: 'highlight', target: '#a', label: 'A' }, { source: iframe.contentWindow });
  const box = window.document.querySelector('[data-pawbar-highlight]');
  await sleep(2050);
  assert.equal(box.style.opacity, '0');
  box.dispatchEvent(new window.Event('transitionend'));
  assert.equal(box.isConnected, false);
});

test('under reduced motion the highlight is removed at once, never faded', async () => {
  const { window, iframe } = mount({ body: '<h2 id="a">A</h2>', reducedMotion: true });
  act(window, { type: 'pawbar:act', id: 'h5', do: 'highlight', target: '#a', label: 'A' }, { source: iframe.contentWindow });
  const box = window.document.querySelector('[data-pawbar-highlight]');
  const opacities = [];
  new window.MutationObserver(() => opacities.push(box.style.opacity)).observe(box, { attributes: true });
  await sleep(2050);
  assert.equal(box.isConnected, false);
  assert.deepEqual(opacities, [], 'no fade step');
});

test('navigate clears a highlight at once', () => {
  const { window, iframe } = mount({ body: '<h2 id="a">A</h2><a href="/other">Other</a>' });
  window.document.querySelector('a').addEventListener('click', (e) => e.preventDefault());
  act(window, { type: 'pawbar:act', id: 'h6', do: 'highlight', target: '#a', label: 'A' }, { source: iframe.contentWindow });
  assert.equal(window.document.querySelectorAll('[data-pawbar-highlight]').length, 1);
  act(window, { type: 'pawbar:act', id: 'n7', do: 'navigate', to: '/other', label: 'Other' }, { source: iframe.contentWindow });
  assert.equal(window.document.querySelectorAll('[data-pawbar-highlight]').length, 0);
});

test('popstate clears a highlight at once', () => {
  const { window, iframe } = mount({ body: '<h2 id="a">A</h2>' });
  act(window, { type: 'pawbar:act', id: 'h7', do: 'highlight', target: '#a', label: 'A' }, { source: iframe.contentWindow });
  window.dispatchEvent(new window.PopStateEvent('popstate', { state: null }));
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

// ── Site tools ────────────────────────────────────────────────────────────────
const SCHEMA = {
  type: 'object',
  properties: {
    product: { type: 'string', description: 'Product page path or SKU' },
    quantity: { type: 'integer', minimum: 1, maximum: 20 },
  },
  required: ['product'],
};
const cartTool = (over = {}) => ({
  name: 'add_to_cart',
  description: 'Add a product to the cart',
  inputSchema: SCHEMA,
  execute: async () => ({ ok: true, message: 'Added Cairn 45 to your cart' }),
  ...over,
});
const toolLists = (replies) => replies.filter((r) => r.data.type === 'pawbar:tools');
const results = (replies) => replies.filter((r) => r.data.type === 'pawbar:act-result');
const runTool = (window, iframe, data, source = iframe.contentWindow) =>
  act(window, { type: 'pawbar:act', id: 't1', do: 'tool', ...data }, { source });

test('drains tools queued before it loaded, then takes over push', async () => {
  const { window, replies } = mount({ before: (w) => (w.pawbarTools = [cartTool()]) });
  const n = window.pawbarTools.push(cartTool({ name: 'pick_size', confirm: false }));
  assert.equal(n, 2);
  await sleep(80);
  const lists = toolLists(replies);
  assert.equal(lists.length, 1, 'one debounced post');
  assert.equal(lists[0].origin, FRAME_ORIGIN);
  assert.deepEqual(lists[0].data.tools, [
    { name: 'add_to_cart', description: 'Add a product to the cart', inputSchema: SCHEMA, confirm: true },
    { name: 'pick_size', description: 'Add a product to the cart', inputSchema: SCHEMA, confirm: false },
  ]);
});

test('a queue made after it loaded works the same way', async () => {
  const { window, replies } = mount();
  window.pawbarTools = window.pawbarTools || [];
  window.pawbarTools.push(cartTool());
  window.pawbarTools.push(cartTool({ name: 'other' }));
  await sleep(80);
  const lists = toolLists(replies);
  assert.equal(lists.length, 1);
  assert.deepEqual(lists[0].data.tools.map((t) => t.name), ['add_to_cart', 'other']);
});

test('posts nothing at boot when no tools were queued', async () => {
  const { replies } = mount();
  await sleep(80);
  assert.equal(toolLists(replies).length, 0);
});

test('rejects a bad tool with a warning and keeps the others', async () => {
  // 2,049 characters of compact JSON.
  const big = { type: 'object', properties: { p: { type: 'string', description: '' } } };
  big.properties.p.description = 'x'.repeat(2049 - JSON.stringify(big).length);
  const { window, replies, warns } = mount();
  window.pawbarTools.push(
    cartTool({ name: 'Bad-Name' }),
    cartTool({ name: 'no_exec', execute: 'nope' }),
    cartTool({ name: 'no_desc', description: 5 }),
    cartTool({ name: 'no_schema', inputSchema: undefined }),
    cartTool({ name: 'too_big', inputSchema: big }),
    cartTool(),
  );
  await sleep(80);
  assert.deepEqual(toolLists(replies)[0].data.tools.map((t) => t.name), ['add_to_cart']);
  assert.equal(warns.length, 5);
  window.pawbarTools.push(cartTool({ name: 'no_props', inputSchema: { type: 'object' } }));
  big.properties.p.description = big.properties.p.description.slice(1);
  window.pawbarTools.push(cartTool({ name: 'at_limit', inputSchema: big }));
  await sleep(80);
  assert.deepEqual(toolLists(replies)[1].data.tools.map((t) => t.name), ['add_to_cart', 'no_props', 'at_limit']);
  assert.match(warns[0], /tool rejected/);
});

test('keeps at most 12 tools, and a repeated name replaces its tool', async () => {
  const { window, replies } = mount();
  for (let i = 1; i <= 13; i++) window.pawbarTools.push(cartTool({ name: `tool_${i}` }));
  window.pawbarTools.push(cartTool({ name: 'tool_1', description: 'again' }));
  await sleep(80);
  const tools = toolLists(replies)[0].data.tools;
  assert.equal(tools.length, 12);
  assert.equal(tools[0].description, 'again');
  assert.ok(!tools.some((t) => t.name === 'tool_13'));
});

test('sends a copy of the schema, not the live object', async () => {
  const schema = structuredClone(SCHEMA);
  const { window, replies } = mount();
  window.pawbarTools.push(cartTool({ inputSchema: schema }));
  schema.properties.quantity.maximum = 999;
  await sleep(80);
  assert.equal(toolLists(replies)[0].data.tools[0].inputSchema.properties.quantity.maximum, 20);
});

test('answers the frame with the list on pawbar:tools-request', () => {
  const { window, iframe, replies } = mount({ before: (w) => (w.pawbarTools = [cartTool()]) });
  act(window, { type: 'pawbar:tools-request' }, { source: iframe.contentWindow });
  const lists = toolLists(replies);
  assert.equal(lists.length, 1);
  assert.equal(lists[0].origin, FRAME_ORIGIN);
  assert.equal(lists[0].data.tools[0].name, 'add_to_cart');
  assert.ok(!('execute' in lists[0].data.tools[0]));
});

test('ignores a spoofed pawbar:tools-request', () => {
  const { window, iframe, replies } = mount({ before: (w) => (w.pawbarTools = [cartTool()]) });
  act(window, { type: 'pawbar:tools-request' }, { source: window });
  act(window, { type: 'pawbar:tools-request' }, { origin: HOST_ORIGIN, source: iframe.contentWindow });
  assert.equal(toolLists(replies).length, 0);
});

test('runs a tool and replies with its message', async () => {
  let got = null;
  const execute = async (args) => {
    got = args;
    return { ok: true, message: 'Added Cairn 45 to your cart' };
  };
  const { window, iframe, replies } = mount({ before: (w) => (w.pawbarTools = [cartTool({ execute })]) });
  runTool(window, iframe, { name: 'add_to_cart', args: { product: '/products/cairn-45/', quantity: 1 } });
  await sleep(10);
  assert.deepEqual(got, { product: '/products/cairn-45/', quantity: 1 });
  assert.deepEqual(results(replies), [
    { data: { type: 'pawbar:act-result', id: 't1', ok: true, message: 'Added Cairn 45 to your cart' }, origin: FRAME_ORIGIN },
  ]);
});

test('clips a long message to 160 and treats a bare return as done', async () => {
  const { window, iframe, replies } = mount({
    before: (w) =>
      (w.pawbarTools = [
        cartTool({ execute: () => ({ message: 'm'.repeat(300) }) }),
        cartTool({ name: 'quiet', execute: () => undefined }),
      ]),
  });
  runTool(window, iframe, { name: 'add_to_cart', args: { product: 'x' } });
  act(window, { type: 'pawbar:act', id: 't2', do: 'tool', name: 'quiet', args: {} }, { source: iframe.contentWindow });
  await sleep(10);
  const [a, b] = results(replies).map((r) => r.data);
  assert.equal(a.ok, true);
  assert.equal(a.message.length, 160);
  assert.deepEqual(b, { type: 'pawbar:act-result', id: 't2', ok: true });
});

test('a tool that says no, throws, or rejects has failed', async () => {
  const { window, iframe, replies } = mount({
    before: (w) =>
      (w.pawbarTools = [
        cartTool({ name: 'no', execute: async () => ({ ok: false, message: 'Out of stock' }) }),
        cartTool({
          name: 'throws',
          execute: () => {
            throw new Error('boom');
          },
        }),
        cartTool({ name: 'rejects', execute: () => Promise.reject(new Error('boom')) }),
      ]),
  });
  for (const name of ['no', 'throws', 'rejects']) {
    act(window, { type: 'pawbar:act', id: name, do: 'tool', name, args: {} }, { source: iframe.contentWindow });
  }
  await sleep(10);
  // Each settles on its own tick; compare in a fixed order.
  const order = ['no', 'throws', 'rejects'];
  assert.deepEqual(
    results(replies)
      .map((r) => r.data)
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
    [
      { type: 'pawbar:act-result', id: 'no', ok: false, error: 'failed', message: 'Out of stock' },
      { type: 'pawbar:act-result', id: 'throws', ok: false, error: 'failed' },
      { type: 'pawbar:act-result', id: 'rejects', ok: false, error: 'failed' },
    ],
  );
});

test('an unknown tool is not_found and nothing runs', () => {
  let ran = 0;
  const { window, iframe, replies } = mount({ before: (w) => (w.pawbarTools = [cartTool({ execute: () => ran++ })]) });
  runTool(window, iframe, { name: 'remove_from_cart', args: {} });
  runTool(window, iframe, { name: 'toString', args: {} });
  assert.deepEqual(results(replies).map((r) => r.data.error), ['not_found', 'not_found']);
  assert.equal(ran, 0);
});

test('absent args reach execute as {}', async () => {
  let got = null;
  const { window, iframe, replies } = mount({ before: (w) => (w.pawbarTools = [cartTool({ execute: (a) => void (got = a) })]) });
  act(window, { type: 'pawbar:act', id: 't4', do: 'tool', name: 'add_to_cart' }, { source: iframe.contentWindow });
  await sleep(10);
  assert.equal(JSON.stringify(got), '{}');
  assert.deepEqual(results(replies).map((r) => r.data), [{ type: 'pawbar:act-result', id: 't4', ok: true }]);
});

test('a spoofed tool act never runs the tool', async () => {
  let ran = 0;
  const { window, iframe, replies } = mount({ before: (w) => (w.pawbarTools = [cartTool({ execute: () => ran++ })]) });
  runTool(window, iframe, { name: 'add_to_cart', args: { product: 'x' } }, window);
  act(
    window,
    { type: 'pawbar:act', id: 't1', do: 'tool', name: 'add_to_cart', args: { product: 'x' } },
    { origin: HOST_ORIGIN, source: iframe.contentWindow },
  );
  await sleep(10);
  assert.equal(ran, 0);
  assert.equal(results(replies).length, 0);
});

test('a tool that never settles times out, and a late answer sends nothing more', async () => {
  let finish;
  const { window, iframe, replies } = mount({
    before: (w) => {
      // The real wait is 10 s; shorten only that one.
      const st = w.setTimeout.bind(w);
      w.setTimeout = (fn, ms, ...rest) => st(fn, ms === 10000 ? 20 : ms, ...rest);
      w.pawbarTools = [cartTool({ execute: () => new Promise((r) => (finish = r)) })];
    },
  });
  runTool(window, iframe, { name: 'add_to_cart', args: { product: 'x' } });
  await sleep(60);
  finish({ ok: true, message: 'late' });
  await sleep(10);
  assert.deepEqual(
    results(replies).map((r) => r.data),
    [{ type: 'pawbar:act-result', id: 't1', ok: false, error: 'timeout' }],
  );
});
