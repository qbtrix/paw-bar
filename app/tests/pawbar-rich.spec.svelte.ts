// tests/pawbar-rich.spec.svelte.ts — section E of the new bar (2026-09-27;
// spec docs/design/drafts/2026-09-27-paw-bar-states-ux-bar-and-flows.md).
// Replies render as sanitized markdown, owner and system turns stay text; a
// reply's links open a new tab with noopener. E2: a form card renders inside
// the thread and submits through the cart store; with no store in context a
// card reads "Card unavailable" instead of taking the row down. E1: the
// contact prompt is the thread's tail (offer, invalid, sent) and a reply that
// settles as done asks for one offer. Catalogs: 2+ products are a strip, more
// than six collapse behind "Show all N", a broken image becomes an initial,
// and a CTA's pending/added/error state stays on its own tile. Nothing inside
// the thread is a second live region.

import { describe, it, expect, afterEach, vi } from 'vitest';

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
import PawBarFrame, { type BarMessage } from '../src/components/bar/PawBarFrame.svelte';

let live: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

const say = (id: string, role: BarMessage['role'], content: string, status: BarMessage['status'] = 'done'): BarMessage => ({
  id,
  role,
  content,
  status,
});

const fence = (card: unknown) => '```pawbar-card\n' + JSON.stringify(card) + '\n```';

const FORM = {
  kind: 'form',
  verb: 'book_visit',
  title: 'Book a visit',
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'email', label: 'Email', type: 'email' },
  ],
};

const product = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `p${i}`,
  name: `Product ${i}`,
  price_cents: 1000 + i,
  currency: 'USD',
  actions: ['add_to_cart'],
  ...extra,
});

/** A cart the cards can act through, with every call observable. */
function fakeCart() {
  const cart = $state({
    pending: null as string | null,
    error: null as string | null,
    count: 0,
    checkoutUrl: null as string | null,
    runAction: vi.fn(async () => true),
    addToCart: vi.fn(async (_id: string) => true),
    openCheckout: vi.fn(() => true),
  });
  return cart;
}

function fakeContact(status: 'hidden' | 'offer' | 'sent' = 'hidden') {
  const contact = $state({
    status,
    emailError: false,
    isSubmitting: false,
    maybeOffer: vi.fn(async () => {}),
    submit: vi.fn(async () => {}),
    dismiss: vi.fn(),
  });
  return contact;
}

function frame(extra: Record<string, unknown> = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const props = $state({
    messages: [] as BarMessage[],
    expanded: true,
    onsend: vi.fn(),
    ...extra,
  });
  live = mount(PawBarFrame, { target, props });
  flushSync();
  return { target, props };
}

const reply = (t: HTMLElement) => t.querySelector('.msg.assistant')!;

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** The thread's one live region must not contain another. */
function nestedLive(t: HTMLElement) {
  return t.querySelectorAll('.thread [role="status"], .thread [role="alert"], .thread [aria-live]');
}

describe('rich replies', () => {
  it('renders markdown in replies, text in owner, visitor and system turns', () => {
    const { target } = frame({
      messages: [
        say('u1', 'user', 'is **this** bold?'),
        say('a1', 'assistant', 'Here is **bold**, `code` and\n\n- one\n- two'),
        say('s1', 'system', 'A **member** joined'),
        say('o1', 'owner', 'Hi, **x** here'),
      ],
    });
    const r = reply(target);
    expect(r.querySelector('strong')?.textContent).toBe('bold');
    expect(r.querySelector('code')?.textContent).toBe('code');
    expect(r.querySelectorAll('li')).toHaveLength(2);
    expect(r.querySelector('.sr-only')?.textContent).toBe('Assistant:');

    const owner = target.querySelector('.msg.owner')!;
    expect(owner.textContent).toBe('Hi, **x** here');
    expect(owner.querySelector('strong')).toBeNull();
    expect(target.querySelector('.chip-note')!.textContent).toBe('A **member** joined');
    expect(target.querySelector('.msg.user strong')).toBeNull();
  });

  it('opens reply links in a new tab with noopener', () => {
    const { target } = frame({ messages: [say('a1', 'assistant', 'See [returns](https://example.com/returns).')] });
    const a = reply(target).querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/returns');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('keeps an empty streaming reply as the thinking row, not an empty block', () => {
    const { target } = frame({ messages: [say('a1', 'assistant', '', 'streaming')] });
    expect(target.querySelector('.msg.assistant')).toBeNull();
    expect(target.querySelector('.thinking')).not.toBeNull();
  });
});

describe('E2 form card', () => {
  it('renders in the thread and submits through the cart store', async () => {
    const cart = fakeCart();
    const contact = fakeContact();
    const { target } = frame({ cart, contact, messages: [say('a1', 'assistant', `Fill this in:\n\n${fence(FORM)}`)] });

    const form = target.querySelector<HTMLFormElement>('.form-card')!;
    expect(form).not.toBeNull();
    const [name, email] = form.querySelectorAll('input');
    type(name, 'Ada');
    type(email, 'ada@example.com');
    form.dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
    await tick();
    await tick();
    flushSync();

    expect(cart.runAction).toHaveBeenCalledWith('book_visit', { name: 'Ada', email: 'ada@example.com' }, 'form:book_visit');
    expect(target.querySelector('.sent')?.textContent).toBe("✓ Sent. We'll take it from here.");
    expect(contact.maybeOffer).toHaveBeenCalled();
    expect(nestedLive(target)).toHaveLength(0);
  });

  it('keeps values and says what is missing without a second live region', async () => {
    const cart = fakeCart();
    const { target } = frame({ cart, messages: [say('a1', 'assistant', fence(FORM))] });
    const form = target.querySelector<HTMLFormElement>('.form-card')!;
    const [name, email] = form.querySelectorAll('input');
    type(name, 'Ada');
    form.dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
    await tick();
    flushSync();

    expect(cart.runAction).not.toHaveBeenCalled();
    expect(form.querySelector('.error')?.textContent).toBe('Please fill in every field.');
    expect(name.value).toBe('Ada');
    expect(document.activeElement).toBe(email);
    expect(nestedLive(target)).toHaveLength(0);
  });

  it('degrades to "Card unavailable" with no cart store', () => {
    const { target } = frame({ messages: [say('a1', 'assistant', `Pick one:\n\n${fence(FORM)}\n\n${fence({ items: [product(1)] })}`)] });
    const fallbacks = target.querySelectorAll('.card-fallback');
    expect(fallbacks).toHaveLength(2);
    expect(fallbacks[0].textContent).toBe('Card unavailable');
    expect(target.querySelector('.unrenderable')).toBeNull();
    expect(nestedLive(target)).toHaveLength(0);
  });
});

describe('E1 contact prompt', () => {
  it('offers at the tail of the thread and submits the email', () => {
    const contact = fakeContact('offer');
    const { target } = frame({ contact, messages: [say('a1', 'assistant', 'Booked, pending review.')] });
    const inner = target.querySelector('.thread-inner')!;
    expect(inner.lastElementChild?.classList.contains('contact')).toBe(true);
    expect(target.querySelector('.contact-copy')?.textContent).toBe('Leaving? We can email you when the team confirms.');

    const input = target.querySelector<HTMLInputElement>('.contact-input')!;
    type(input, 'ada@example.com');
    target.querySelector('.contact-form')!.dispatchEvent(new SubmitEvent('submit', { cancelable: true }));
    expect(contact.submit).toHaveBeenCalledWith('ada@example.com');

    target.querySelector<HTMLButtonElement>('.contact-dismiss')!.click();
    expect(contact.dismiss).toHaveBeenCalled();
  });

  it('marks an invalid email on the input, with no role', () => {
    const contact = fakeContact('offer');
    const { target } = frame({ contact, messages: [say('a1', 'assistant', 'Done.')] });
    contact.emailError = true;
    flushSync();
    const input = target.querySelector<HTMLInputElement>('.contact-input')!;
    const err = target.querySelector('.contact-err')!;
    expect(err.textContent).toBe("That email doesn't look right.");
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(err.id);
    expect(nestedLive(target)).toHaveLength(0);
  });

  it('confirms once sent', () => {
    const contact = fakeContact('sent');
    const { target } = frame({ contact, messages: [say('a1', 'assistant', 'Done.')] });
    expect(target.querySelector('.contact')).toBeNull();
    expect(target.querySelector('.contact-sent')?.textContent).toBe("Got it — we'll email you when the team confirms.");
  });

  it('asks for an offer when a reply settles as done, not when it fails', () => {
    const contact = fakeContact();
    const { props } = frame({ contact, messages: [say('u1', 'user', 'Book me'), say('a1', 'assistant', 'Sure', 'streaming')] });
    expect(contact.maybeOffer).not.toHaveBeenCalled();
    props.messages[1].status = 'done';
    flushSync();
    expect(contact.maybeOffer).toHaveBeenCalledTimes(1);

    props.messages.push(say('a2', 'assistant', 'Hm', 'streaming'));
    flushSync();
    props.messages[2].status = 'error';
    flushSync();
    expect(contact.maybeOffer).toHaveBeenCalledTimes(1);
  });
});

describe('catalogs', () => {
  const catalog = (n: number, extra: (i: number) => Record<string, unknown> = () => ({})) =>
    fence({ kind: 'product', items: Array.from({ length: n }, (_, i) => product(i, extra(i))) });

  it('draws one product as a row and several as a named strip', () => {
    const cart = fakeCart();
    const { target, props } = frame({ cart, messages: [say('a1', 'assistant', catalog(1))] });
    expect(target.querySelector('.one')).not.toBeNull();
    expect(target.querySelector('[role="list"]')).toBeNull();

    props.messages = [say('a2', 'assistant', catalog(4))];
    flushSync();
    const list = target.querySelector('ul[role="list"]')!;
    expect(list.getAttribute('aria-label')).toBe('Products');
    expect(list.querySelectorAll('li.tile')).toHaveLength(4);
    expect(target.querySelector('.catalog.grid')).toBeNull();
    expect(target.querySelector('.more-btn')).toBeNull();
    expect(target.querySelector('[aria-label="Previous products"]')).not.toBeNull();
    expect(nestedLive(target)).toHaveLength(0);
  });

  it('shows six of many behind "Show all N", which expands to the grid', async () => {
    const cart = fakeCart();
    const { target } = frame({ cart, messages: [say('a1', 'assistant', catalog(12))] });
    const tiles = () => [...target.querySelectorAll('li.tile:not(.more)')];
    expect(tiles()).toHaveLength(12);
    expect(tiles().filter((t) => t.classList.contains('extra'))).toHaveLength(6);

    const more = target.querySelector<HTMLButtonElement>('.more-btn')!;
    expect(more.textContent).toBe('Show all 12');
    more.click();
    await tick();
    flushSync();
    expect(target.querySelector('.catalog.grid')).not.toBeNull();
    expect(target.querySelector('.more-btn')).toBeNull();
    expect(target.querySelector('[aria-label="Next products"]')).toBeNull();
    // Focus lands on the first tile that just appeared.
    expect(document.activeElement).toBe(tiles()[6].querySelector('button'));
  });

  it('replaces a broken or missing image with the initial, and omits a missing price', () => {
    const cart = fakeCart();
    const { target } = frame({
      cart,
      messages: [
        say(
          'a1',
          'assistant',
          catalog(3, (i) =>
            i === 0 ? { image_url: 'https://cdn.example/broken.png' } : i === 1 ? { price_cents: undefined } : {},
          ),
        ),
      ],
    });
    const tiles = target.querySelectorAll('li.tile');
    const img = tiles[0].querySelector('img')!;
    expect(img).not.toBeNull();
    img.dispatchEvent(new Event('error'));
    flushSync();
    expect(tiles[0].querySelector('img')).toBeNull();
    expect(tiles[0].querySelector('.initial')?.textContent).toBe('P');
    expect(tiles[2].querySelector('.initial')).not.toBeNull();
    expect(tiles[1].querySelector('.price')).toBeNull();
    expect(tiles[2].querySelector('.price')).not.toBeNull();
  });

  it('keeps pending, added and error on the one tile that was pressed', async () => {
    const cart = fakeCart();
    let settle: (ok: boolean) => void = () => {};
    cart.addToCart.mockImplementation(
      (id: string) =>
        new Promise<boolean>((done) => {
          cart.pending = `add_to_cart:${id}`;
          settle = (ok) => {
            cart.pending = null;
            if (!ok) cart.error = 'Out of stock';
            done(ok);
          };
        }),
    );
    const { target } = frame({ cart, messages: [say('a1', 'assistant', catalog(3))] });
    const btn = (i: number) => target.querySelectorAll('li.tile')[i].querySelector<HTMLButtonElement>('.cta')!;

    btn(1).click();
    flushSync();
    expect(cart.addToCart).toHaveBeenCalledWith('p1');
    expect(btn(1).getAttribute('aria-busy')).toBe('true');
    expect(btn(1).querySelector('.spin')).not.toBeNull();
    expect(btn(0).getAttribute('aria-busy')).toBeNull();
    expect(btn(2).querySelector('.spin')).toBeNull();

    settle(true);
    await tick();
    flushSync();
    expect(btn(1).textContent?.trim()).toBe('Added ✓');
    expect(btn(0).textContent?.trim()).toBe('Add to cart');

    btn(2).click();
    flushSync();
    settle(false);
    await tick();
    flushSync();
    const errs = target.querySelectorAll('.err');
    expect(errs).toHaveLength(1);
    expect(errs[0].closest('li')).toBe(target.querySelectorAll('li.tile')[2]);
    expect(errs[0].textContent).toBe('Out of stock');
  });

  it('shows a cart row with a new-tab checkout once the cart holds something', () => {
    const cart = fakeCart();
    const { target } = frame({ cart, messages: [say('a1', 'assistant', catalog(2))] });
    expect(target.querySelector('.cart-row')).toBeNull();
    cart.count = 2;
    cart.checkoutUrl = 'https://shop.example/checkout';
    flushSync();
    const row = target.querySelector('.cart-row')!;
    expect(row.textContent).toContain('Cart · 2');
    const checkout = row.querySelector<HTMLButtonElement>('button')!;
    expect(checkout.getAttribute('aria-label')).toBe('Checkout, opens in a new tab');
    checkout.click();
    expect(cart.openCheckout).toHaveBeenCalled();
  });
});
