// Thin HTTP client for the Paw Print API. One fetch for the spec, one for
// each outbound event. No retry logic — a failed event surfaces via the
// `pp.error` custom event on the host element so embedders can react.

import type { Spec } from './types';

export class PawPrintClient {
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
    if (!res.ok) throw new Error(`paw-print spec load failed (${res.status})`);
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
    if (!res.ok) throw new Error(`paw-print event post failed (${res.status})`);
    return await res.json();
  }

  private specUrl(): string {
    return `${this.endpoint.replace(/\/$/, '')}/paw-print/spec/${encodeURIComponent(this.widgetId)}`;
  }

  private eventUrl(): string {
    return `${this.endpoint.replace(/\/$/, '')}/paw-print/events/${encodeURIComponent(this.widgetId)}`;
  }
}
