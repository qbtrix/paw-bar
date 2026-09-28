// tests/spec-widgets.spec.svelte.ts — generated UI in the thread: a Ripple spec
// sent as a pawbar-card fence, drawn with the bar's own widgets. Created
// 2026-09-27.
//
// Covers the routing (spec vs legacy card), the bounds on an agent-written
// spec, each widget, the two bar actions a spec can trigger (and that nothing
// else it emits does anything), and the manifest: that it lists exactly the
// registered widgets and the actions the bar honours, and that the committed
// pawbar-manifest.json is current.
// 2026-09-27: the atoms use Ripple's standard slim props (text, badge variant,
// button variant default/secondary/outline, flex instead of stack).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import committedManifest from '../pawbar-manifest.json?raw';
import CardHarness from './fixtures/spec/CardHarness.svelte';
import { CartStore } from '../src/store/cart.svelte';
import { parseSpecCard, MAX_SPEC_NODES, MAX_SPEC_DEPTH, MAX_SPEC_CHARS } from '../src/lib/spec-card';
import { SPEC_WIDGETS } from '../src/components/spec-widgets/registry';
import { PAWBAR_ACTIONS, PAWBAR_WIDGETS, buildPawBarManifest } from '../src/lib/spec-manifest';

let live: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function newCart(): CartStore {
  return new CartStore({ endpoint: 'https://api.example', widgetId: 'w1', siteKey: 'k' });
}

function render(spec: unknown, cart: CartStore | null = newCart()) {
  const target = document.createElement('div');
  document.body.append(target);
  const json = typeof spec === 'string' ? spec : JSON.stringify(spec);
  live = mount(CardHarness, { target, props: { json, cart: cart ?? undefined } });
  flushSync();
  return { target, cart };
}

const node = (type: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ type, props, ...extra });
const unavailable = (t: HTMLElement) => t.textContent?.includes('Card unavailable') ?? false;

describe('routing a pawbar-card fence', () => {
  it('draws a spec (JSON with `ui`) with the bar widgets', () => {
    const { target } = render({ ui: node('flex', {}, { children: [node('heading', { text: 'Your options' }), node('text', { text: 'Pick one.' })] }) });
    expect(target.querySelector('.spec-card h3')?.textContent).toBe('Your options');
    expect(target.querySelector('.spec-card p.spec-text')?.textContent).toBe('Pick one.');
  });

  it('leaves a legacy product card on the legacy path', () => {
    const { target } = render({ kind: 'product', items: [{ id: 'a', name: 'Wetsuit', price_cents: 100, actions: ['add_to_cart'] }] });
    expect(target.querySelector('.spec-card')).toBeNull();
    expect(target.textContent).toContain('Wetsuit');
  });

  it('shows "Card unavailable" without a cart store, for specs as for cards', () => {
    const { target } = render({ ui: node('text', { text: 'x' }) }, null);
    expect(unavailable(target)).toBe(true);
  });

  it('drops the spec theme: the bar keeps the site owner\'s styling', () => {
    const r = parseSpecCard(JSON.stringify({ ui: node('text'), theme: { colors: { primary: 'red' } } }));
    expect(r.kind === 'spec' && 'theme' in r.spec).toBe(false);
  });
});

describe('bounds on an agent-written spec', () => {
  it(`refuses more than ${MAX_SPEC_NODES} nodes`, () => {
    const kids = Array.from({ length: MAX_SPEC_NODES }, () => node('text', { text: 'x' }));
    expect(parseSpecCard(JSON.stringify({ ui: node('flex', {}, { children: kids }) })).kind).toBe('invalid');
    expect(unavailable(render({ ui: node('flex', {}, { children: kids }) }).target)).toBe(true);
  });

  it(`refuses nesting deeper than ${MAX_SPEC_DEPTH}`, () => {
    let ui: Record<string, unknown> = node('text', { text: 'deep' });
    for (let i = 0; i < MAX_SPEC_DEPTH; i++) ui = node('flex', {}, { children: [ui] });
    expect(parseSpecCard(JSON.stringify({ ui })).kind).toBe('invalid');
  });

  it(`refuses a fence longer than ${MAX_SPEC_CHARS} characters`, () => {
    const big = JSON.stringify({ ui: node('text', { text: 'x'.repeat(MAX_SPEC_CHARS) }) });
    expect(parseSpecCard(big).kind).toBe('invalid');
  });

  it('refuses a malformed tree or state', () => {
    expect(parseSpecCard('{"ui":"text"}').kind).toBe('invalid');
    expect(parseSpecCard('{"ui":{"props":{}}}').kind).toBe('invalid');
    expect(parseSpecCard('{"ui":{"type":"flex","children":{}}}').kind).toBe('invalid');
    expect(parseSpecCard('{"ui":{"type":"text"},"state":[1]}').kind).toBe('invalid');
  });

  it('accepts a spec at exactly the bounds', () => {
    let ui: Record<string, unknown> = node('text', { text: 'x' });
    for (let i = 1; i < MAX_SPEC_DEPTH; i++) ui = node('flex', {}, { children: [ui] });
    expect(parseSpecCard(JSON.stringify({ ui })).kind).toBe('spec');
  });

  it('draws nothing for a type outside the manifest, and keeps the rest', () => {
    const { target } = render({ ui: node('flex', {}, { children: [node('image', { src: 'https://evil.example/p.png' }), node('text', { text: 'kept' })] }) });
    expect(target.querySelector('img')).toBeNull();
    expect(target.querySelector('[data-spec-unavailable="image"]')).not.toBeNull();
    expect(target.textContent).toContain('kept');
  });
});

describe('widgets', () => {
  it('text: coerces numbers, ignores objects', () => {
    const { target } = render({ ui: node('flex', {}, { children: [node('text', { text: 42 }), node('text', { text: { a: 1 } }), node('text', { text: 'm' })] }) });
    const ps = [...target.querySelectorAll('p.spec-text')];
    expect(ps.map((p) => p.textContent)).toEqual(['42', '', 'm']);
  });

  it('heading: level 2-4, default 3', () => {
    const { target } = render({ ui: node('flex', {}, { children: [node('heading', { text: 'a', level: 2 }), node('heading', { text: 'b', level: 9 })] }) });
    expect(target.querySelector('h2')?.textContent).toBe('a');
    expect(target.querySelector('h3')?.textContent).toBe('b');
  });

  it('badge: known variants only', () => {
    const { target } = render({ ui: node('flex', {}, { children: [node('badge', { text: 'In stock', variant: 'success' }), node('badge', { text: 'x', variant: 'neon' })] }) });
    const b = [...target.querySelectorAll('.spec-badge')];
    expect(b[0].classList.contains('success')).toBe(true);
    expect(b[1].classList.contains('default')).toBe(true);
  });

  it('flex: row, numeric gap clamped to 0-24px', () => {
    const { target } = render({ ui: node('flex', { direction: 'row', gap: 4, wrap: true }, { children: [node('text', { text: 'a' })] }) });
    const s = target.querySelector('.spec-flex') as HTMLElement;
    expect(s.classList.contains('row')).toBe(true);
    expect(s.style.gap).toBe('4px');
    expect(s.classList.contains('wrap')).toBe(true);
    unmount(live!);
    live = null;
    const big = render({ ui: node('flex', { gap: 500 }, { children: [node('text', { text: 'a' })] }) });
    expect((big.target.querySelector('.spec-flex') as HTMLElement).style.gap).toBe('24px');
  });

  it('button: local state actions run inside the spec', async () => {
    const { target } = render({
      state: { open: false },
      ui: node('flex', {}, {
        children: [
          node('button', { label: 'More' }, { on_click: { action: 'toggle', target: 'open' } }),
          node('if', {}, { condition: '{state.open}', children: [node('text', { text: 'Details' })] }),
        ],
      }),
    });
    expect(target.textContent).not.toContain('Details');
    (target.querySelector('button.spec-button') as HTMLButtonElement).click();
    await tick();
    expect(target.textContent).toContain('Details');
  });

  it('product-card: draws the catalog from server-filled items', () => {
    const { target } = render({ ui: node('product-card', { items: [{ id: 'w', name: 'Winter Wetsuit', price_cents: 32900, currency: 'EUR', actions: ['add_to_cart'] }] }) });
    expect(target.textContent).toContain('Winter Wetsuit');
    expect(unavailable(target)).toBe(false);
  });

  it('product-card: ids alone (not yet filled in by the server) are unavailable, not guessed', () => {
    const { target } = render({ ui: node('product-card', { ids: ['w'] }) });
    expect(unavailable(target)).toBe(true);
  });

  it('product-card: item fields are validated as a legacy card\'s are', () => {
    const { target } = render({ ui: node('product-card', { items: [{ id: 'w', name: 'Suit', image_url: 'javascript:alert(1)', actions: ['add_to_cart'] }] }) });
    for (const img of target.querySelectorAll('img')) expect(img.getAttribute('src') ?? '').not.toContain('javascript:');
  });

  it('form: draws the form card; an invalid form is unavailable', () => {
    const ok = render({ ui: node('form', { verb: 'book_visit', title: 'Book', fields: [{ name: 'phone', label: 'Phone', type: 'tel' }] }) });
    expect(ok.target.querySelector('input[type="tel"]')).not.toBeNull();
    unmount(live!);
    live = null;
    const bad = render({ ui: node('form', { verb: 'book_visit', fields: [{ name: 'a', label: 'A', type: 'password' }] }) });
    expect(unavailable(bad.target)).toBe(true);
  });
});

describe('what a spec can make the bar do', () => {
  const click = (t: HTMLElement) => (t.querySelector('button.spec-button') as HTMLButtonElement).click();

  it('emit add_to_cart adds the product, qty defaulting to 1', () => {
    const cart = newCart();
    const add = vi.spyOn(cart, 'addToCart').mockResolvedValue(true);
    const { target } = render({ ui: node('button', { label: 'Add' }, { on_click: { action: 'emit', target: 'add_to_cart', value: { product_id: 'w43' } } }) }, cart);
    click(target);
    expect(add).toHaveBeenCalledWith('w43', 1);
  });

  it('emit add_to_cart passes a numeric qty and ignores a missing id', () => {
    const cart = newCart();
    const add = vi.spyOn(cart, 'addToCart').mockResolvedValue(true);
    const { target } = render({
      ui: node('flex', {}, {
        children: [
          node('button', { label: 'Two' }, { on_click: { action: 'emit', target: 'add_to_cart', value: { product_id: 'w', qty: 2 } } }),
          node('button', { label: 'None' }, { on_click: { action: 'emit', target: 'add_to_cart', value: { qty: 2 } } }),
        ],
      }),
    }, cart);
    const [two, none] = [...target.querySelectorAll('button.spec-button')] as HTMLButtonElement[];
    two.click();
    none.click();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('w', 2);
  });

  it('emit checkout opens the checkout', () => {
    const cart = newCart();
    const open = vi.spyOn(cart, 'openCheckout').mockReturnValue(true);
    const { target } = render({ ui: node('button', { label: 'Pay' }, { on_click: { action: 'emit', target: 'checkout' } }) }, cart);
    click(target);
    expect(open).toHaveBeenCalledTimes(1);
  });

  for (const handler of [
    { action: 'navigate', url: 'https://evil.example' },
    { action: 'toast', message: 'hi' },
    { action: 'emit', target: 'delete_account' },
    { action: 'api', url: 'https://evil.example/x' },
  ]) {
    it(`does nothing for ${handler.action}${'target' in handler ? ` ${handler.target}` : ''}`, () => {
      const cart = newCart();
      const add = vi.spyOn(cart, 'addToCart').mockResolvedValue(true);
      const open = vi.spyOn(cart, 'openCheckout').mockReturnValue(true);
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const href = location.href;
      const { target } = render({ ui: node('button', { label: 'x' }, { on_click: handler }) }, cart);
      click(target);
      expect(add).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(location.href).toBe(href);
    });
  }
});

describe('the manifest', () => {
  it('lists exactly the registered widgets', () => {
    expect(PAWBAR_WIDGETS.map((w) => w.type).sort()).toEqual(Object.keys(SPEC_WIDGETS).sort());
  });

  it('offers only the actions the bar honours, and no image widget', () => {
    const m = buildPawBarManifest();
    expect(Object.keys(m.actions)).toEqual([...PAWBAR_ACTIONS]);
    expect(m.widgets.some((w) => /image|img|video|embed|iframe/i.test(w.type))).toBe(false);
  });

  it('every widget example renders without falling back', () => {
    for (const w of PAWBAR_WIDGETS) {
      if (w.type === 'product-card') continue; // needs server-filled items; covered above
      const { target } = render({ ui: w.example });
      expect(target.querySelector('[data-spec-unavailable]'), w.type).toBeNull();
      expect(unavailable(target), w.type).toBe(false);
      unmount(live!);
      live = null;
      document.body.innerHTML = '';
    }
  });

  it('the committed pawbar-manifest.json is current (run `bun run manifest`)', () => {
    const committed = JSON.parse(committedManifest);
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildPawBarManifest())));
  });
});
