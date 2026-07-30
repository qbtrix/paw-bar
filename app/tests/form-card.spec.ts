// tests/form-card.spec.ts — FormCardStore submit flow (headless, mocked fetch).
// Created 2026-07-30 (form cards). Drives the store against a REAL CartStore so
// the wire body is the frozen C1 action contract: submit posts the card's verb
// + typed args (number fields as real numbers) to /paw-bar/action; an ok or
// pending outcome swaps to phase 'sent' and fires the onSent nudge (contact
// prompt); a 4xx keeps the form editable with values intact + an inline error;
// the v1 all-required check blocks the network entirely; values cap at 256.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CartStore } from '../src/store/cart.svelte';
import { FormCardStore, FORM_VALUE_MAX } from '../src/store/form-card.svelte';
import type { PawBarCard } from '../src/lib/cards';

const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };

const FORM: PawBarCard = {
  kind: 'form',
  items: [],
  verb: 'book_table',
  title: 'Book a table',
  submit_label: 'Send request',
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'party_size', label: 'Party size', type: 'number' },
  ],
};

afterEach(() => vi.unstubAllGlobals());

function jsonRes(payload: unknown, ok = true, status?: number) {
  return { ok, status: status ?? (ok ? 200 : 500), json: async () => payload };
}

function filledForm(cart: CartStore, onSent?: () => void): FormCardStore {
  const form = new FormCardStore(FORM, cart, onSent);
  form.setValue('name', 'Ada');
  form.setValue('phone', '+31 6 1234');
  form.setValue('party_size', '4');
  return form;
}

describe('FormCardStore.submit', () => {
  it('POSTs the verb + typed args (numbers as numbers) to /paw-bar/action', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonRes({ ok: true, result: { status: 'pending' } }));
    vi.stubGlobal('fetch', fetchMock);
    const form = filledForm(new CartStore(config));

    await form.submit();

    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://test.local/api/v1/paw-bar/action');
    const body = JSON.parse(opts.body);
    expect(body.verb).toBe('book_table');
    expect(body.args).toEqual({ name: 'Ada', phone: '+31 6 1234', party_size: 4 });
  });

  it('a pending/ok outcome swaps to "sent" and fires the onSent nudge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonRes({ ok: true, result: { status: 'pending' } })),
    );
    const onSent = vi.fn();
    const form = filledForm(new CartStore(config), onSent);

    await form.submit();

    expect(form.phase).toBe('sent');
    expect(form.error).toBeNull();
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it('a 4xx keeps the form editable with values intact + an inline error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({}, false, 422)));
    const onSent = vi.fn();
    const form = filledForm(new CartStore(config), onSent);

    await form.submit();

    expect(form.phase).toBe('idle');
    expect(form.error).toBeTruthy();
    expect(onSent).not.toHaveBeenCalled();
    expect(form.values.name).toBe('Ada'); // entered values survive the failure
    expect(form.values.party_size).toBe('4');
  });

  it('blocks submit (no network) while any field is empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormCardStore(FORM, new CartStore(config));
    form.setValue('name', 'Ada'); // phone + party_size still empty

    await form.submit();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(form.phase).toBe('idle');
    expect(form.error).toBeTruthy();
    expect(form.missing).toEqual(['phone', 'party_size']);
  });

  it('treats a non-numeric value in a number field as missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const form = filledForm(new CartStore(config));
    form.setValue('party_size', 'four');

    await form.submit();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(form.missing).toEqual(['party_size']);
  });

  it(`caps entered values at ${FORM_VALUE_MAX} chars`, () => {
    const form = new FormCardStore(FORM, new CartStore(config));
    form.setValue('name', 'x'.repeat(FORM_VALUE_MAX + 50));
    expect(form.values.name).toHaveLength(FORM_VALUE_MAX);
  });

  it('re-submitting while in flight or after "sent" is a no-op', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonRes({ ok: true, result: { status: 'pending' } }));
    vi.stubGlobal('fetch', fetchMock);
    const form = filledForm(new CartStore(config));

    await form.submit();
    await form.submit(); // phase is 'sent' — must not re-post

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
