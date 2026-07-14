// Paw Bar widget — embeddable customer-facing surface for Paw OS pockets.
// Renamed 2026-07-08 to Paw Bar: mounts on [data-paw-bar]; exposes window.PawBar.
// Created: 2026-04-13 (Move 3 PR-C) — Auto-mounts on DOMContentLoaded against
// every <div data-paw-bar="widget_id">. Emits `pp.ready` / `pp.error` /
// `pp.event` CustomEvents on the host element so embedders can hook in.
// Updated: 2026-07-14 (Paw Bar chat UI, T4) — mode switch: when the host also
//   carries a public embed key (data-site-key / data-signed-key), mount the
//   concierge chat surface (streaming POST /paw-bar/chat) instead of loading a
//   render spec. Without the key the spec path is unchanged.

import { mountConciergeChat } from './chat-ui';
import { PawBarClient } from './client';
import { getCustomerRef } from './customer-ref';
import { render } from './render';

declare const __BUILD_VERSION__: string;

const DEFAULT_ENDPOINT = readGlobalEndpoint() ?? 'https://runtime.pocketpaw.dev/api/v1';
const BUILD_VERSION: string = typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : 'dev';

interface MountedWidget {
  host: HTMLElement;
  // Absent for chat-mode mounts — the concierge surface streams directly and
  // doesn't hold a spec/event client.
  client?: PawBarClient;
}

const mounted: MountedWidget[] = [];

function readGlobalEndpoint(): string | null {
  const globalAny = window as unknown as { __PAW_BAR_ENDPOINT__?: string };
  return typeof globalAny.__PAW_BAR_ENDPOINT__ === 'string'
    ? globalAny.__PAW_BAR_ENDPOINT__
    : null;
}

function dispatch(host: HTMLElement, name: string, detail: unknown): void {
  host.dispatchEvent(new CustomEvent(`pp.${name}`, { detail, bubbles: true }));
}

async function mount(host: HTMLElement): Promise<void> {
  const widgetId = host.getAttribute('data-paw-bar');
  const endpoint = host.getAttribute('data-endpoint') ?? DEFAULT_ENDPOINT;
  if (!widgetId) {
    dispatch(host, 'error', { reason: 'missing data-paw-bar attribute' });
    return;
  }

  // Chat mode — a public embed key on the host switches the widget from the
  // render-spec surface to the streaming concierge chat. The key is the only
  // credential the browser holds; the backend origin-gates + resolves it.
  const signedKey =
    host.getAttribute('data-site-key') ?? host.getAttribute('data-signed-key');
  if (signedKey) {
    mounted.push({ host });
    mountConciergeChat(host, { endpoint, widgetId, signedKey });
    dispatch(host, 'ready', { widgetId, mode: 'chat' });
    return;
  }

  const client = new PawBarClient(endpoint, widgetId);
  mounted.push({ host, client });

  try {
    const spec = await client.loadSpec();
    const emitter = makeEmitter(host, client);
    render(spec, host, emitter);
    dispatch(host, 'ready', { widgetId, spec });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dispatch(host, 'error', { reason: message });
  }
}

function makeEmitter(host: HTMLElement, client: PawBarClient) {
  return async (event: string, payload: Record<string, unknown>) => {
    try {
      const customerRef = await getCustomerRef();
      const result = await client.postEvent(event, payload, customerRef);
      dispatch(host, 'event', { event, payload, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch(host, 'error', { reason: message, event });
    }
  };
}

function autoMount(): void {
  const hosts = document.querySelectorAll<HTMLElement>('[data-paw-bar]');
  hosts.forEach((host) => {
    void mount(host);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoMount, { once: true });
} else {
  autoMount();
}

const pawBarGlobal = {
  version: BUILD_VERSION,
  mount,
  mounted,
};

(window as unknown as { PawBar: typeof pawBarGlobal }).PawBar = pawBarGlobal;

export {};
