// tests/bar-shell.spec.svelte.ts — BarShell, the new bar as the widget
// (2026-09-27). Consent gates the chat store itself, not just the UI: with
// consent required nothing is built and nothing is stored until Accept, which
// saves the yes, builds the stores and sends the held message once; a saved
// yes skips the step on the next load. The loader hears only the chip
// protocol: view('chip') at boot and never open/bar, overlay(true) only while
// the card is open, expand(on) for full screen. A pinned bar polls fast and a
// closed one slow.
// 2026-09-27 (old shell removed): the config fixture drops `ui`, which
// PawBarConfig no longer has.
// The owner's look reaches the frame: `tokensDark` over `tokens` only when the
// scheme resolves dark, and `launcher`/`side`/`logo` land on the stage, the
// loader's resize report and the pill.
// Page actions: pawbar:act-result reaches the runner only from parentOrigin,
// and never when parentOrigin is empty; a pawbar:page a navigate was heading
// for opens the bar on "Here's the page". Site tools: the shell asks for them
// at boot, and pawbar:tools reaches the registry only from parentOrigin and
// the parent window, never when parentOrigin is empty.
// Site theme: the #t= theme paints at boot; pawbar:site-theme replaces it only
// from the parent window at parentOrigin; in the owner preview it comes from
// the iframe.pawbar-scene window (origin 'null') and nobody else, and the
// shell asks that scene for it at boot. poweredBy / expandable reach the
// frame, and a live (preview) config change redraws it.
// Owner preview state (pawbar:preview-state): only with preview, from the
// parent window at parentOrigin. 'rest' folds the bar and leaves full screen,
// 'open' pins an empty thread (greeting, consent) over the real one, 'thread'
// pins the local sample, and none of it fetches, polls, sends or stores.
// The preview posts the site theme up to parentOrigin as it lands, and null
// once when none came within 2s of boot.
// In the owner preview the empty stage lets input through to the site under
// it, and focus moving into the scene iframe folds an open card.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

import { mount, unmount, flushSync, tick } from 'svelte';
import BarShell, { CONSENT_KEY } from '../src/components/bar/BarShell.svelte';
import { CartStore } from '../src/store/cart.svelte';
import { ContactStore } from '../src/store/contact.svelte';
import { ConversationsStore } from '../src/store/conversations.svelte';
import type { PawBarConfig } from '../src/config';
import type { ActionRunner } from '../src/lib/page-actions';
import { getPageTools, resetPageTools } from '../src/lib/page-tools';

let live: ReturnType<typeof mount> | null = null;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const storeConfig = { endpoint: 'http://api.test/api/v1', widgetId: 'w1', siteKey: 'k1' };

function config(extra: Partial<PawBarConfig> = {}): PawBarConfig {
  return {
    ...storeConfig,
    parentOrigin: 'http://host.test',
    mode: 'concierge',
    preview: false,
    tokens: {},
    tokensDark: {},
    scheme: 'auto',
    hostScheme: '',
    greeting: '',
    starters: [],
    agentName: 'Concierge',
    agentAvatar: '',
    agentSubtitle: '',
    avatars: [],
    launcherLabel: '',
    barResting: 'compact',
    siteTheme: {},
    launcher: 'bar',
    side: 'right',
    barSize: 'md',
    logo: '',
    disclosure: '',
    privacyHref: '',
    consentRequired: false,
    voice: true,
    poweredBy: true,
    expandable: true,
    ...extra,
  };
}

/** A chat store stand-in with the surface BarShell reads. */
function fakeChat() {
  const chat = $state({
    messages: [] as { id: string; role: string; content: string; status: string }[],
    conversationId: '',
    hydrating: false,
    botPaused: false,
    notice: null,
    unavailable: null,
    cooldownUntil: null,
    queueFull: false,
    handoff: 'none',
    send: vi.fn(async (text: string) => {
      chat.messages.push({ id: 'u' + chat.messages.length, role: 'user', content: text, status: 'done' });
      return { ok: true as const };
    }),
    stop: vi.fn(),
    retry: vi.fn(),
    requestHuman: vi.fn(),
    switchTo: vi.fn(),
    reset: vi.fn(),
    adoptConversation: vi.fn(),
    arrived: vi.fn((_url: string) => false),
  });
  return chat;
}

function shell(extra: Partial<PawBarConfig> = {}, actions?: ActionRunner, liveConfig?: PawBarConfig) {
  const target = document.createElement('div');
  document.body.append(target);
  const poster = {
    resize: vi.fn(),
    view: vi.fn(),
    open: vi.fn(),
    expand: vi.fn(),
    close: vi.fn(),
    dragStart: vi.fn(),
    dragEnd: vi.fn(),
    overlay: vi.fn(),
    bar: vi.fn(),
    act: vi.fn(() => true),
    requestTools: vi.fn(),
  };
  const chat = fakeChat();
  const operator = { start: vi.fn(), startClosed: vi.fn(), stop: vi.fn() };
  const createChat = vi.fn(() => ({ chat, operator }) as never);
  live = mount(BarShell, {
    target,
    props: {
      config: liveConfig ?? config(extra),
      poster,
      cart: new CartStore(storeConfig),
      contact: new ContactStore(storeConfig),
      conversations: new ConversationsStore(storeConfig),
      createChat,
      actions,
    },
  });
  flushSync();
  return { target, poster, chat, operator, createChat };
}

const q = <T extends Element = HTMLElement>(t: HTMLElement, sel: string) => t.querySelector<T & HTMLElement>(sel);
function openCard(t: HTMLElement) {
  q<HTMLButtonElement>(t, '.trigger')!.click();
  flushSync();
}
function type(t: HTMLElement, v: string) {
  const f = q<HTMLTextAreaElement>(t, 'textarea')!;
  f.value = v;
  f.dispatchEvent(new Event('input'));
  flushSync();
  return f;
}

describe('consent gates the stores, not just the UI', () => {
  it('without consent required, the chat store is built at once', () => {
    const { createChat } = shell();
    expect(createChat).toHaveBeenCalledOnce();
  });

  it('with consent required, nothing is built or stored until Accept, then the held message goes once', async () => {
    const { target, createChat, chat } = shell({ consentRequired: true });
    expect(createChat).not.toHaveBeenCalled();
    openCard(target);
    const field = type(target, 'Do you ship to Oslo?');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await tick();
    flushSync();
    expect(createChat).not.toHaveBeenCalled();
    expect(Object.keys(localStorage)).toEqual([]);

    [...target.querySelectorAll<HTMLButtonElement>('.consent button')].find((b) => b.textContent === 'Accept')!.click();
    flushSync();
    await tick();
    flushSync();
    expect(createChat).toHaveBeenCalledOnce();
    expect(localStorage.getItem(CONSENT_KEY + 'w1')).toBe('1');
    expect(chat.send).toHaveBeenCalledOnce();
    expect(chat.send).toHaveBeenCalledWith('Do you ship to Oslo?');
  });

  it('a saved yes skips the step next time', () => {
    localStorage.setItem(CONSENT_KEY + 'w1', '1');
    const { target, createChat } = shell({ consentRequired: true });
    expect(createChat).toHaveBeenCalledOnce();
    openCard(target);
    expect(q(target, '.consent')).toBeNull();
  });

  it('"Not now" builds nothing', () => {
    const { target, createChat } = shell({ consentRequired: true });
    openCard(target);
    [...target.querySelectorAll<HTMLButtonElement>('.consent button')].find((b) => b.textContent === 'Not now')!.click();
    flushSync();
    expect(createChat).not.toHaveBeenCalled();
  });
});

describe('the loader protocol', () => {
  it('asks for the content-sized chip at boot, and never for the column or the fixed bar', () => {
    const { target, poster } = shell();
    expect(poster.view).toHaveBeenCalledWith('chip');
    openCard(target);
    expect(poster.open).not.toHaveBeenCalled();
    expect(poster.bar).not.toHaveBeenCalled();
    expect(poster.view.mock.calls.every(([v]) => v === 'chip')).toBe(true);
  });

  it('declares the overlay only while the card is open, so host clicks come back then and only then', async () => {
    const { target, poster } = shell();
    expect(poster.overlay).toHaveBeenLastCalledWith(false);
    openCard(target);
    expect(poster.overlay).toHaveBeenLastCalledWith(true);
    q<HTMLButtonElement>(target, '.frame-head button[aria-label="Close chat"]')!.click();
    await tick();
    flushSync();
    expect(poster.overlay).toHaveBeenLastCalledWith(false);
  });

  it('full screen asks the loader for the viewport and gives it back', () => {
    const { target, poster } = shell();
    openCard(target);
    q<HTMLButtonElement>(target, 'button[aria-label="Full screen"]')!.click();
    flushSync();
    expect(poster.expand).toHaveBeenLastCalledWith(true);
    q<HTMLButtonElement>(target, 'button[aria-label="Exit full screen"]')!.click();
    flushSync();
    expect(poster.expand).toHaveBeenLastCalledWith(false);
  });
});

describe('polling', () => {
  it('polls slowly while closed and fast while pinned', () => {
    const { target, operator } = shell();
    expect(operator.startClosed).toHaveBeenCalled();
    openCard(target);
    expect(operator.start).toHaveBeenCalled();
  });
});

describe('sending', () => {
  it('sends through the chat store', async () => {
    const { target, chat } = shell();
    openCard(target);
    const field = type(target, 'hello');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await tick();
    expect(chat.send).toHaveBeenCalledWith('hello');
  });
});

describe("the owner's look reaches the frame", () => {
  const tokens = { '--pawbar-accent': '#111111' };
  const tokensDark = { '--pawbar-accent': '#eeeeee' };

  it('applies tokensDark over tokens when the scheme is dark', () => {
    const { target } = shell({ scheme: 'dark', tokens, tokensDark });
    expect(q(target, '.frame-wrap')!.style.getPropertyValue('--pawbar-accent')).toBe('#eeeeee');
  });

  it('leaves tokensDark out when the scheme is light', () => {
    const { target } = shell({ scheme: 'light', tokens, tokensDark });
    expect(q(target, '.frame-wrap')!.style.getPropertyValue('--pawbar-accent')).toBe('#111111');
  });

  it('auto follows the host page the loader read', () => {
    const { target } = shell({ scheme: 'auto', hostScheme: 'd', tokens, tokensDark });
    expect(q(target, '.frame-wrap')!.style.getPropertyValue('--pawbar-accent')).toBe('#eeeeee');
  });

  it('an icon launcher docks in its side and tells the loader which', () => {
    const { target, poster } = shell({ launcher: 'icon', side: 'left' });
    expect(q(target, '.stage')!.dataset.anchor).toBe('left');
    expect(q(target, '.frame-wrap')!.dataset.launcher).toBe('icon');
    expect(poster.resize).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 'left');
  });

  it("the bar launcher sits in the centre, and the logo is the pill's", () => {
    const { target } = shell({ logo: 'https://cdn.test/logo.png' });
    expect(q(target, '.stage')!.dataset.anchor).toBe('center');
    expect(q<HTMLImageElement>(target, 'img.brand')?.getAttribute('src')).toBe('https://cdn.test/logo.png');
  });
});

describe('page actions', () => {
  const parent = {} as Window;
  function fromParent(origin: string, data: unknown) {
    const ev = new MessageEvent('message', { origin, data });
    Object.defineProperty(ev, 'source', { value: parent });
    window.dispatchEvent(ev);
    flushSync();
  }
  beforeEach(() => {
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
  });
  afterEach(() => vi.restoreAllMocks());
  const runner = () => ({ run: vi.fn<ActionRunner['run']>(), receive: vi.fn<ActionRunner['receive']>() });
  const result = { type: 'pawbar:act-result', id: 'a1', ok: true };

  it('hands act-result to the runner only from parentOrigin', () => {
    const actions = runner();
    shell({}, actions);
    fromParent('http://evil.test', result);
    expect(actions.receive).not.toHaveBeenCalled();
    fromParent('http://host.test', result);
    expect(actions.receive).toHaveBeenCalledWith(result);
  });

  it('ignores act-result when parentOrigin is empty (fail closed)', () => {
    const actions = runner();
    shell({ parentOrigin: '' }, actions);
    fromParent('http://host.test', result);
    fromParent('', result);
    expect(actions.receive).not.toHaveBeenCalled();
  });

  it('opens on the page a navigate was heading for', () => {
    // A pinned (open) bar runs the fast operator poll; a closed one the slow.
    const { chat, operator } = shell();
    chat.arrived.mockReturnValueOnce(false).mockReturnValueOnce(true);
    fromParent('http://host.test', { type: 'pawbar:page', url: 'http://host.test/other', title: 'Other' });
    expect(chat.arrived).toHaveBeenCalledWith('http://host.test/other');
    expect(operator.start).not.toHaveBeenCalled();
    fromParent('http://host.test', { type: 'pawbar:page', url: 'http://host.test/boots/', title: 'Boots' });
    expect(chat.arrived).toHaveBeenLastCalledWith('http://host.test/boots/');
    expect(operator.start).toHaveBeenCalled();
  });
});

describe('site tools', () => {
  const parent = {} as Window;
  function message(origin: string, data: unknown, source: unknown = parent) {
    const ev = new MessageEvent('message', { origin, data });
    Object.defineProperty(ev, 'source', { value: source });
    window.dispatchEvent(ev);
    flushSync();
  }
  const tools = {
    type: 'pawbar:tools',
    tools: [
      {
        name: 'add_to_cart',
        description: 'Add a product to the cart',
        inputSchema: { type: 'object', properties: { product: { type: 'string' } }, required: ['product'] },
        confirm: true,
      },
    ],
  };
  beforeEach(() => {
    resetPageTools();
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
  });
  afterEach(() => vi.restoreAllMocks());

  it('asks the host page for its tools at boot', () => {
    const { poster } = shell();
    expect(poster.requestTools).toHaveBeenCalledOnce();
  });

  it('takes the list only from parentOrigin and the parent window', () => {
    shell();
    message('http://evil.test', tools);
    message('http://host.test', tools, window);
    expect(getPageTools()).toEqual([]);
    message('http://host.test', tools);
    expect(getPageTools().map((t) => t.name)).toEqual(['add_to_cart']);
    message('http://host.test', { type: 'pawbar:tools', tools: [] });
    expect(getPageTools()).toEqual([]);
  });

  it('ignores tools when parentOrigin is empty (fail closed)', () => {
    shell({ parentOrigin: '' });
    message('http://host.test', tools);
    message('', tools);
    expect(getPageTools()).toEqual([]);
  });
});

describe('the site theme', () => {
  const parent = { postMessage: vi.fn() } as unknown as Window;
  function message(origin: string, data: unknown, source: unknown = parent) {
    const ev = new MessageEvent('message', { origin, data });
    Object.defineProperty(ev, 'source', { value: source });
    window.dispatchEvent(ev);
    flushSync();
  }
  const accent = (t: HTMLElement) => q(t, '.frame-wrap')!.style.getPropertyValue('--pawbar-accent');
  const theme = (a: string) => ({ type: 'pawbar:site-theme', theme: { accent: a } });
  beforeEach(() => {
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
  });
  afterEach(() => vi.restoreAllMocks());

  it('paints the theme the loader put in the fragment, under the owner tokens', () => {
    const { target } = shell({ scheme: 'light', siteTheme: { accent: '#1d4ed8', radius: 6 } });
    expect(accent(target)).toBe('#1d4ed8');
    expect(q(target, '.frame-wrap')!.style.getPropertyValue('--pawbar-radius')).toBe('6px');
    const owned = shell({ scheme: 'light', siteTheme: { accent: '#1d4ed8' }, tokens: { '--pawbar-accent': '#0f766e' } });
    expect(accent(owned.target)).toBe('#0f766e');
  });

  it('takes a new theme only from the parent window at parentOrigin, validated', () => {
    const { target } = shell({ scheme: 'light' });
    message('http://evil.test', theme('#1d4ed8'));
    message('http://host.test', theme('#1d4ed8'), window);
    expect(accent(target)).toBe('');
    message('http://host.test', theme('#1d4ed8'));
    expect(accent(target)).toBe('#1d4ed8');
    message('http://host.test', theme('url(x)'));
    expect(accent(target)).toBe('');
  });

  it('ignores the loader theme when parentOrigin is empty (fail closed)', () => {
    const { target } = shell({ scheme: 'light', parentOrigin: '' });
    message('http://host.test', theme('#1d4ed8'));
    message('', theme('#1d4ed8'));
    expect(accent(target)).toBe('');
  });

  describe('in the owner preview', () => {
    let scene: HTMLIFrameElement;
    beforeEach(() => {
      scene = document.createElement('iframe');
      scene.className = 'pawbar-scene';
      document.body.append(scene);
    });

    it("asks the scene at boot and takes its theme, origin 'null'", () => {
      const ask = vi.spyOn(scene.contentWindow!, 'postMessage');
      const { target } = shell({ scheme: 'light', preview: true });
      expect(ask).toHaveBeenCalledWith({ type: 'pawbar:sniff' }, '*');
      message('null', theme('#1d4ed8'), scene.contentWindow);
      expect(accent(target)).toBe('#1d4ed8');
    });

    it('takes it from no other window, and not outside the preview', () => {
      const { target } = shell({ scheme: 'light', preview: true });
      message('null', theme('#1d4ed8'), {});
      expect(accent(target)).toBe('');
      if (live) unmount(live);
      live = null;
      document.body.append(scene);
      const pub = shell({ scheme: 'light', preview: false });
      message('null', theme('#1d4ed8'), scene.contentWindow);
      expect(accent(pub.target)).toBe('');
    });
  });
});

describe('owner switches', () => {
  it('poweredBy and expandable reach the frame', () => {
    const on = shell({ greeting: 'Hi' });
    openCard(on.target);
    expect(on.target.textContent).toContain('Paw Sites');
    expect(q(on.target, 'button[aria-label="Full screen"]')).not.toBeNull();
    if (live) unmount(live);
    live = null;
    const { target } = shell({ poweredBy: false, expandable: false, greeting: 'Hi' });
    openCard(target);
    expect(target.textContent).not.toContain('Paw Sites');
    expect(q(target, 'button[aria-label="Full screen"]')).toBeNull();
  });

  it('a live config change redraws the bar (the owner preview)', () => {
    const cfg = $state(config({ preview: true }));
    const { target } = shell({}, undefined, cfg);
    expect(q(target, '.stage')!.dataset.anchor).toBe('center');
    cfg.launcher = 'icon';
    cfg.side = 'left';
    flushSync();
    expect(q(target, '.stage')!.dataset.anchor).toBe('left');
  });

  it('a live consentRequired shows the step in the preview, and saves nothing', () => {
    const cfg = $state(config({ preview: true }));
    const { target } = shell({}, undefined, cfg);
    cfg.consentRequired = true;
    flushSync();
    openCard(target);
    type(target, 'hi').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    flushSync();
    expect(q(target, '.consent')).not.toBeNull();
    cfg.consentRequired = false;
    flushSync();
    expect(q(target, '.consent')).toBeNull();
    expect(localStorage.getItem(CONSENT_KEY + 'w1')).toBeNull();
  });
});

describe('the owner preview state', () => {
  const parent = { postMessage: vi.fn() } as unknown as Window;
  function message(origin: string, data: unknown, source: unknown = parent) {
    const ev = new MessageEvent('message', { origin, data });
    Object.defineProperty(ev, 'source', { value: source });
    window.dispatchEvent(ev);
    flushSync();
  }
  const state = (s: unknown, origin = 'http://host.test', source: unknown = parent) =>
    message(origin, { type: 'pawbar:preview-state', state: s }, source);
  const shows = (t: HTMLElement, text: string) => (t.textContent ?? '').includes(text);
  function seeded(extra: Partial<PawBarConfig> = {}) {
    const s = shell({ preview: true, greeting: 'Hello there', ...extra });
    s.chat.messages.push({ id: 'r1', role: 'user', content: 'my real question', status: 'done' });
    flushSync();
    return s;
  }
  beforeEach(() => {
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
  });
  afterEach(() => vi.restoreAllMocks());

  it('is ignored outside the preview, from another origin or window, and without parentOrigin', () => {
    const pub = shell({ greeting: 'Hello there' });
    state('thread');
    expect(shows(pub.target, 'Do you ship internationally?')).toBe(false);
    if (live) unmount(live);
    live = null;
    const { target } = shell({ preview: true });
    state('thread', 'http://evil.test');
    state('thread', 'http://host.test', window);
    state('thread', 'http://host.test', {});
    expect(shows(target, 'Do you ship internationally?')).toBe(false);
    if (live) unmount(live);
    live = null;
    const open = shell({ preview: true, parentOrigin: '' });
    state('thread', '');
    expect(shows(open.target, 'Do you ship internationally?')).toBe(false);
  });

  it('ignores a state it does not know', () => {
    const { target } = seeded();
    state('history');
    state({ toString: () => 'thread' });
    expect(shows(target, 'Hello there')).toBe(false);
    expect(shows(target, 'Do you ship internationally?')).toBe(false);
  });

  it("'open' pins an empty thread over the real one, consent step included", () => {
    const real = seeded();
    state('open');
    expect(shows(real.target, 'Hello there')).toBe(true);
    expect(shows(real.target, 'my real question')).toBe(false);
    expect(real.operator.start).not.toHaveBeenCalled();
    if (live) unmount(live);
    live = null;
    const { target, createChat } = seeded({ consentRequired: true });
    state('open');
    expect(q(target, '.consent')).not.toBeNull();
    vi.mocked(fetch).mockClear();
    [...target.querySelectorAll<HTMLButtonElement>('.consent button')].find((b) => b.textContent === 'Accept')!.click();
    flushSync();
    expect(q(target, '.consent')).toBeNull();
    expect(createChat).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("'thread' shows the sample and none of it leaves the frame", async () => {
    const { target, chat, operator } = seeded();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    const stored = () => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]);
    const before = stored();
    state('thread');
    expect(shows(target, 'Do you ship internationally?')).toBe(true);
    expect(shows(target, 'Yes, to most countries.')).toBe(true);
    expect(q(target, '.msg.owner')).not.toBeNull();
    expect(shows(target, 'my real question')).toBe(false);
    type(target, 'hi').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await tick();
    flushSync();
    expect(chat.send).not.toHaveBeenCalled();
    expect(operator.start).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stored()).toBe(before);
    state('open');
    expect(shows(target, 'Do you ship internationally?')).toBe(false);
  });

  it("'rest' folds the bar and leaves full screen", () => {
    const { target, poster } = seeded();
    state('open');
    q<HTMLButtonElement>(target, 'button[aria-label="Full screen"]')!.click();
    flushSync();
    expect(poster.expand).toHaveBeenLastCalledWith(true);
    state('rest');
    expect(poster.expand).toHaveBeenLastCalledWith(false);
    expect(shows(target, 'Hello there')).toBe(false);
    expect(shows(target, 'my real question')).toBe(false);
  });
});

describe('the preview reports the site theme', () => {
  const post = vi.fn();
  const parent = { postMessage: post } as unknown as Window;
  const reports = () => post.mock.calls.filter(([m]) => m?.type === 'pawbar:site-theme');
  function fromParent(theme: unknown) {
    const ev = new MessageEvent('message', { origin: 'http://host.test', data: { type: 'pawbar:site-theme', theme } });
    Object.defineProperty(ev, 'source', { value: parent });
    window.dispatchEvent(ev);
    flushSync();
  }
  beforeEach(() => {
    post.mockClear();
    vi.useFakeTimers();
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('posts the boot theme to parentOrigin, validated keys only', () => {
    shell({ preview: true, siteTheme: { accent: '#1d4ed8', radius: 6 } });
    vi.advanceTimersByTime(0);
    expect(reports()).toEqual([[{ type: 'pawbar:site-theme', theme: { accent: '#1d4ed8', radius: 6 } }, 'http://host.test']]);
  });

  it('posts null once when nothing arrives within 2s, then each theme as it lands', () => {
    shell({ preview: true });
    vi.advanceTimersByTime(1999);
    expect(reports()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(reports()).toEqual([[{ type: 'pawbar:site-theme', theme: null }, 'http://host.test']]);
    vi.advanceTimersByTime(5000);
    expect(reports()).toHaveLength(1);
    fromParent({ accent: '#1d4ed8', bogus: 1 });
    vi.advanceTimersByTime(0);
    expect(reports()[1]).toEqual([{ type: 'pawbar:site-theme', theme: { accent: '#1d4ed8' } }, 'http://host.test']);
  });

  it('a theme before 2s cancels the null', () => {
    shell({ preview: true });
    vi.advanceTimersByTime(500);
    fromParent({ font: 'Inter' });
    vi.advanceTimersByTime(5000);
    expect(reports()).toEqual([[{ type: 'pawbar:site-theme', theme: { font: 'Inter' } }, 'http://host.test']]);
  });

  it('posts nothing outside the preview or without parentOrigin', () => {
    shell({ siteTheme: { accent: '#1d4ed8' } });
    if (live) unmount(live);
    live = null;
    shell({ preview: true, parentOrigin: '', siteTheme: { accent: '#1d4ed8' } });
    vi.advanceTimersByTime(5000);
    expect(reports()).toEqual([]);
  });
});

describe('the owner preview lets the site behind the bar take input', () => {
  // The stage covers the whole window. In the preview that window also holds
  // the site (iframe.pawbar-scene) under it, so only the bar itself may take
  // pointer input. jsdom computes no stylesheet, so the rule is read from source.
  const source = Object.values(
    import.meta.glob('../src/components/bar/BarShell.svelte', { query: '?raw', import: 'default', eager: true }),
  )[0] as string;
  const style = source.slice(source.lastIndexOf('<style>'));
  const rule = (sel: RegExp) => style.match(new RegExp(sel.source + String.raw`\s*\{([^}]*)\}`))?.[1] ?? '';

  it('the empty stage lets clicks and scrolls through; the bar takes them', () => {
    expect(rule(/\n\s*\.stage/)).toMatch(/pointer-events:\s*none/);
    expect(rule(/\.stage > :global\(\.frame-wrap\)/)).toMatch(/pointer-events:\s*auto/);
  });

  let scene: HTMLIFrameElement;
  beforeEach(() => {
    scene = document.createElement('iframe');
    scene.className = 'pawbar-scene';
    document.body.append(scene);
  });
  afterEach(() => {
    delete (document as { activeElement?: unknown }).activeElement;
  });
  /** A click in the scene: focus moves into its iframe and this window blurs. */
  function clickScene() {
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => scene });
    window.dispatchEvent(new Event('blur'));
    flushSync();
  }

  it('in the preview, a click on the site folds an open card', async () => {
    const { target, poster } = shell({ preview: true });
    openCard(target);
    expect(poster.overlay).toHaveBeenLastCalledWith(true);
    clickScene();
    await tick();
    flushSync();
    expect(poster.overlay).toHaveBeenLastCalledWith(false);
  });

  it('outside the preview, a blur does nothing (the loader reports host clicks)', async () => {
    const { target, poster } = shell({ preview: false });
    openCard(target);
    clickScene();
    await tick();
    flushSync();
    expect(poster.overlay).toHaveBeenLastCalledWith(true);
  });
});
