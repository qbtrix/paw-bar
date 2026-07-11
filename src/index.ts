// Paw Bar widget — embeddable customer-facing surface for Paw OS pockets.
// Created: 2026-04-13 (Move 3 PR-C) — Auto-mounts on DOMContentLoaded against
// every <div data-paw-bar="widget_id">. Emits `pp.ready` / `pp.error` /
// `pp.event` CustomEvents on the host element so embedders can hook in.
// Changed 2026-07-11 (paw-bar rename): primary attribute is now
// `data-paw-bar` (legacy `data-paw-print` kept as a read alias), endpoint
// global is `__PAW_BAR_ENDPOINT__` (legacy `__PAW_PRINT_ENDPOINT__` still
// honoured), and the window global is `PawBar` (legacy `PawPrint` aliased).

import { PawBarClient } from './client';
import { getCustomerRef } from './customer-ref';
import { render } from './render';
import type { Spec } from './types';

declare const __BUILD_VERSION__: string;

const DEFAULT_ENDPOINT = readGlobalEndpoint() ?? 'https://runtime.pocketpaw.dev/api/v1';
const BUILD_VERSION: string = typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : 'dev';

interface MountedWidget {
  host: HTMLElement;
  client: PawBarClient;
}

const mounted: MountedWidget[] = [];

function readGlobalEndpoint(): string | null {
  const globalAny = window as unknown as {
    __PAW_BAR_ENDPOINT__?: string;
    __PAW_PRINT_ENDPOINT__?: string;
  };
  if (typeof globalAny.__PAW_BAR_ENDPOINT__ === 'string') return globalAny.__PAW_BAR_ENDPOINT__;
  // Legacy alias — kept so pre-rename embeds keep working.
  return typeof globalAny.__PAW_PRINT_ENDPOINT__ === 'string'
    ? globalAny.__PAW_PRINT_ENDPOINT__
    : null;
}

function dispatch(host: HTMLElement, name: string, detail: unknown): void {
  host.dispatchEvent(new CustomEvent(`pp.${name}`, { detail, bubbles: true }));
}

function readWidgetId(host: HTMLElement): string | null {
  // `data-paw-bar` is canonical; `data-paw-print` is a legacy read alias.
  return host.getAttribute('data-paw-bar') ?? host.getAttribute('data-paw-print');
}

async function mount(host: HTMLElement): Promise<void> {
  const widgetId = readWidgetId(host);
  const endpoint = host.getAttribute('data-endpoint') ?? DEFAULT_ENDPOINT;
  if (!widgetId) {
    dispatch(host, 'error', { reason: 'missing data-paw-bar attribute' });
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
  const hosts = document.querySelectorAll<HTMLElement>('[data-paw-bar], [data-paw-print]');
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

const windowAny = window as unknown as {
  PawBar: typeof pawBarGlobal;
  PawPrint: typeof pawBarGlobal;
};
windowAny.PawBar = pawBarGlobal;
// Legacy alias — same object, so pre-rename integrations keep working.
windowAny.PawPrint = pawBarGlobal;

export {};
