// scripts/widget-harness.mjs — the widget end to end in a real browser.
// Created 2026-09-27 (new bar wiring). The REAL built loader on a fake customer
// page (with two click counters), the REAL built app in its sandboxed frame,
// and a fake backend that streams replies. jsdom has no layout and cannot see
// the iframe box, which is where this widget breaks (see the loader header),
// so this is the check for anything that changes sizing or the protocol.
//
// Build first: `node loader/build.mjs` (repo root) and `npx vite build` (app).
// 2026-09-27 (old shell removed): dropped the `glass` scenario, which checked a
// VITE_PAWBAR_UI=glass build. That build no longer exists.
//
// Run from app/:  node scripts/widget-harness.mjs
//   SCEN=main|icon|phone|consent|leave|viewport|grow  (default main)
//   BOOT='{"launcher":"icon","side":"left"}'     boot config overrides
//   VW=390 VH=800                                viewport
// Prints the iframe box at each step; screenshots go to test-results/wh-*.png.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = new URL('../', import.meta.url);
const LOADER = readFileSync(new URL('../loader/dist/loader.js', ROOT));
const JS = readFileSync(new URL('dist/pawbar.js', ROOT));
const CSS = readFileSync(new URL('dist/pawbar.css', ROOT));
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';
const boot = JSON.parse(process.env.BOOT || '{}');

const listen = (s) => new Promise((r) => s.listen(0, () => r(s.address().port)));
let hostOrigin = '';
let frameOrigin = '';

const host = createServer((req, res) => {
  if (req.url.startsWith('/loader.js')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(LOADER);
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;font:16px system-ui;background:#f4f1ea;color:#222}main{padding:40px;max-width:900px;margin:auto}
.hero{height:420px;border-radius:16px;background:linear-gradient(120deg,#8ea2ff,#ffd0a1)}#hit{position:fixed;left:20px;bottom:20px;width:180px;height:120px;background:#222;color:#fff;border:0;border-radius:12px;font:600 16px system-ui}
#hit2{position:fixed;right:20px;top:120px;width:180px;height:80px;background:#335;color:#fff;border:0;border-radius:12px}</style></head>
<body><main><h1>Ocean Supply</h1><p>Customer page.</p><div class="hero"></div><p>More content.</p></main>
<button id="hit" onclick="this.dataset.n=(+this.dataset.n||0)+1;this.textContent='clicks '+this.dataset.n">clicks 0</button>
<button id="hit2" onclick="this.dataset.n=(+this.dataset.n||0)+1;this.textContent='clicks '+this.dataset.n">clicks 0</button>
<script src="/loader.js" data-site-key="sk_test" data-widget-id="w_test" data-endpoint="${frameOrigin}/api/v1"></script>
</body></html>`);
});

const REPLY =
  'Yes, we ship to Oslo. Orders to Norway usually arrive in 3 to 5 working days, and you get a tracking link as soon as the parcel leaves our warehouse.\n\nIf you need it sooner, express shipping is available at checkout.';

const frame = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  if (url.pathname === '/api/v1/paw-bar/frame') {
    const cfg = {
      siteKey: 'sk_test',
      widgetId: 'w_test',
      endpoint: frameOrigin + '/api/v1',
      parentOrigin: url.searchParams.get('po'),
      mode: 'concierge',
      ...boot,
    };
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `sandbox ${SANDBOX}` });
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/pawbar.css"><script>window.__PAWBAR__=${JSON.stringify(cfg)}</script></head>
<body><div id="pawbar-app"></div><script type="module" src="/pawbar.js"></script></body></html>`);
  }
  if (url.pathname === '/pawbar.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(JS);
  }
  if (url.pathname === '/pawbar.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' });
    return res.end(CSS);
  }
  if (url.pathname === '/api/v1/paw-bar/chat') {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream' });
    const words = REPLY.split(/(?<= )/);
    let i = 0;
    const t = setInterval(() => {
      if (i < words.length) res.write(`event: chunk\ndata: ${JSON.stringify({ content: words[i++], type: 'text' })}\n\n`);
      else {
        clearInterval(t);
        res.write(`event: stream_end\ndata: {}\n\n`);
        res.end();
      }
    }, 25);
    return;
  }
  if (url.pathname === '/api/v1/paw-bar/conversations') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    return res.end(req.method === 'POST' ? JSON.stringify({ id: 'c' + Date.now(), state: 'open', preview: '', last_message_at: new Date().toISOString(), active: true }) : JSON.stringify({ conversations: [] }));
  }
  res.writeHead(404, cors);
  res.end('{}');
});

hostOrigin = `http://localhost:${await listen(host)}`;
frameOrigin = `http://127.0.0.1:${await listen(frame)}`;

const W = +(process.env.VW || 1280);
const H = +(process.env.VH || 820);
const browser = await chromium.launch();
// The screen differs from the viewport on purpose: it tells the loader's
// pawbar:viewport message apart from the app's screen-size fallback.
const context = await browser.newContext({ viewport: { width: W, height: H }, screen: { width: 1920, height: 1080 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('host: ' + e));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
await page.goto(hostOrigin);
await page.waitForTimeout(1200);

const box = () => page.evaluate(() => {
  const f = document.querySelector('iframe');
  const r = f.getBoundingClientRect();
  return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
});
const fr = () => page.frames().find((f) => f.url().includes('/paw-bar/frame'));
const shot = (n) => page.screenshot({ path: `test-results/wh-${n}.png` });
const log = (...a) => console.log(...a);
const hits = () => page.evaluate(() => [document.getElementById('hit').dataset.n || '0', document.getElementById('hit2').dataset.n || '0'].join('/'));
const raf = (n = 10) => fr().evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

log('rest box', await box());
await shot('rest');

const SCEN = process.env.SCEN || 'main';
if (SCEN !== 'main') {
  const tag = SCEN;
  if (SCEN === 'icon') {
    await fr().click('.launch');
    await page.waitForTimeout(700);
    log('icon open box', await box());
    await shot(tag + '-open');
    await fr().fill('textarea', 'Do you ship to Oslo?');
    await fr().press('textarea', 'Enter');
    await page.waitForTimeout(3500);
    log('icon thread box', await box());
    await shot(tag + '-thread');
  } else if (SCEN === 'phone') {
    await fr().click('.pawbar');
    await page.waitForTimeout(700);
    log('phone open box', await box());
    await shot(tag + '-open');
    await fr().fill('textarea', 'Do you ship to Oslo?');
    await fr().press('textarea', 'Enter');
    await page.waitForTimeout(3500);
    log('phone thread box', await box());
    await shot(tag + '-thread');
  } else if (SCEN === 'leave') {
    // A hover-opened card must fold when the pointer leaves the iframe.
    const b = await page.locator('iframe').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(600);
    log('hovered box', await box());
    await page.mouse.move(10, 100);
    await page.waitForTimeout(600);
    log('left box', await box());
    await shot(tag);
  } else if (SCEN === 'grow') {
    // Does the box trail the card while it springs open? Samples the content's
    // height against the iframe's every frame through a hover-open.
    const b = await page.locator('iframe').boundingBox();
    await fr().evaluate(() => {
      window.__g = [];
      const t0 = performance.now();
      const f = () => {
        const w = document.querySelector('.frame-wrap').getBoundingClientRect();
        window.__g.push([Math.round(performance.now() - t0), Math.round(w.height + 16), innerHeight]);
        if (performance.now() - t0 < 900) requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(1000);
    const g = await fr().evaluate(() => window.__g);
    const clipped = g.filter(([, need, have]) => need > have + 1);
    log('frames', g.length, 'frames where content was taller than the box', clipped.length, 'worst', clipped.reduce((m, [, n, h]) => Math.max(m, n - h), 0) + 'px');
  } else if (SCEN === 'viewport') {
    const hostW = await fr().evaluate(() => getComputedStyle(document.querySelector('.frame-wrap')).getPropertyValue('--pb-host-w'));
    log('frame --pb-host-w', hostW || '(unset)', 'host innerWidth', W, 'screen 1920');
  } else if (SCEN === 'consent') {
    await fr().click('.pawbar');
    await page.waitForTimeout(600);
    await fr().fill('textarea', 'Do you ship to Oslo?');
    await fr().press('textarea', 'Enter');
    await page.waitForTimeout(500);
    log('consent storage before accept', await fr().evaluate(() => Object.keys(localStorage).join(',') || '(empty)'));
    await shot(tag + '-held');
    await fr().click('.consent button:has-text("Accept")');
    await page.waitForTimeout(3500);
    log('consent storage after accept', await fr().evaluate(() => Object.keys(localStorage).join(',')));
    await shot(tag + '-accepted');
  }
  console.log('errors:', errors.filter((e) => !e.includes('404')).join(' | ') || 'none');
  await browser.close();
  host.close();
  frame.close();
  process.exit(0);
}

// Hover open.
const ib = await page.locator('iframe').boundingBox();
await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
await page.waitForTimeout(700);
log('hover box', await box());
await shot('hover');

// Pin and send.
await fr().click('textarea');
await fr().fill('textarea', 'Do you ship to Oslo?');
await fr().press('textarea', 'Enter');
await page.waitForTimeout(3500);
await raf(20);
log('thread box', await box());
await shot('thread');

// Host click while open: counter goes up and the bar folds (no draft).
await page.click('#hit2');
await page.waitForTimeout(700);
log('after host click box', await box(), 'hits', await hits());
await shot('after-host-click');

// Width stability across open/close cycles.
for (let i = 0; i < 3; i++) {
  await fr().click('.pawbar');
  await page.waitForTimeout(600);
  const b = await box();
  await page.click('#hit2');
  await page.waitForTimeout(600);
  log('cycle', i, 'open', b, 'closed', await box());
}

// Full screen and back.
await fr().click('.pawbar');
await page.waitForTimeout(500);
await fr().click('button[aria-label="Full screen"]');
await page.waitForTimeout(700);
log('full box', await box());
await shot('full');
await fr().click('button[aria-label="Exit full screen"]');
await page.waitForTimeout(700);
log('after full box', await box());
await shot('after-full');
await fr().click('button[aria-label="Close chat"]');
await page.waitForTimeout(700);
log('closed box', await box(), 'hits', await hits());
await page.click('#hit');
log('hits after', await hits());
await shot('closed');

console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
host.close();
frame.close();
