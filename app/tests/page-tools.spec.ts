// tests/page-tools.spec.ts — site-declared tools in the frame: lib/page-tools
// against the tool_schemas.json parity fixture shared with pocketpaw, the args
// rules, the registry and its wire form in the chat request, and ChatStore's
// tool flow (unknown name dropped, confirm card, Confirm runs once, Cancel,
// confirm:false runs at once, the result line, an unavailable frame discards,
// and a reload that never re-offers a tool that already ran).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import schemasRaw from './fixtures/action_parity/tool_schemas.json?raw';
import expectedRaw from './fixtures/action_parity/expected.json?raw';
import {
  ARG_NAME_RE,
  ARG_STRING_MAX,
  ARG_TYPES,
  ENUM_MAX,
  TOOL_DESCRIPTION_MAX,
  TOOL_NAME_RE,
  TOOL_SCHEMA_MAX,
  TOOLS_MAX,
  getPageTools,
  resetPageTools,
  sanitizeTool,
  sanitizeTools,
  setPageTools,
  validateToolArgs,
  wireTools,
  type ToolSchema,
} from '../src/lib/page-tools';
import { ChatStore } from '../src/store/chat.svelte';
import { resetHostPage, setHostPage } from '../src/lib/host-page';
import type { ActResult, PageAction } from '../src/lib/page-actions';

type WireTool = { name: string; description: unknown; input_schema: unknown };
type SchemaFixture = {
  cases: { name: string; tool: WireTool; accept: boolean }[];
  lists: { name: string; tools: WireTool[]; kept: string[]; kept_descriptions?: string[] }[];
};
const fixture = JSON.parse(schemasRaw) as SchemaFixture;
const bounds = (JSON.parse(expectedRaw) as { bounds: Record<string, unknown> }).bounds;

/** A fixture tool (server shape) as the host posts it into the frame. */
const hostShape = (t: WireTool, confirm?: boolean) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.input_schema,
  ...(confirm === undefined ? {} : { confirm }),
});

const CART_SCHEMA: ToolSchema = {
  type: 'object',
  properties: {
    product: { type: 'string', description: 'Product page path or SKU' },
    quantity: { type: 'integer', minimum: 1, maximum: 20 },
  },
  required: ['product'],
};
const CART = { name: 'add_to_cart', description: 'Add a product to the cart', inputSchema: CART_SCHEMA };

beforeEach(() => {
  localStorage.clear();
  resetPageTools();
  resetHostPage();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tool schema parity with pocketpaw', () => {
  it('the tool bounds match the constants the bar uses', () => {
    const re = (r: RegExp) => r.source.replace(/^\^|\$$/g, '');
    expect(bounds).toMatchObject({
      tools_max: TOOLS_MAX,
      tool_name_re: re(TOOL_NAME_RE),
      tool_description_max: TOOL_DESCRIPTION_MAX,
      tool_schema_max: TOOL_SCHEMA_MAX,
      arg_string_max: ARG_STRING_MAX,
      arg_name_re: re(ARG_NAME_RE),
      enum_max: ENUM_MAX,
      arg_types: [...ARG_TYPES],
    });
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const tool = sanitizeTool(hostShape(c.tool));
    expect(tool !== null).toBe(c.accept);
    if (tool) expect(tool.inputSchema).toEqual(c.tool.input_schema);
  });

  it.each(fixture.lists.map((l) => [l.name, l] as const))('list %s', (_name, l) => {
    const kept = sanitizeTools(l.tools.map((t) => hostShape(t)));
    expect(kept.map((t) => t.name)).toEqual(l.kept);
    if (l.kept_descriptions) expect(kept.map((t) => t.description)).toEqual(l.kept_descriptions);
  });
});

describe('sanitizeTools', () => {
  it('stores the description with its whitespace collapsed', () => {
    expect(sanitizeTool({ ...CART, description: '  Add   a product\n to the cart ' })?.description).toBe('Add a product to the cart');
  });

  it('confirm is true unless the host said exactly false', () => {
    const tools = sanitizeTools([
      { ...CART, name: 'a' },
      { ...CART, name: 'b', confirm: false },
      { ...CART, name: 'c', confirm: 'no' },
    ]);
    expect(tools.map((t) => t.confirm)).toEqual([true, false, true]);
  });

  it('keeps a copy, so the host cannot change a schema after it is checked', () => {
    const schema = structuredClone(CART_SCHEMA);
    const [tool] = sanitizeTools([{ ...CART, inputSchema: schema }]);
    schema.properties!.quantity.maximum = 999;
    expect(tool.inputSchema.properties!.quantity.maximum).toBe(20);
  });

  it('warns the site developer about a refused tool', () => {
    sanitizeTools([{ ...CART, name: 'Bad Name' }]);
    expect(console.warn).toHaveBeenCalledWith('[paw-bar] tool rejected:', 'Bad Name');
  });

  it('treats anything but a list as nothing', () => {
    expect(sanitizeTools({ tools: [CART] })).toEqual([]);
    expect(sanitizeTools(null)).toEqual([]);
  });
});

describe('validateToolArgs', () => {
  it('returns a copy of good args', () => {
    const args = { product: 'CAIRN-45', quantity: 2 };
    const out = validateToolArgs(CART_SCHEMA, args);
    expect(out).toEqual(args);
    expect(out).not.toBe(args);
  });

  it.each([
    ['not an object', 'CAIRN-45'],
    ['an array', ['CAIRN-45']],
    ['missing required', { quantity: 1 }],
    ['an extra key', { product: 'x', color: 'red' }],
    ['a wrong type', { product: 'x', quantity: '2' }],
    ['a fraction for an integer', { product: 'x', quantity: 1.5 }],
    ['below minimum', { product: 'x', quantity: 0 }],
    ['above maximum', { product: 'x', quantity: 21 }],
    ['a string over 200', { product: 'p'.repeat(201) }],
    ['an inherited key name', JSON.parse('{"product":"x","__proto__":{"y":1}}')],
  ])('refuses %s', (_why, args) => {
    expect(validateToolArgs(CART_SCHEMA, args)).toBeNull();
  });

  it('reads absent args as {}', () => {
    const none: ToolSchema = { type: 'object' };
    expect(validateToolArgs(none, undefined)).toEqual({});
    expect(validateToolArgs(none, null)).toEqual({});
    expect(validateToolArgs(CART_SCHEMA, undefined)).toBeNull();
  });

  it('checks enum', () => {
    const schema: ToolSchema = { type: 'object', properties: { size: { type: 'string', enum: ['S', 'M'] } } };
    expect(validateToolArgs(schema, { size: 'M' })).toEqual({ size: 'M' });
    expect(validateToolArgs(schema, { size: 'XL' })).toBeNull();
  });
});

describe('the registry', () => {
  it('replaces the list on each message and ignores a message that is not a list', () => {
    setPageTools([CART]);
    expect(getPageTools().map((t) => t.name)).toEqual(['add_to_cart']);
    setPageTools('nope');
    expect(getPageTools()).toHaveLength(1);
    setPageTools([]);
    expect(getPageTools()).toEqual([]);
  });

  it('goes on the wire without confirm and with input_schema', () => {
    setPageTools([{ ...CART, confirm: false }]);
    expect(wireTools()).toEqual([{ name: 'add_to_cart', description: 'Add a product to the cart', input_schema: CART_SCHEMA }]);
  });
});

// ── ChatStore ────────────────────────────────────────────────────────────────
const enc = (s: string) => new TextEncoder().encode(s);
const CHUNK = 'event: chunk\ndata: {"content":"Sure.","type":"text"}\n\n';
const END = 'event: stream_end\ndata: {"assistant_message_id":"m1","cancelled":false}\n\n';
const TOOL_ACTION = { do: 'tool', name: 'add_to_cart', args: { product: '/products/cairn-45/', quantity: 1 }, label: 'Add Cairn 45 to your cart' };
const actionFrame = (a: object) => `event: action\ndata: ${JSON.stringify({ type: 'action', action: a })}\n\n`;
const base = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };
const flush = () => new Promise((r) => setTimeout(r, 0));

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(enc(p));
      c.close();
    },
  });
}
/** The JSON body of the chat POST among whatever else was fetched. */
function chatBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/paw-bar/chat'));
  return JSON.parse((call?.[1] as RequestInit).body as string);
}
function reply(...parts: string[]) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: streamOf(...parts) });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('the chat request', () => {
  it('carries page.tools when the host declared any', async () => {
    setHostPage({ url: 'https://shop.example.com/products/cairn-45', title: 'Cairn 45' });
    setPageTools([CART]);
    const fetchMock = reply(CHUNK + END);
    await new ChatStore(base).send('hi');
    expect(chatBody(fetchMock).page).toEqual({
      url: 'https://shop.example.com/products/cairn-45',
      title: 'Cairn 45',
      tools: [{ name: 'add_to_cart', description: 'Add a product to the cart', input_schema: CART_SCHEMA }],
    });
  });

  it('leaves tools off when there are none, and sends none without a page', async () => {
    setHostPage({ url: 'https://shop.example.com/', title: 'Shop' });
    let fetchMock = reply(CHUNK + END);
    await new ChatStore(base).send('hi');
    expect(chatBody(fetchMock).page).toEqual({ url: 'https://shop.example.com/', title: 'Shop' });

    resetHostPage();
    setPageTools([CART]);
    fetchMock = reply(CHUNK + END);
    await new ChatStore({ ...base, widgetId: 'w2' }).send('hi');
    expect(chatBody(fetchMock)).not.toHaveProperty('page');
  });
});

describe('ChatStore and site tools', () => {
  const ok = (message?: string) => vi.fn(async (): Promise<ActResult> => ({ ok: true, ...(message ? { message } : {}) }));

  it('drops a tool the host never declared', async () => {
    reply(CHUNK + actionFrame(TOOL_ACTION) + END);
    const runAction = ok();
    const store = new ChatStore({ ...base, runAction });
    await store.send('add it');
    await flush();
    expect(store.messages[1].action).toBeUndefined();
    expect(runAction).not.toHaveBeenCalled();
  });

  it('drops a tool whose args do not fit its schema', async () => {
    setPageTools([CART]);
    reply(CHUNK + actionFrame({ ...TOOL_ACTION, args: { product: 'x', quantity: 99 } }) + END);
    const store = new ChatStore({ ...base, runAction: ok() });
    await store.send('add it');
    expect(store.messages[1].action).toBeUndefined();
  });

  it('waits on the visitor, then Confirm runs it once and shows the message', async () => {
    setPageTools([CART]);
    reply(CHUNK + actionFrame(TOOL_ACTION) + END);
    const runAction = ok('Added Cairn 45 to your cart');
    const store = new ChatStore({ ...base, runAction });
    await store.send('add it');
    await flush();
    expect(runAction).not.toHaveBeenCalled();
    expect(store.messages[1].action).toEqual({ ...TOOL_ACTION, state: 'confirm' });

    const id = store.messages[1].id;
    store.answerTool(id, true);
    store.answerTool(id, true);
    expect(store.messages[1].action?.state).toBe('pending');
    await flush();
    expect(runAction).toHaveBeenCalledOnce();
    expect(runAction).toHaveBeenCalledWith({ do: 'tool', name: 'add_to_cart', args: TOOL_ACTION.args, label: TOOL_ACTION.label });
    expect(store.messages[1].action).toMatchObject({ state: 'done', message: 'Added Cairn 45 to your cart' });
  });

  it('Cancel runs nothing and the card does not come back', async () => {
    setPageTools([CART]);
    reply(CHUNK + actionFrame(TOOL_ACTION) + END);
    const runAction = ok();
    const store = new ChatStore({ ...base, runAction });
    await store.send('add it');
    store.answerTool(store.messages[1].id, false);
    store.answerTool(store.messages[1].id, true);
    await flush();
    expect(runAction).not.toHaveBeenCalled();
    expect(store.messages[1].action?.state).toBe('cancelled');
    expect(new ChatStore(base).messages[1].action?.state).toBe('cancelled');
  });

  it('runs at once when the host set confirm:false', async () => {
    setPageTools([{ ...CART, confirm: false }]);
    reply(CHUNK + actionFrame(TOOL_ACTION) + END);
    const runAction = ok();
    const store = new ChatStore({ ...base, runAction });
    await store.send('add it');
    await flush();
    expect(runAction).toHaveBeenCalledOnce();
    expect(store.messages[1].action).toMatchObject({ state: 'done' });
    expect(store.messages[1].action).not.toHaveProperty('message');
  });

  it('a failed tool keeps its message, or falls back to the plain line', async () => {
    setPageTools([{ ...CART, confirm: false }]);
    reply(CHUNK + actionFrame(TOOL_ACTION) + END);
    const store = new ChatStore({
      ...base,
      runAction: async () => ({ ok: false, error: 'failed', message: 'Out of stock' }),
    });
    await store.send('add it');
    await flush();
    expect(store.messages[1].action).toMatchObject({ state: 'failed', message: 'Out of stock' });

    reply(CHUNK + actionFrame(TOOL_ACTION) + END);
    const other = new ChatStore({ ...base, widgetId: 'w2', runAction: async () => ({ ok: false, error: 'timeout' }) });
    await other.send('add it');
    await flush();
    expect(other.messages[1].action?.state).toBe('failed');
    expect(other.messages[1].action).not.toHaveProperty('message');
  });

  it('fails a confirmed tool the host no longer declares, without posting', async () => {
    setPageTools([CART]);
    reply(CHUNK + actionFrame(TOOL_ACTION) + END);
    const runAction = ok();
    const store = new ChatStore({ ...base, runAction });
    await store.send('add it');
    setPageTools([]);
    store.answerTool(store.messages[1].id, true);
    await flush();
    expect(runAction).not.toHaveBeenCalled();
    expect(store.messages[1].action?.state).toBe('failed');
  });

  it('an unavailable frame in the same turn discards the tool', async () => {
    setPageTools([{ ...CART, confirm: false }]);
    reply(CHUNK + actionFrame(TOOL_ACTION) + 'event: unavailable\ndata: {"type":"unavailable","reason":"temporary"}\n\n' + END);
    const runAction = ok();
    const store = new ChatStore({ ...base, runAction });
    await store.send('add it');
    await flush();
    expect(runAction).not.toHaveBeenCalled();
    expect(store.messages[1].action).toBeUndefined();
    store.dispose();
  });

  it('a reload re-offers an unanswered card but never one that was confirmed', async () => {
    setPageTools([CART]);
    reply(CHUNK + actionFrame(TOOL_ACTION) + END);
    // A host that never answers: the page reloads while the tool is running.
    const store = new ChatStore({ ...base, runAction: () => new Promise<ActResult>(() => {}) });
    await store.send('add it');
    expect(new ChatStore(base).messages[1].action?.state).toBe('confirm');

    store.answerTool(store.messages[1].id, true);
    resetPageTools();
    const after = new ChatStore(base);
    expect(after.messages[1].action).toMatchObject({ do: 'tool', name: 'add_to_cart', state: 'done' });
    after.answerTool(after.messages[1].id, true);
    expect(after.messages[1].action?.state).toBe('done');
  });

  it('a stored result message survives a reload', async () => {
    setPageTools([{ ...CART, confirm: false }]);
    reply(CHUNK + actionFrame(TOOL_ACTION) + END);
    const store = new ChatStore({ ...base, runAction: ok('Added to your cart') });
    await store.send('add it');
    await flush();
    const back = new ChatStore(base).messages[1].action as PageAction & { message?: string };
    expect(back).toMatchObject({ state: 'done', message: 'Added to your cart', args: TOOL_ACTION.args });
  });
});
