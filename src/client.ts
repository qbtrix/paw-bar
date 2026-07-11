// Thin HTTP client for the Paw Bar API. One fetch for the spec, one for
// each outbound event. No retry logic — a failed event surfaces via the
// `pp.error` custom event on the host element so embedders can react.
// Changed 2026-07-11: renamed PawPrintClient → PawBarClient; API paths and
// error strings moved from /paw-print/* to /paw-bar/* to match the renamed
// backend router. The public spec/events endpoints are origin-gated and
// token-free (X-Paw-Bar-Token is only for owner/admin endpoints), so the
// widget still sends no auth header.

import type { Spec } from './types';

export class PawBarClient {
  constructor(
    private readonly endpoint: string,
    private readonly widgetId: string,
  ) {}

  async loadSpec(): Promise<Spec> {
    const res = await fetch(this.specUrl(), {
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`paw-bar spec load failed (${res.status})`);
    return (await res.json()) as Spec;
  }

  async postEvent(
    type: string,
    payload: Record<string, unknown>,
    customerRef: string,
  ): Promise<unknown> {
    const res = await fetch(this.eventUrl(), {
      method: 'POST',
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload, customer_ref: customerRef }),
    });
    if (!res.ok) throw new Error(`paw-bar event post failed (${res.status})`);
    return await res.json();
  }

  private specUrl(): string {
    return `${this.endpoint.replace(/\/$/, '')}/paw-bar/spec/${encodeURIComponent(this.widgetId)}`;
  }

  private eventUrl(): string {
    return `${this.endpoint.replace(/\/$/, '')}/paw-bar/events/${encodeURIComponent(this.widgetId)}`;
  }
}
