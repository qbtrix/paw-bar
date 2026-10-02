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
    barTheme: 'default',
    radius: undefined,
    launcher: 'bar',
    side: 'right',
    barSize: 'md',
    logo: '',
    disclosure: '',
    privacyHref: '',
    consentRequired: false,
    voice: true,
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

function shell(extra: Partial<PawBarConfig> = {}, actions?: ActionRunner) {
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
      config: config(extra),
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
