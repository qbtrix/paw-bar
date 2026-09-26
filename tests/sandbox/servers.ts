// tests/sandbox/servers.ts — the two origins the frame sandbox e2e runs on.
// Created 2026-09-26.
//
// Production is cross-site: the loader runs on the customer's page and the
// frame comes from our API. So two Node http servers, reached under two
// different hostnames (http://localhost:<p1> for the host page,
// http://127.0.0.1:<p2> for the frame). Different hosts means different origins
// AND different sites, which is what the sandbox, storage partitioning and the
// clipboard permission policy all key on.
//
// HOST server
//   /             a page that runs the REAL built loader (loader/dist/loader.js)
//                 with data-endpoint = the frame origin, so the loader creates
//                 the iframe exactly as it would on a customer site.
//   /header-only  the same fixture frame in a plain <iframe> with NO sandbox
//                 attribute: proves the CSP header on its own blocks the attack.
//   /loader.js    the built bundle; fails loudly if it has not been built.
//   /pwned        the attack's destination; every hit is counted.
//
// FRAME server
//   /paw-bar/frame  fixtures/frame.html + `Content-Security-Policy: sandbox ...`.
//                   The header is on THIS path only: a blanket header would
//                   sandbox the popup page too and fake an escape failure.
//   /popup          fixtures/popup.html, no CSP.
//   /popup-done     where the popup's form lands.

import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

// The flag set under test. Duplicated from loader/src/loader.ts FRAME_SANDBOX on
// purpose: that module runs its IIFE on import and needs a window. The loader's
// unit test pins the built bundle to this exact string, and the spec asserts the
// iframe in the host DOM carries it, so a drift fails one of the two.
export const FRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';

const here = fileURLToPath(new URL('.', import.meta.url));
const LOADER = fileURLToPath(new URL('../../loader/dist/loader.js', import.meta.url));

export interface SandboxServers {
  hostOrigin: string;
  frameOrigin: string;
  /** Hits on the host's /pwned since the last reset. */
  pwnedHits(): number;
  reset(): void;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}

function listen(server: Server): Promise<number> {
  // No host argument: bind the dual-stack wildcard, so the page is reachable as
  // both `localhost` (which a browser may resolve to ::1) and `127.0.0.1`.
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });
}

export async function startSandboxServers(): Promise<SandboxServers> {
  if (!existsSync(LOADER)) {
    throw new Error(`${LOADER} is missing. Run \`bun run build:loader\` before \`bun run test:sandbox\`.`);
  }
  const frameHtml = readFileSync(here + 'fixtures/frame.html', 'utf8');
  const popupHtml = readFileSync(here + 'fixtures/popup.html', 'utf8');

  let pwned = 0;
  let hostOrigin = '';
  let frameOrigin = '';

  const host = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    switch (url.pathname) {
      case '/':
        return send(
          res,
          200,
          'text/html; charset=utf-8',
          `<!doctype html><html><head><meta charset="utf-8"><title>customer page</title></head>
<body><h1 id="host-marker">customer page</h1>
<script src="/loader.js" data-site-key="sk_sandbox_test" data-widget-id="w_sandbox_test" data-endpoint="${frameOrigin}"></script>
</body></html>`,
        );
      case '/header-only':
        return send(
          res,
          200,
          'text/html; charset=utf-8',
          `<!doctype html><html><head><meta charset="utf-8"><title>customer page</title></head>
<body><h1 id="host-marker">customer page, header-only frame</h1>
<iframe id="bare" style="width:520px;height:840px;border:0"
  src="${frameOrigin}/paw-bar/frame?po=${encodeURIComponent(hostOrigin)}"></iframe>
</body></html>`,
        );
      case '/loader.js':
        // Read per request so a rebuild between runs is always what is served.
        return send(res, 200, 'text/javascript; charset=utf-8', readFileSync(LOADER));
      case '/pwned':
        pwned++;
        return send(res, 200, 'text/html; charset=utf-8', '<!doctype html><h1 id="pwned">pwned</h1>');
      default:
        return send(res, 404, 'text/plain', 'not found');
    }
  });

  const frame = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    switch (url.pathname) {
      case '/paw-bar/frame':
        return send(res, 200, 'text/html; charset=utf-8', frameHtml, {
          'Content-Security-Policy': `sandbox ${FRAME_SANDBOX}`,
        });
      case '/popup':
        return send(res, 200, 'text/html; charset=utf-8', popupHtml);
      case '/popup-done':
        return send(
          res,
          200,
          'text/html; charset=utf-8',
          `<!doctype html><h1 id="done">paid=${url.searchParams.get('paid') === 'yes' ? 'yes' : 'no'}</h1>`,
        );
      default:
        return send(res, 404, 'text/plain', 'not found');
    }
  });

  const hostPort = await listen(host);
  const framePort = await listen(frame);
  hostOrigin = `http://localhost:${hostPort}`;
  frameOrigin = `http://127.0.0.1:${framePort}`;

  const closeOne = (s: Server) =>
    new Promise<void>((resolve) => {
      s.closeAllConnections?.();
      s.close(() => resolve());
    });

  return {
    hostOrigin,
    frameOrigin,
    pwnedHits: () => pwned,
    reset: () => {
      pwned = 0;
    },
    close: async () => {
      await Promise.all([closeOne(host), closeOne(frame)]);
    },
  };
}
