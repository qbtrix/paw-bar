// tests/cart.spec.ts — Action transport + cart store flow. Created 2026-07-15
// (C2 action loop); 2026-07-16: + load() one-shot + openCheckout window.open.
// Mocks global fetch and pins the frozen C1 body shape (POST /paw-bar/action
// {key,w,customer_ref,verb,args}; GET /paw-bar/cart query), then drives the
// store: addToCart adopts the returned cart + derives count, a !ok response
// surfaces an error, load() hydrates exactly once (first panel open), and
// openCheckout opens the http(s)-guarded checkout URL in a new tab (skipping an
// unsafe/absent URL). Runs under jsdom so getCustomerRef's
// window.crypto/localStorage + window.open exist.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { postAction, getCart } from '../src/lib/action-client';
import { CartStore } from '../src/store/cart.svelte';

const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };
const actionConfig = { ...config, signedKey: 'k1', customerRef: 'cref-abc' };

const CART = {
  items: [{ product_id: 'espresso', name: 'Espresso', qty: 2, price_cents: 350, line_total_cents: 700 }],
  total_cents: 700,
  currency: 'USD',
  checkout_url: 'https://site.test/checkout?cart=abc',
};

afterEach(() => vi.unstubAllGlobals());

function jsonRes(payload: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => payload };
}

describe('postAction', () => {
  it('POSTs the frozen {key,w,customer_ref,verb,args} body to /paw-bar/action', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ ok: true, cart: CART }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await postAction(actionConfig, 'add_to_cart', { product_id: 'espresso', qty: 2 });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://test.local/api/v1/paw-bar/action');
    expect(opts.method).toBe('POST');
    expect(opts.credentials).toBe('omit');
    expect(opts.mode).toBe('cors');
    expect(JSON.parse(opts.body)).toEqual({
      key: 'k1',
      w: 'w1',
      customer_ref: 'cref-abc',
      verb: 'add_to_cart',
      args: { product_id: 'espresso', qty: 2 },
    });
    expect(res.ok).toBe(true);
    expect(res.cart?.total_cents).toBe(700);
  });

  it('returns an error result on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({}, false)));
    const res = await postAction(actionConfig, 'add_to_cart', {});
    expect(res.ok).toBe(false);
    expect(res.error).toContain('500');
  });
});

describe('getCart', () => {
  it('GETs with key/w/customer_ref query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(CART));
    vi.stubGlobal('fetch', fetchMock);

    const cart = await getCart(actionConfig);

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v1/paw-bar/cart');
    expect(url.searchParams.get('key')).toBe('k1');
    expect(url.searchParams.get('w')).toBe('w1');
    expect(url.searchParams.get('customer_ref')).toBe('cref-abc');
    expect(cart?.total_cents).toBe(700);
  });

  // The regression this pins: `as Cart` is a compile-time claim, not a runtime
  // one. A 200 carrying anything else used to become a Cart with no `items`,
  // and the first read of cart.count threw inside the shell's render — taking
  // the whole widget down on a customer's site because a response was shaped
  // wrong. Anything that is not a cart is now "no cart".
  it.each([
    ['an empty object', {}],
    ['a proxy error envelope', { error: 'upstream unavailable' }],
    ['items of the wrong type', { items: 'two things' }],
    ['a bare array', []],
    ['null', null],
  ])('treats %s as no cart rather than a broken one', async (_label, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes(body)));

    expect(await getCart(actionConfig)).toBeNull();
  });

  it('leaves the count at zero when the cart never parsed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({})));
    const store = new CartStore(config);

    await store.load();

    // Reading count is what crashed. It is read on every render of the docked
    // bar, which now sits beside the open panel.
    expect(store.count).toBe(0);
  });
});

describe('CartStore', () => {
  it('adopts the returned cart and derives count + checkoutUrl', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ ok: true, cart: CART })));
    const store = new CartStore(config);
    expect(store.count).toBe(0);

    const ok = await store.addToCart('espresso', 2);

    expect(ok).toBe(true);
    expect(store.cart?.total_cents).toBe(700);
    expect(store.count).toBe(2); // sums line quantities
    expect(store.checkoutUrl).toBe('https://site.test/checkout?cart=abc');
    expect(store.error).toBeNull();
    expect(store.pending).toBeNull();
  });

  it('surfaces an error and keeps the cart empty on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({}, false)));
    const store = new CartStore(config);

    const ok = await store.addToCart('espresso');

    expect(ok).toBe(false);
    expect(store.error).toBeTruthy();
    expect(store.cart).toBeNull();
    expect(store.count).toBe(0);
  });

  it('rejects a non-http checkout url via the guard', async () => {
    const evil = { ...CART, checkout_url: 'javascript:alert(1)' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ ok: true, cart: evil })));
    const store = new CartStore(config);
    await store.addToCart('espresso');
    expect(store.checkoutUrl).toBeNull();
  });

  it('load() hydrates once and no-ops on re-open (one-shot)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(CART));
    vi.stubGlobal('fetch', fetchMock);
    const store = new CartStore(config);

    await store.load();
    await store.load(); // second panel open must not re-GET

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.count).toBe(2);
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe('/api/v1/paw-bar/cart');
  });

  it('openCheckout opens the guarded URL in a new tab + logs the intent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ ok: true, cart: CART })));
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const store = new CartStore(config);
    await store.addToCart('espresso'); // populates checkout_url

    const opened = store.openCheckout();

    expect(opened).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('https://site.test/checkout?cart=abc', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('openCheckout does not open a tab when the checkout URL is unsafe/absent', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ ok: true, cart: CART })));
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const store = new CartStore(config); // no cart yet → checkoutUrl is null

    const opened = store.openCheckout();

    expect(opened).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});
