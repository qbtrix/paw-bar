// scripts/webmcp-demo.mjs — a WebMCP tool, end to end, in a real browser.
// The REAL built loader, actions.js (with data-webmcp) and app, on a fake
// member site that registers tools with document.modelContext.registerTool,
// and a fake backend whose concierge suggests one of them. Checks that the
// consequentialHint tool never reaches the chat request, that the confirm card
// shows the site's description and the exact args, and that Confirm runs the
// tool on the host page and the bar shows its result.
//
// Chrome ships WebMCP only behind an origin trial or a flag, and Playwright's
// Chromium has none, so the host page carries a small STUB of
// document.modelContext (registerTool, getTools, executeTool, toolchange).
// The stub lives in this demo page only; actions.js never defines it. Native
// Chrome behaviour is not checked here.
//
// Build first (repo root): `node loader/build.mjs && node actions/build.mjs`,
// then `npx vite build` in app/.
// Run from app/:  node scripts/webmcp-demo.mjs      prints PASS or FAIL
//   HEADED=1                       a visible browser, held open 8 s at the end
//   PW_CHROMIUM=/path/to/browser   browser override
// Screenshots go to test-results/webmcp-*.png.
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = new URL('../', import.meta.url);
const LOADER = readFileSync(new URL('../loader/dist/loader.js', ROOT));
const ACTIONS = readFileSync(new URL('../actions/dist/actions.js', ROOT));
const JS = readFileSync(new URL('dist/pawbar.js', ROOT));
const CSS = readFileSync(new URL('dist/pawbar.css', ROOT));
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';

const listen = (s) => new Promise((r) => s.listen(0, () => r(s.address().port)));
let frameOrigin = '';
const chatBodies = [];

// The stand-in for a browser with WebMCP. Spec shape: getTools returns copies
// without execute; executeTool returns the JSON of what execute returned.
const STUB = `(() => {
  if (document.modelContext) return;
  const reg = new Map();
  const mc = new EventTarget();
  const changed = () => mc.dispatchEvent(new Event('toolchange'));
  mc.registerTool = async (t, o = {}) => {
    if (reg.has(t.name)) throw new DOMException(t.name, 'InvalidStateError');
    reg.set(t.name, t);
    o.signal?.addEventListener('abort', () => (reg.delete(t.name), changed()));
    changed();
  };
  mc.getTools = async () =>
    [...reg.values()].map(({ execute, ...t }) => ({ ...structuredClone(t), origin: location.origin }));
  mc.executeTool = async (rt, input = {}, o = {}) => {
    const t = reg.get(rt.name);
    if (!t) throw new DOMException(rt.name, 'NotFoundError');
    return JSON.stringify((await t.execute(input, o)) ?? null);
  };
  document.modelContext = mc;
})();`;

// What a member site (SNCTM-style) would write: standard WebMCP, nothing Paw Bar specific.
const SITE_TOOLS = `
const log = (t) => (document.getElementById('log').textContent = t);
[
  {
    name: 'request_invitation',
    description: 'Request an invitation to an upcoming event for the signed-in member',
    inputSchema: {
      type: 'object',
      properties: { event_slug: { type: 'string', enum: ['winter-ball', 'spring-salon'], description: 'Which event' } },
      required: ['event_slug'],
    },
    execute: async ({ event_slug }) => (log('Invitation requested: ' + event_slug), 'Invitation requested for ' + event_slug),
  },
  {
    name: 'get_application_status',
    description: "Look up the signed-in member's application status",
    annotations: { readOnlyHint: true },
    execute: async () => 'Your application is under review',
  },
  {
    name: 'checkout',
    description: 'Pay for everything in the cart',
    annotations: { consequentialHint: true },
    execute: async () => (log('PAID (must never happen)'), 'Paid'),
  },
].forEach((t) => document.modelContext?.registerTool(t));`;

const host = createServer((req, res) => {
  if (req.url.startsWith('/loader.js') || req.url.startsWith('/paw-bar/actions.js')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(req.url.startsWith('/loader.js') ? LOADER : ACTIONS);
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Members · Events</title>
<style>body{margin:0;font:16px system-ui;background:#14110f;color:#eee}main{padding:48px;max-width:860px;margin:auto}
.card{border:1px solid #333;border-radius:14px;padding:20px;margin:16px 0}#log{font:600 15px ui-monospace,monospace;color:#9fe39f}</style>
<script>${STUB}</script></head>
<body><main><h1>Upcoming events</h1>
<div class="card"><h2>Winter Ball</h2><p>December, members and guests.</p></div>
<div class="card"><h2>Spring Salon</h2><p>March, members only.</p></div>
<p id="log">No tool has run.</p></main>
<script>${SITE_TOOLS}</script>
<script src="/loader.js" data-site-key="sk_test" data-widget-id="w_webmcp" data-endpoint="${frameOrigin}/api/v1"></script>
<script src="/paw-bar/actions.js" data-endpoint="${frameOrigin}/api/v1" data-webmcp defer></script>
</body></html>`);
});

const REPLY = 'The Winter Ball still has room. I can ask for an invitation for you.';
const ACTION = {
  do: 'tool',
  name: 'request_invitation',
  args: { event_slug: 'winter-ball' },
  label: 'Request a Winter Ball invitation',
};

const frame = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  if (url.pathname === '/api/v1/paw-bar/frame') {
    const cfg = { siteKey: 'sk_test', widgetId: 'w_webmcp', endpoint: frameOrigin + '/api/v1', parentOrigin: url.searchParams.get('po'), mode: 'concierge' };
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `sandbox ${SANDBOX}` });
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/pawbar.css"><script>window.__PAWBAR__=${JSON.stringify(cfg)}</script></head>
<body><div id="pawbar-app"></div><script type="module" src="/pawbar.js"></script></body></html>`);
  }
  if (url.pathname === '/pawbar.js' || url.pathname === '/pawbar.css') {
    res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' });
    return res.end(url.pathname.endsWith('.js') ? JS : CSS);
  }
  if (url.pathname === '/api/v1/paw-bar/chat') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        chatBodies.push(JSON.parse(body));
      } catch {
        chatBodies.push(null);
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
      const words = REPLY.split(/(?<= )/);
      let i = 0;
      const t = setInterval(() => {
        if (i < words.length) return res.write(`event: chunk\ndata: ${JSON.stringify({ content: words[i++], type: 'text' })}\n\n`);
        clearInterval(t);
        res.write(`event: action\ndata: ${JSON.stringify({ action: ACTION })}\n\n`);
        res.write(`event: stream_end\ndata: {}\n\n`);
        res.end();
      }, 25);
    });
    return;
  }
  if (url.pathname === '/api/v1/paw-bar/conversations') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    return res.end(
      req.method === 'POST'
        ? JSON.stringify({ id: 'c' + Date.now(), state: 'open', preview: '', last_message_at: new Date().toISOString(), active: true })
        : JSON.stringify({ conversations: [] }),
    );
  }
  res.writeHead(404, cors);
  res.end('{}');
});

const hostOrigin = `http://localhost:${await listen(host)}`;
frameOrigin = `http://127.0.0.1:${await listen(frame)}`;

mkdirSync('test-results', { recursive: true });
const headed = !!process.env.HEADED;
const browser = await chromium.launch({ headless: !headed, executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push('host: ' + e));
const fails = [];
const check = (ok, what) => (ok ? console.log('  ok  ', what) : (fails.push(what), console.log('  FAIL', what)));
const fr = () => page.frames().find((f) => f.url().includes('/paw-bar/frame'));
const shot = (n) => page.screenshot({ path: `test-results/webmcp-${n}.png` });

await page.goto(hostOrigin);
await page.waitForTimeout(1500);
await fr().click('.pawbar');
await page.waitForTimeout(600);
await fr().fill('textarea', 'Can I get into the Winter Ball?');
await fr().press('textarea', 'Enter');
await fr().waitForSelector('.tool-confirm', { timeout: 10000 });
await page.waitForTimeout(400);
await shot('confirm');

const sent = (chatBodies[0]?.page?.tools ?? []).map((t) => t.name);
console.log('page.tools sent to the server:', sent.join(', ') || '(none)');
check(sent.includes('request_invitation') && sent.includes('get_application_status'), 'WebMCP tools reach the chat request');
check(!sent.includes('checkout'), 'the consequentialHint tool is never offered');
const card = await fr().locator('.tool-confirm').innerText();
console.log('confirm card:\n' + card.replace(/^/gm, '    '));
check(card.includes('Request an invitation to an upcoming event'), "the card shows the site's description");
check(/event_slug\s*winter-ball/.test(card), 'the card shows the exact args');
check((await page.locator('#log').innerText()) === 'No tool has run.', 'nothing ran before Confirm');

await fr().locator('.tool-confirm button', { hasText: 'Confirm' }).click();
await page.waitForFunction(() => document.getElementById('log').textContent !== 'No tool has run.', null, { timeout: 12000 });
await page.waitForTimeout(400);
await shot('done');
check((await page.locator('#log').innerText()) === 'Invitation requested: winter-ball', 'Confirm ran the tool on the host page');
check((await fr().locator('body').innerText()).includes('Invitation requested for winter-ball'), "the bar shows the tool's result");
check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));

if (headed) await page.waitForTimeout(8000);
await browser.close();
host.close();
frame.close();
console.log(fails.length ? `FAIL (${fails.length})` : 'PASS');
process.exit(fails.length ? 1 : 0);
