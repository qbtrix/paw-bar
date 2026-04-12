// Paw Print widget — embeddable customer-facing surface for Paw OS pockets.
// Created: 2026-04-13 (Move 3 PR-C) — Auto-mounts on DOMContentLoaded against
// every <div data-paw-print="widget_id">. Emits `pp.ready` / `pp.error` /
// `pp.event` CustomEvents on the host element so embedders can hook in.

import { PawPrintClient } from './client';
import { getCustomerRef } from './customer-ref';
import { render } from './render';
import type { Spec } from './types';

declare const __BUILD_VERSION__: string;

const DEFAULT_ENDPOINT = readGlobalEndpoint() ?? 'https://runtime.pocketpaw.dev/api/v1';
const BUILD_VERSION: string = typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : 'dev';

interface MountedWidget {
  host: HTMLElement;
  client: PawPrintClient;
}

const mounted: MountedWidget[] = [];

function readGlobalEndpoint(): string | null {
  const globalAny = window as unknown as { __PAW_PRINT_ENDPOINT__?: string };
  return typeof globalAny.__PAW_PRINT_ENDPOINT__ === 'string'
    ? globalAny.__PAW_PRINT_ENDPOINT__
    : null;
}

function dispatch(host: HTMLElement, name: string, detail: unknown): void {
  host.dispatchEvent(new CustomEvent(`pp.${name}`, { detail, bubbles: true }));
}

async function mount(host: HTMLElement): Promise<void> {
  const widgetId = host.getAttribute('data-paw-print');
  const endpoint = host.getAttribute('data-endpoint') ?? DEFAULT_ENDPOINT;
  if (!widgetId) {
    dispatch(host, 'error', { reason: 'missing data-paw-print attribute' });
    return;
  }

  const client = new PawPrintClient(endpoint, widgetId);
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

function makeEmitter(host: HTMLElement, client: PawPrintClient) {
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
  const hosts = document.querySelectorAll<HTMLElement>('[data-paw-print]');
  hosts.forEach((host) => {
    void mount(host);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoMount, { once: true });
} else {
  autoMount();
}

const pawPrintGlobal = {
  version: BUILD_VERSION,
  mount,
  mounted,
};

(window as unknown as { PawPrint: typeof pawPrintGlobal }).PawPrint = pawPrintGlobal;

export {};
