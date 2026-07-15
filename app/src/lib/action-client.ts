// action-client.ts — Transport for the visitor action loop. Created 2026-07-15
// (C2 action loop). Sibling of chat-client: one fetch, credentials omitted, CORS
// mode, no retry. Carries STRUCTURED action events (never free text) to the
// dedicated endpoints; the server validates every arg against the widget's
// allowlisted declaration + catalog, mutates the visitor-scoped cart, and
// hands back a checkout link (the agent never executes payment). Bodies match
// the frozen C1 contract EXACTLY:
//   POST {endpoint}/paw-bar/action  {key, w, customer_ref, verb, args} → {ok, result, cart?}
//   GET  {endpoint}/paw-bar/cart    ?key&w&customer_ref               → {items, total_cents, currency, checkout_url}

export interface ActionConfig {
  endpoint: string;
  widgetId: string;
  signedKey: string;
  customerRef: string;
}

export interface CartLine {
  id?: string;
  product_id?: string;
  name?: string;
  qty?: number;
  price_cents?: number;
  currency?: string;
  line_total_cents?: number;
}

export interface Cart {
  items: CartLine[];
  total_cents: number;
  currency: string;
  checkout_url: string;
}

export interface ActionResult {
  ok: boolean;
  result?: Record<string, unknown>;
  cart?: Cart | null;
  error?: string;
}

function base(endpoint: string): string {
  return endpoint.replace(/\/$/, '');
}

export async function postAction(
  config: ActionConfig,
  verb: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ActionResult> {
  let res: Response;
  try {
    res = await fetch(`${base(config.endpoint)}/paw-bar/action`, {
      method: 'POST',
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: config.signedKey,
        w: config.widgetId,
        customer_ref: config.customerRef,
        verb,
        args,
      }),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!res.ok) return { ok: false, error: `action failed (${res.status})` };
  try {
    const data = (await res.json()) as ActionResult;
    return data && typeof data === 'object' ? data : { ok: false, error: 'bad action response' };
  } catch {
    return { ok: false, error: 'bad action response' };
  }
}

export async function getCart(config: ActionConfig, signal?: AbortSignal): Promise<Cart | null> {
  const q = new URLSearchParams({
    key: config.signedKey,
    w: config.widgetId,
    customer_ref: config.customerRef,
  });
  let res: Response;
  try {
    res = await fetch(`${base(config.endpoint)}/paw-bar/cart?${q.toString()}`, {
      method: 'GET',
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      signal,
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    return (await res.json()) as Cart;
  } catch {
    return null;
  }
}
