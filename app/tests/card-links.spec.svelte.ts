// tests/card-links.spec.svelte.ts — product cards link to the item's page and
// price in true minor units, in both renderers: BarCatalog (inside the bar's
// thread) and ProductCard (outside it). A site path resolves against the host
// page origin; links open a new tab because the frame is sandboxed without top
// navigation, so a link must never load inside the widget frame.
import { describe, it, expect, afterAll, afterEach, beforeAll } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import CardHarness from './fixtures/spec/CardHarness.svelte';
import { CartStore } from '../src/store/cart.svelte';
import { setLinkBase } from '../src/lib/markdown';

// formatMinor uses the visitor's locale; pin en-US here so the digit and
// separator assertions hold on any machine.
const RealNumberFormat = Intl.NumberFormat;
beforeAll(() => {
  Intl.NumberFormat = class extends RealNumberFormat {
    constructor(locales?: string | string[], options?: Intl.NumberFormatOptions) {
      super(locales ?? 'en-US', options);
    }
  } as typeof Intl.NumberFormat;
});
afterAll(() => {
  Intl.NumberFormat = RealNumberFormat;
});

let live: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  setLinkBase(null);
});

function render(items: Record<string, unknown>[], thread: boolean) {
  const target = document.createElement('div');
  document.body.append(target);
  const cart = new CartStore({ endpoint: 'https://api.example', widgetId: 'w1', siteKey: 'k' });
  live = mount(CardHarness, { target, props: { json: JSON.stringify({ kind: 'product', items }), cart, thread } });
  flushSync();
  return target;
}

const item = (extra: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Kimono',
  price_cents: 1500,
  currency: 'JPY',
  image_url: 'https://cdn.example/k.png',
  actions: ['add_to_cart'],
  ...extra,
});

describe.each([
  ['BarCatalog', true],
  ['ProductCard', false],
])('%s', (_name, thread) => {
  it('links the name and image to a site path on the host page origin, in a new tab', () => {
    setLinkBase('https://shop.example');
    const t = render([item({ url: '/products/kimono' })], thread);
    const name = t.querySelector<HTMLAnchorElement>('a.name')!;
    expect(name.textContent).toBe('Kimono');
    expect(name.getAttribute('href')).toBe('https://shop.example/products/kimono');
    expect(name.getAttribute('target')).toBe('_blank');
    expect(name.getAttribute('rel')).toBe('noopener noreferrer');
    const imgLink = t.querySelector('img')!.closest('a')!;
    expect(imgLink.getAttribute('href')).toBe('https://shop.example/products/kimono');
    expect(imgLink.getAttribute('target')).toBe('_blank');
    expect(imgLink.getAttribute('tabindex')).toBe('-1');
    expect(imgLink.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps an absolute http(s) url as is', () => {
    const t = render([item({ url: 'https://other.example/p/1' })], thread);
    expect(t.querySelector('a.name')!.getAttribute('href')).toBe('https://other.example/p/1');
  });

  it.each([
    'javascript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,x',
    '//evil.example/x',
    '/\\evil.example',
    'products/x',
  ])('draws no link for %s even with the host origin set', (url) => {
    setLinkBase('https://shop.example');
    const t = render([item({ url })], thread);
    expect(t.querySelector('a')).toBeNull();
    expect(t.querySelector('.name')!.textContent).toBe('Kimono');
  });

  it.each(['javascript:alert(1)', '//evil.example/x', '/\\evil.example', 'products/x', '/products/x'])(
    'draws no link for %s with no host origin set',
    (url) => {
      const t = render([item({ url })], thread);
      expect(t.querySelector('a')).toBeNull();
      expect(t.querySelector('.name')!.textContent).toBe('Kimono');
    },
  );

  it('prices zero- and three-decimal currencies in true minor units', () => {
    const t = render([item(), item({ id: 'p2', name: 'Dates', price_cents: 1250, currency: 'KWD' })], thread);
    const prices = [...t.querySelectorAll('.price')].map((p) => p.textContent ?? '');
    expect(prices).toHaveLength(2);
    expect(prices[0]).toContain('1,500');
    expect(prices[0]).not.toContain('.');
    expect(prices[1]).toContain('1.250');
  });
});
