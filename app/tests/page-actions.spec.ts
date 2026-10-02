// tests/page-actions.spec.ts — lib/page-actions and its wire edges: the
// `action` SSE frame, the action parity fixture shared with pocketpaw
// (fixtures/action_parity/, same files as pocketpaw's
// tests/fixtures/action_parity/), the act/act-result runner, the arrival
// marker, the visitor copy, poster.act's fail-closed origin, and the
// transcript round trip of a reply's action.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import casesRaw from './fixtures/action_parity/cases.json?raw';
import expectedRaw from './fixtures/action_parity/expected.json?raw';
import {
  ACTION_VERBS,
  LABEL_MAX,
  TARGET_MAX,
  TARGET_ID_RE,
  ARRIVAL_TTL_MS,
  actionLine,
  createActionRunner,
  sanitizeAction,
  saveArrival,
  takeArrival,
  type PageAction,
} from '../src/lib/page-actions';
import { dispatchFrame, type ChatCallbacks } from '../src/lib/chat-client';
import { createPoster } from '../src/lib/postmessage';
import { loadTranscript, saveTranscript } from '../src/lib/transcript';
import type { Message } from '../src/store/chat.svelte';

type Case = { name: string; about: string; body: string };
type Expected = {
  bounds: { verbs: string[]; label_max: number; target_max: number; target_id_re: string };
  verdicts: Record<string, { server: 'accept' | 'drop'; frame?: PageAction; client_rejects_body?: boolean }>;
};
const cases = JSON.parse(casesRaw) as Case[];
const expected = JSON.parse(expectedRaw) as Expected;

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('action parity with pocketpaw', () => {
  it('every case has a verdict and every verdict has a case', () => {
    expect(new Set(cases.map((c) => c.name))).toEqual(new Set(Object.keys(expected.verdicts)));
  });

  it('the bounds match the constants the bar uses', () => {
    expect(expected.bounds).toEqual({
      verbs: [...ACTION_VERBS],
      label_max: LABEL_MAX,
      target_max: TARGET_MAX,
      target_id_re: TARGET_ID_RE.source.replace(/^\^|\$$/g, ''),
    });
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s: the client agrees with the server', (name, c) => {
    const v = expected.verdicts[name];
    if (v.server === 'accept') expect(sanitizeAction(v.frame)).toEqual(v.frame);
    if (v.client_rejects_body) expect(sanitizeAction(JSON.parse(c.body))).toBeNull();
  });
});

describe('sanitizeAction', () => {
  it('rejects non-objects, relative or non-http navigate urls', () => {
    expect(sanitizeAction(null)).toBeNull();
    expect(sanitizeAction('navigate')).toBeNull();
    expect(sanitizeAction({ do: 'navigate', to: '/x', label: 'X' })).toBeNull();
    expect(sanitizeAction({ do: 'navigate', to: 'data:text/html,hi', label: 'X' })).toBeNull();
  });
});

describe('the action frame', () => {
  const cb = () => ({
    onChunk: vi.fn(),
    onEnd: vi.fn(),
    onError: vi.fn(),
    onAction: vi.fn<(a: PageAction) => void>(),
  }) satisfies ChatCallbacks;

  it('hands a valid action on and keeps reading', () => {
    const c = cb();
    const frame = { do: 'navigate', to: 'https://shop.example.com/returns', label: 'Returns' };
    expect(dispatchFrame({ event: 'action', data: JSON.stringify({ type: 'action', action: frame }) }, c)).toBe(true);
    expect(c.onAction).toHaveBeenCalledWith(frame);
  });

  it('drops a malformed one silently', () => {
    const c = cb();
    expect(dispatchFrame({ event: 'action', data: '{"action":{"do":"click","label":"x"}}' }, c)).toBe(true);
    expect(dispatchFrame({ event: 'action', data: 'not json' }, c)).toBe(true);
    expect(c.onAction).not.toHaveBeenCalled();
  });
});

describe('the runner', () => {
  const action: PageAction = { do: 'highlight', target: '#returns', label: 'Returns' };

  it('posts pawbar:act and settles with the matching result', async () => {
    const sent: Record<string, unknown>[] = [];
    const runner = createActionRunner((m) => (sent.push(m), true));
    const p = runner.run(action);
    expect(sent[0]).toMatchObject({ type: 'pawbar:act', do: 'highlight', target: '#returns', label: 'Returns' });
    expect(sent[0]).not.toHaveProperty('to');
    runner.receive({ type: 'pawbar:act-result', id: 'someone-else', ok: true });
    runner.receive({ type: 'pawbar:act-result', id: sent[0].id, ok: false, error: 'not_found' });
    await expect(p).resolves.toEqual({ ok: false, error: 'not_found' });
  });

  it('maps an unknown error to unsupported and ignores malformed results', async () => {
    const sent: Record<string, unknown>[] = [];
    const runner = createActionRunner((m) => (sent.push(m), true));
    const p = runner.run(action);
    runner.receive({ type: 'pawbar:act-result', id: sent[0].id, ok: 'yes' });
    runner.receive(null);
    runner.receive({ type: 'pawbar:act-result', id: sent[0].id, ok: false, error: 'boom' });
    await expect(p).resolves.toEqual({ ok: false, error: 'unsupported' });
  });

  it('settles as no_host when nothing answers in time', async () => {
    vi.useFakeTimers();
    const runner = createActionRunner(() => true, 1500);
    const p = runner.run(action);
    vi.advanceTimersByTime(1499);
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(p).resolves.toEqual({ ok: false, error: 'no_host' });
  });

  it('settles as no_host at once when the post cannot be sent', async () => {
    await expect(createActionRunner(() => false).run(action)).resolves.toEqual({ ok: false, error: 'no_host' });
  });
});

describe('poster.act', () => {
  it('refuses to send without a parentOrigin', () => {
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window);
    expect(createPoster('').act({ type: 'pawbar:act', id: 'a' })).toBe(false);
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('pins the post to parentOrigin', () => {
    const parent = { postMessage: vi.fn() };
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window);
    expect(createPoster('https://shop.example.com').act({ type: 'pawbar:act', id: 'a' })).toBe(true);
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'pawbar:act', id: 'a' }, 'https://shop.example.com');
  });

  it('sends nothing in a standalone page', () => {
    expect(createPoster('https://shop.example.com').act({ type: 'pawbar:act', id: 'a' })).toBe(false);
  });
});

describe('the arrival marker', () => {
  const to = 'https://shop.example.com/products/cairn-boot';

  it('is taken once, on the page it was written for (trailing slash ignored)', () => {
    saveArrival('w1', { conversationId: 'c1', to });
    expect(takeArrival('w1', 'https://shop.example.com/')).toBeNull();
    expect(takeArrival('w1', to + '/')).toEqual({ conversationId: 'c1', to });
    expect(takeArrival('w1', to)).toBeNull();
  });

  it('is per widget', () => {
    saveArrival('w1', { conversationId: 'c1', to });
    expect(takeArrival('w2', to)).toBeNull();
  });

  it('expires', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    saveArrival('w1', { conversationId: 'c1', to });
    vi.spyOn(Date, 'now').mockReturnValue(now + ARRIVAL_TTL_MS + 1);
    expect(takeArrival('w1', to)).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});

describe('the visitor copy', () => {
  const nav: PageAction = { do: 'navigate', to: 'https://shop.example.com/p/cairn', label: 'Cairn boot' };
  const show: PageAction = { do: 'scroll_to', target: '#returns', label: 'our returns policy' };
  it.each([
    [nav, 'pending', 'Taking you to Cairn boot'],
    [nav, 'done', 'Taking you to Cairn boot'],
    [nav, 'arrived', "Here's the page"],
    [nav, 'fallback', 'Open Cairn boot'],
    [show, 'done', 'Showing our returns policy'],
    [show, 'failed', "I couldn't find that on this page"],
  ] as const)('%o %s', (a, state, line) => {
    expect(actionLine(a, state)).toBe(line);
  });
});

describe('the transcript keeps a reply action', () => {
  it('round-trips it, settling pending to done, and drops a tampered one', () => {
    const msgs: Message[] = [
      { id: 'u', role: 'user', content: 'boots?', status: 'done' },
      {
        id: 'a',
        role: 'assistant',
        content: 'Here.',
        status: 'done',
        action: { do: 'navigate', to: 'https://shop.example.com/p/cairn', label: 'Cairn boot', state: 'pending' },
      },
      {
        id: 'b',
        role: 'assistant',
        content: 'There.',
        status: 'done',
        action: { do: 'navigate', to: 'javascript:alert(1)', label: 'x', state: 'fallback' },
      },
      {
        id: 'c',
        role: 'assistant',
        content: 'Look.',
        status: 'done',
        action: { do: 'highlight', target: '#a', label: 'A', state: 'failed' },
      },
    ];
    saveTranscript('w1', msgs, 'c1');
    const back = loadTranscript('w1', 'c1');
    expect(back[1].action).toEqual({ do: 'navigate', to: 'https://shop.example.com/p/cairn', label: 'Cairn boot', state: 'done' });
    expect(back[2].action).toBeUndefined();
    expect(back[3].action).toEqual({ do: 'highlight', target: '#a', label: 'A', state: 'failed' });
  });
});
