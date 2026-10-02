// page-actions.ts — the frame's half of concierge page actions.
//
// A v2 reply may carry ONE page action (SSE `action` frame, before stream_end):
// {do: 'navigate'|'scroll_to'|'highlight', to?, target?, label}. The server
// validates it; sanitizeAction checks it again because it is still input from
// the network. After stream_end the chat store asks the runner to perform it:
// the runner posts {type:'pawbar:act', id, do, to?, target?, label} to the host
// page's actions.js (pinned to parentOrigin by the poster) and resolves with the
// matching {type:'pawbar:act-result', id, ok, error?}, or with `no_host` when
// nothing answers within ACT_TIMEOUT_MS (the site never added the script) or
// the post could not be sent (no parent, no parentOrigin).
//
// Arrival marker: before a navigate the frame stores {conversationId, to, at}
// in its own localStorage, per widget. A full navigation reloads the frame; the
// next pawbar:page for that page (origin + path, trailing slash ignored) takes
// the marker, once, and the bar says "Here's the page". Expires after
// ARRIVAL_TTL_MS so a navigation that never happened cannot greet a later visit.
//
// Site-declared tools (lib/page-tools): {do:'tool', name, args, label}. The
// name must be in the host's registry and args must fit its schema, checked
// here against the registry passed in (dispatchFrame passes the live one). The
// transcript restores a stored tool action without a registry (it arrives
// after boot), so then only its shape is checked. A tool action waits on the
// visitor in 'confirm' unless the host set confirm:false, and the runner posts
// {type:'pawbar:act', id, do:'tool', name, args}; the host runs it with a 10 s
// timeout and replies {..., ok, error?, message?}. The runner waits
// TOOL_ACT_TIMEOUT_MS for that, longer than the host's own timeout. `message`
// (plain text, <= RESULT_MESSAGE_MAX) is what the bar shows, else "Done" /
// "That didn't work".
//
// actionLine is the visitor-facing copy for each state.

import { findPageTool, TOOL_NAME_RE, validateToolArgs, type PageTool, type ToolArg } from './page-tools';

export type PageActionVerb = 'navigate' | 'scroll_to' | 'highlight' | 'tool';
export interface PageAction {
  do: PageActionVerb;
  to?: string;
  target?: string;
  /** do:'tool' only. */
  name?: string;
  args?: Record<string, ToolArg>;
  label: string;
}

/** Where an action stands. `fallback` = no host script; the bar offers a link.
 *  `confirm` / `cancelled` belong to tools: waiting on the visitor, or declined. */
export type PageActionState = 'pending' | 'done' | 'failed' | 'arrived' | 'fallback' | 'confirm' | 'cancelled';
export type ActError = 'not_found' | 'blocked' | 'unsupported' | 'failed' | 'timeout' | 'no_host';
export type ActResult = { ok: true; message?: string } | { ok: false; error: ActError; message?: string };

// Same bounds as pocketpaw's action_spec (shared via tests/fixtures/action_parity).
export const ACTION_VERBS: readonly PageActionVerb[] = ['navigate', 'scroll_to', 'highlight', 'tool'];
export const LABEL_MAX = 80;
export const TARGET_MAX = 120;
export const TARGET_ID_RE = /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const ACT_TIMEOUT_MS = 1500;
/** The host gives execute() 10 s; the frame waits a little longer for its reply. */
export const TOOL_ACT_TIMEOUT_MS = 12_000;
export const RESULT_MESSAGE_MAX = 160;
const ARGS_MAX = 20;
export const ARRIVAL_TTL_MS = 60_000;

const CONTROL = /[\u0000-\u001f\u007f]/;
const HOST_ERRORS: readonly ActError[] = ['not_found', 'blocked', 'unsupported', 'failed', 'timeout'];

function plain(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text && text.length <= max && !CONTROL.test(text) && !/[<>]/.test(text) ? text : null;
}

/** A host's result message as plain text, or undefined. */
export function resultMessage(value: unknown): string | undefined {
  return plain(value, RESULT_MESSAGE_MAX) ?? undefined;
}

/** A stored tool action's args, shape only: a flat object of primitives. */
function argsShape(value: unknown): Record<string, ToolArg> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > ARGS_MAX) return null;
  for (const [, v] of entries) {
    if (typeof v !== 'string' && typeof v !== 'boolean' && !(typeof v === 'number' && Number.isFinite(v))) return null;
  }
  return Object.fromEntries(entries) as Record<string, ToolArg>;
}

/** An untrusted `action` frame body as a PageAction, or null. Never throws.
 *  `tools` is the registry a tool action must match; without one (a stored
 *  action being restored) only the tool action's shape is checked. */
export function sanitizeAction(raw: unknown, tools?: readonly PageTool[]): PageAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const verb = r.do as PageActionVerb;
  if (!ACTION_VERBS.includes(verb)) return null;
  const label = plain(r.label, LABEL_MAX);
  if (!label) return null;
  if (verb === 'tool') {
    if (typeof r.name !== 'string' || !TOOL_NAME_RE.test(r.name)) return null;
    let args: Record<string, ToolArg> | null;
    if (tools) {
      const tool = findPageTool(r.name, tools);
      args = tool ? validateToolArgs(tool.inputSchema, r.args) : null;
    } else {
      args = argsShape(r.args);
    }
    return args ? { do: verb, name: r.name, args, label } : null;
  }
  if (verb === 'navigate') {
    if (typeof r.to !== 'string') return null;
    let url: URL;
    try {
      url = new URL(r.to);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { do: verb, to: url.href, label };
  }
  const target = plain(r.target, TARGET_MAX);
  if (!target || (target.startsWith('#') && !TARGET_ID_RE.test(target))) return null;
  return { do: verb, target, label };
}

/** The line the bar shows under the reply. `message` is a tool's result. */
export function actionLine(a: PageAction & { message?: string }, state: PageActionState): string {
  if (a.do === 'tool') {
    if (state === 'done') return a.message || 'Done';
    if (state === 'failed') return a.message || "That didn't work";
    if (state === 'cancelled') return 'Cancelled';
    if (state === 'pending') return `${a.label}…`;
    return a.label;
  }
  if (state === 'failed') return "I couldn't find that on this page";
  if (state === 'arrived') return "Here's the page";
  if (state === 'fallback') return `Open ${a.label}`;
  return a.do === 'navigate' ? `Taking you to ${a.label}` : `Showing ${a.label}`;
}

export interface ActionRunner {
  run(action: PageAction): Promise<ActResult>;
  /** Hand every message from the host page here; non-results are ignored. */
  receive(data: unknown): void;
}

/** `post` sends one message to the host page and says whether it could. */
export function createActionRunner(
  post: (message: Record<string, unknown>) => boolean,
  timeoutMs = ACT_TIMEOUT_MS,
  toolTimeoutMs = TOOL_ACT_TIMEOUT_MS,
): ActionRunner {
  const pending = new Map<string, (r: ActResult) => void>();
  let seq = 0;
  return {
    run(action) {
      const id = `act-${Date.now().toString(36)}-${++seq}`;
      const tool = action.do === 'tool';
      return new Promise<ActResult>((resolve) => {
        // A tool that never answers timed out; a guide verb means no script.
        const timer = setTimeout(
          () => settle({ ok: false, error: tool ? 'timeout' : 'no_host' }),
          tool ? toolTimeoutMs : timeoutMs,
        );
        function settle(r: ActResult) {
          clearTimeout(timer);
          pending.delete(id);
          resolve(r);
        }
        pending.set(id, settle);
        const sent = post(
          tool
            ? { type: 'pawbar:act', id, do: 'tool', name: action.name, args: { ...action.args } }
            : {
                type: 'pawbar:act',
                id,
                do: action.do,
                ...(action.to ? { to: action.to } : {}),
                ...(action.target ? { target: action.target } : {}),
                label: action.label,
              },
        );
        if (!sent) settle({ ok: false, error: 'no_host' });
      });
    },
    receive(data) {
      if (!data || typeof data !== 'object') return;
      const d = data as Record<string, unknown>;
      if (d.type !== 'pawbar:act-result' || typeof d.id !== 'string' || typeof d.ok !== 'boolean') return;
      const settle = pending.get(d.id);
      if (!settle) return;
      const message = resultMessage(d.message);
      const extra = message ? { message } : {};
      if (d.ok) settle({ ok: true, ...extra });
      else
        settle({
          ok: false,
          error: HOST_ERRORS.includes(d.error as ActError) ? (d.error as ActError) : 'unsupported',
          ...extra,
        });
    },
  };
}

// ── Arrival marker ────────────────────────────────────────────────────────────
const ARRIVAL_PREFIX = 'pawbar.arrival.v1.';

export interface Arrival {
  conversationId: string;
  to: string;
}

function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const p = (u: URL) => u.pathname.replace(/\/+$/, '');
    return x.origin === y.origin && p(x) === p(y);
  } catch {
    return false;
  }
}

export function saveArrival(widgetId: string, arrival: Arrival): void {
  try {
    localStorage.setItem(ARRIVAL_PREFIX + widgetId, JSON.stringify({ ...arrival, at: Date.now() }));
  } catch {
    /* blocked storage: no "Here's the page", nothing else lost */
  }
}

export function clearArrival(widgetId: string): void {
  try {
    localStorage.removeItem(ARRIVAL_PREFIX + widgetId);
  } catch {
    /* ignore */
  }
}

/** The marker when `pageUrl` is the page it was written for, removed as it is
 *  taken. An expired or unreadable marker is removed and yields null. */
export function takeArrival(widgetId: string, pageUrl: string): Arrival | null {
  let row: { conversationId?: unknown; to?: unknown; at?: unknown } | null = null;
  try {
    row = JSON.parse(localStorage.getItem(ARRIVAL_PREFIX + widgetId) ?? 'null');
  } catch {
    clearArrival(widgetId);
    return null;
  }
  if (!row) return null;
  const { conversationId, to, at } = row;
  if (typeof to !== 'string' || typeof conversationId !== 'string' || typeof at !== 'number' || Date.now() - at > ARRIVAL_TTL_MS) {
    clearArrival(widgetId);
    return null;
  }
  if (!samePage(to, pageUrl)) return null;
  clearArrival(widgetId);
  return { conversationId, to };
}
