// handoff-client.ts — Transport for "Talk to a person" (C11). Created 2026-09-27
// (paw-bar states; spec docs/design/drafts/2026-09-27-paw-bar-states-ux-failures.md
// §5). Sibling of action-client: one fetch, credentials omitted, CORS mode, no
// retry. Body matches ee/pocketpaw_ee/paw_bar/router.py::RequestHumanRequest
// EXACTLY — the same `key` / `w` naming as /paw-bar/action:
//   POST {endpoint}/paw-bar/request-human {key, w, customer_ref, message, contact}
//     → 200 {ok, handoff_id, state: "needs_human" | "", message}
//     refusals: 404/429/401/403/409 from the front gate, 400 message_rejected,
//     422 invalid_email, 429 handoff_rate_limit, 503 handoff_unavailable.
// Never throws. A refusal comes back as the status + JSON `detail` (the store
// maps it to copy); a rejected fetch comes back as status 0.

import type { ConciergeChatConfig } from './chat-client';

export type RequestHumanResponse =
  | { ok: true; state: string; message: string; handoffId: string }
  | { ok: false; status: number; detail: string | null };

export async function postRequestHuman(
  config: ConciergeChatConfig,
  note: { message: string; contact: string },
  signal?: AbortSignal,
): Promise<RequestHumanResponse> {
  let res: Response;
  try {
    res = await fetch(`${config.endpoint.replace(/\/$/, '')}/paw-bar/request-human`, {
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
        message: note.message,
        contact: note.contact,
      }),
    });
  } catch {
    return { ok: false, status: 0, detail: null };
  }
  let data: Record<string, unknown> | null = null;
  try {
    data = (await res.json()) as Record<string, unknown> | null;
  } catch {
    data = null;
  }
  if (!res.ok || !data || data.ok !== true) {
    const detail = data && typeof data.detail === 'string' ? data.detail : null;
    return { ok: false, status: res.ok ? 500 : res.status, detail };
  }
  return {
    ok: true,
    state: typeof data.state === 'string' ? data.state : '',
    message: typeof data.message === 'string' ? data.message : '',
    handoffId: typeof data.handoff_id === 'string' ? data.handoff_id : '',
  };
}
