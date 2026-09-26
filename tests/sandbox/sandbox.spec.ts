// tests/sandbox/sandbox.spec.ts — the widget frame's sandbox, in real browsers.
// Created 2026-09-26.
//
// The loader sandboxes the frame (FRAME_SANDBOX in loader/src/loader.ts) and
// the server sends the same flags as a `Content-Security-Policy: sandbox`
// header. The loader's jsdom test pins the attribute string and its ordering;
// jsdom enforces nothing, so THIS file proves what the flag set actually does
// in Chromium, Firefox and WebKit:
//
//   BLOCKED  a target=_top link and a scripted top.location both leave the host
//            page where it was, with the attribute + header together AND with
//            the header alone; alert() is swallowed (allow-modals is absent).
//            WebKit opens a refused _top link as a new window instead of
//            dropping it; see expectHostUntouched.
//   WORKS    the iframe carries the exact attribute; the composer's
//            Enter-to-submit; window.open and target=_blank popups, which open
//            UNsandboxed; a Blob <a download>; localStorage across a reload;
//            clipboard writeText where the engine lets a test grant it.
//
// The host page runs the real built loader against a frame on another origin
// (see servers.ts), so the iframe under test is the one the loader made.
//
// Not covered: the full glass app under the sandbox. Serving it needs vite dev
// with a per-path CSP header, a /paw-bar/frame -> demo.html rewrite, and an
// app/ install in this job, which is more machinery than one smoke test earns.

import { test as base, expect, type Frame, type FrameLocator, type Page } from '@playwright/test';
import { FRAME_SANDBOX, startSandboxServers, type SandboxServers } from './servers';

const test = base.extend<{}, { servers: SandboxServers }>({
  servers: [
    async ({}, use) => {
      const s = await startSandboxServers();
      await use(s);
      await s.close();
    },
    { scope: 'worker' },
  ],
});

interface Host {
  frame: FrameLocator;
  /** Top-level navigations of the host page since it finished loading. */
  navigations: () => number;
  /** New pages (tabs/windows) opened in the context since the host loaded. */
  newPages: () => number;
  url: string;
}

async function openHost(page: Page, servers: SandboxServers, path = '/'): Promise<Host> {
  servers.reset();
  const url = servers.hostOrigin + path;
  await page.goto(url);
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#ready')).toHaveText('ready');
  // The fixture asks the loader for the open column, and the loader eases the
  // box there (~260ms). Playwright's stability check measures the element inside
  // the frame, not the iframe moving underneath it, so a click during the ease
  // can land on the wrong control. Wait for the box to stop.
  const iframe = page.locator('iframe');
  let last = '';
  await expect
    .poll(async () => {
      const now = JSON.stringify(await iframe.boundingBox());
      const still = now === last;
      last = now;
      return still;
    }, { intervals: [150] })
    .toBe(true);
  let navs = 0;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navs++;
  });
  let opened = 0;
  page.context().on('page', () => opened++);
  return { frame, navigations: () => navs, newPages: () => opened, url };
}

function frameOf(page: Page): Frame {
  const f = page.frames().find((fr) => fr.url().includes('/paw-bar/frame'));
  if (!f) throw new Error('fixture frame not found');
  return f;
}

/** Give a blocked navigation every chance to happen before asserting it didn't. */
async function settle(page: Page) {
  await page.waitForTimeout(750);
}

async function expectHostUntouched(page: Page, servers: SandboxServers, host: Host, browserName: string) {
  await settle(page);
  // The property that matters: the customer's page is still the customer's page.
  expect(page.url()).toBe(host.url);
  expect(host.navigations()).toBe(0);
  await expect(page.locator('#host-marker')).toBeVisible();
  // And nothing reached /pwned through it. WebKit (measured 2026-09-26, WebKit
  // 26.0) handles a sandbox-refused target=_top link by opening the URL in a NEW
  // window instead, which allow-popups permits; Chromium and Firefox drop it.
  // So on WebKit a /pwned hit is allowed only as a separate page, never the host.
  // The app's sanitizer strips target=_top before it gets this far (PR #16).
  if (browserName === 'webkit') {
    expect(host.newPages()).toBeLessThanOrEqual(1);
  } else {
    expect(host.newPages()).toBe(0);
  }
  expect(servers.pwnedHits()).toBe(host.newPages());
}

// ── BLOCKED ────────────────────────────────────────────────────────────────

for (const [label, path] of [
  ['loader frame (attribute + CSP header)', '/'],
  ['bare frame (CSP header only)', '/header-only'],
] as const) {
  test.describe(`blocked: ${label}`, () => {
    test('a target=_top link cannot navigate the host page', async ({ page, servers, browserName }) => {
      const host = await openHost(page, servers, path);
      // Sanity: the link really points at the host's /pwned, so a pass below is
      // the sandbox stopping it, not a dead link.
      await expect(host.frame.locator('#top-link')).toHaveAttribute('href', servers.hostOrigin + '/pwned');
      await host.frame.locator('#top-link').click();
      await expectHostUntouched(page, servers, host, browserName);
    });

    test('a scripted top.location cannot navigate the host page', async ({ page, servers, browserName }) => {
      const host = await openHost(page, servers, path);
      await host.frame.locator('#top-script').click();
      // Firefox throws, Chromium/WebKit refuse silently; either is a block. The
      // result text only proves the handler ran.
      await expect(host.frame.locator('#top-script-result')).not.toBeEmpty();
      await expectHostUntouched(page, servers, host, browserName);
    });
  });
}

test('alert() inside the frame is swallowed (allow-modals is not granted)', async ({ page, servers }) => {
  const host = await openHost(page, servers);
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await host.frame.locator('#alert').click();
  await expect(host.frame.locator('#alert-result')).toHaveText('returned');
  expect(dialogs).toEqual([]);
});

// ── WORKS ──────────────────────────────────────────────────────────────────

test('the loader iframe carries the exact sandbox, and the frame response the CSP header', async ({
  page,
  servers,
}) => {
  const frameResponse = page.waitForResponse((r) => r.url().includes('/paw-bar/frame'));
  await openHost(page, servers);
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', FRAME_SANDBOX);
  await expect(page.locator('iframe')).toHaveAttribute('allow', 'clipboard-write');
  const res = await frameResponse;
  expect(await res.headerValue('content-security-policy')).toBe(`sandbox ${FRAME_SANDBOX}`);
  // Cross-origin, like production.
  expect(new URL(res.url()).origin).toBe(servers.frameOrigin);
  expect(servers.frameOrigin).not.toBe(servers.hostOrigin);
});

test('Enter in the composer fires the form submit', async ({ page, servers }) => {
  const host = await openHost(page, servers);
  await host.frame.locator('#composer-input').fill('hello');
  await host.frame.locator('#composer-input').press('Enter');
  await expect(host.frame.locator('#form-result')).toHaveText('submitted:hello');
});

/** A popup that escaped the sandbox is an ordinary top-level page. */
async function expectUnsandboxed(popup: Page, servers: SandboxServers) {
  await popup.waitForLoadState();
  expect(new URL(popup.url()).origin).toBe(servers.frameOrigin);
  await expect(popup.locator('#script-ran')).toHaveText('ran');

  // Scripts and forms alone do NOT prove the escape: an inherited sandbox
  // carries allow-scripts and allow-forms too. alert() is the discriminator,
  // because allow-modals is not in the flag set (the test above shows the frame
  // itself cannot raise one). A dialog here means no sandbox came along.
  let dialog = '';
  popup.on('dialog', (d) => {
    dialog = d.message();
    void d.accept();
  });
  await popup.locator('#alert').click();
  await expect.poll(() => dialog).toBe('popup is a normal top-level page');

  // A real submission (a navigation), not just a submit event.
  await popup.locator('#pay').click();
  await expect(popup.locator('#done')).toHaveText('paid=yes');
}

test("window.open(url, '_blank', 'noopener,noreferrer') opens an unsandboxed page", async ({
  page,
  context,
  servers,
}) => {
  const host = await openHost(page, servers);
  const [popup] = await Promise.all([context.waitForEvent('page'), host.frame.locator('#open-btn').click()]);
  expect(popup.url()).toContain('/popup?via=window.open');
  await expectUnsandboxed(popup, servers);
});

test('an <a target=_blank rel=noopener> opens an unsandboxed page', async ({ page, context, servers }) => {
  const host = await openHost(page, servers);
  const [popup] = await Promise.all([context.waitForEvent('page'), host.frame.locator('#blank-link').click()]);
  await expectUnsandboxed(popup, servers);
  // Opening the popup did not move the host either.
  expect(page.url()).toBe(host.url);
});

test('an <a download> of a Blob produces a download', async ({ page, servers }) => {
  const host = await openHost(page, servers);
  const [download] = await Promise.all([page.waitForEvent('download'), host.frame.locator('#download').click()]);
  expect(download.suggestedFilename()).toBe('transcript.txt');
});

test('localStorage set in the frame survives a frame reload', async ({ page, servers }) => {
  const host = await openHost(page, servers);
  // Fresh context per test, so a pass cannot be left over from a previous run.
  await expect(host.frame.locator('#ls-value')).toHaveText('value:(none)');
  await host.frame.locator('#ls-set').click();
  await expect(host.frame.locator('#ls-value')).toHaveText('value:kept');

  const f = frameOf(page);
  await f.evaluate(() => location.reload()).catch(() => {
    /* the reload tears down the context the evaluate ran in */
  });
  await f.waitForLoadState();
  await expect(host.frame.locator('#ready')).toHaveText('ready');
  await expect(host.frame.locator('#ls-value')).toHaveText('value:kept');
});

test('navigator.clipboard.writeText works from the frame', async ({ page, context, servers, browserName }) => {
  let granted = true;
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: servers.frameOrigin });
  } catch {
    granted = false;
  }
  const host = await openHost(page, servers);
  await host.frame.locator('#clip-btn').click();
  const result = host.frame.locator('#clip-result');
  await expect(result).not.toBeEmpty();
  const text = (await result.textContent()) ?? '';
  if (text !== 'ok' && !granted) {
    // Not faked: the engine refused, and Playwright cannot grant it one here.
    test.skip(true, `${browserName} rejects clipboard-write in tests (${text}) and Playwright cannot grant it`);
  }
  expect(text).toBe('ok');
});
