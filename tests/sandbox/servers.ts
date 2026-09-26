// tests/sandbox/servers.ts — the three origins the frame sandbox e2e runs on.
// Created 2026-09-26.
// Updated 2026-09-26 (security review): a third, ATTACKER origin that the
// frame's hostile links point at, so a popup they open is cross-origin to both
// the host and the frame, as a real attacker page would be; an /attr-only host
// route whose frame is served WITHOUT the CSP header, so the loader's attribute
// is proven on its own; the frame fixture is templated with the attacker origin.
//
// Production is cross-site: the loader runs on the customer's page and the
// frame comes from our API. So Node http servers reached under different
// hostnames: http://localhost:<p1> (host page), http://127.0.0.1:<p2> (frame),
// http://127.0.0.2:<p3> (attacker). Different hosts means different origins AND
// different sites, which is what the sandbox, storage partitioning and the
// clipboard permission policy all key on. 127.0.0.2 is loopback on Linux and
// Windows alike.
//
// HOST server
//   /             runs the REAL built loader (loader/dist/loader.js) with
//                 data-endpoint = the frame origin: attribute + CSP header.
//   /attr-only    the real loader with data-endpoint = <frame>/nocsp, whose frame
//                 route sends NO CSP header: the attribute alone.
//   /header-only  the fixture frame in a plain <iframe> with NO sandbox
//                 attribute: the CSP header alone.
//   /loader.js    the built bundle; fails loudly if it has not been built.
//   /pwned        where every attack tries to send the host page; hits counted.
//
// FRAME server
//   /paw-bar/frame        fixtures/frame.html + `Content-Security-Policy:
//                         sandbox ...`. The header is on the frame paths only: a
//                         blanket header would sandbox the popup page too and
//                         fake an escape failure.
//   /nocsp/paw-bar/frame  the same page with no CSP header.
//   /popup, /popup-done   the benign popup (article / checkout) and its form.
//
// ATTACKER server
//   /landing      fixtures/attacker.html: tries `opener.top.location = <host>/pwned`
//                 on a click (real user activation). Hits counted.

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
  attackerOrigin: string;
  /** Hits on the host's /pwned since the last reset. */
  pwnedHits(): number;
  /** Loads of the attacker's landing page since the last reset. */
  attackerHits(): number;
  reset(): void;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}

function listen(server: Server): Promise<number> {
  // No host argument: bind the dual-stack wildcard, so the page is reachable as
  // `localhost` (which a browser may resolve to ::1), `127.0.0.1` and `127.0.0.2`.
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });
}

const hostPage = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>customer page</title></head>
<body><h1 id="host-marker">${title}</h1>
${body}
</body></html>`;

const loaderTag = (endpoint: string) =>
  `<script src="/loader.js" data-site-key="sk_sandbox_test" data-widget-id="w_sandbox_test" data-endpoint="${endpoint}"></script>`;

export async function startSandboxServers(): Promise<SandboxServers> {
  if (!existsSync(LOADER)) {
    throw new Error(`${LOADER} is missing. Run \`bun run build:loader\` before \`bun run test:sandbox\`.`);
  }
  const frameTemplate = readFileSync(here + 'fixtures/frame.html', 'utf8');
  const popupHtml = readFileSync(here + 'fixtures/popup.html', 'utf8');
  const attackerHtml = readFileSync(here + 'fixtures/attacker.html', 'utf8');

  let pwned = 0;
  let attacker = 0;
  let hostOrigin = '';
  let frameOrigin = '';
  let attackerOrigin = '';

  const host = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const html = (body: string) => send(res, 200, 'text/html; charset=utf-8', body);
    switch (url.pathname) {
      case '/':
        return html(hostPage('customer page', loaderTag(frameOrigin)));
      case '/attr-only':
        return html(hostPage('customer page, attribute-only frame', loaderTag(frameOrigin + '/nocsp')));
      case '/header-only':
        return html(
          hostPage(
            'customer page, header-only frame',
            `<iframe id="bare" style="width:520px;height:840px;border:0"
  src="${frameOrigin}/paw-bar/frame?po=${encodeURIComponent(hostOrigin)}"></iframe>`,
          ),
        );
      case '/loader.js':
        // Read per request so a rebuild between runs is always what is served.
        return send(res, 200, 'text/javascript; charset=utf-8', readFileSync(LOADER));
      case '/pwned':
        pwned++;
        return html('<!doctype html><h1 id="pwned">pwned</h1>');
      default:
        return send(res, 404, 'text/plain', 'not found');
    }
  });

  const frame = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const frameHtml = () => frameTemplate.replaceAll('__ATTACKER_ORIGIN__', attackerOrigin);
    switch (url.pathname) {
      case '/paw-bar/frame':
        return send(res, 200, 'text/html; charset=utf-8', frameHtml(), {
          'Content-Security-Policy': `sandbox ${FRAME_SANDBOX}`,
        });
      case '/nocsp/paw-bar/frame':
        return send(res, 200, 'text/html; charset=utf-8', frameHtml());
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

  const evil = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/landing') {
      attacker++;
      return send(res, 200, 'text/html; charset=utf-8', attackerHtml);
    }
    return send(res, 404, 'text/plain', 'not found');
  });

  const hostPort = await listen(host);
  const framePort = await listen(frame);
  const evilPort = await listen(evil);
  hostOrigin = `http://localhost:${hostPort}`;
  frameOrigin = `http://127.0.0.1:${framePort}`;
  attackerOrigin = `http://127.0.0.2:${evilPort}`;

  const closeOne = (s: Server) =>
    new Promise<void>((resolve) => {
      s.closeAllConnections?.();
      s.close(() => resolve());
    });

  return {
    hostOrigin,
    frameOrigin,
    attackerOrigin,
    pwnedHits: () => pwned,
    attackerHits: () => attacker,
    reset: () => {
      pwned = 0;
      attacker = 0;
    },
    close: async () => {
      await Promise.all([closeOne(host), closeOne(frame), closeOne(evil)]);
    },
  };
}
