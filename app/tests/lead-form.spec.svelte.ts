// tests/lead-form.spec.svelte.ts — form prefill and the `send_to_team` lead form.
//
// Prefill: a field's `value` is parsed as plain text (clipped, control
// characters dropped, never HTML) and seeds the input, which stays editable.
// Lead form: email/tel format and the email-or-phone rule run before any
// request; a success shows the server's message and locks the form read-only
// with no decision poll; 429 / 422-with-field / anything else each get their
// own message, and a failure never loses what the visitor typed. Drives the
// store against a real CartStore with a mocked fetch, and the component
// through the same harness the thread uses.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import CardHarness from './fixtures/spec/CardHarness.svelte';
import { CartStore } from '../src/store/cart.svelte';
import { FormCardStore, LEAD_SENT_FALLBACK, LEAD_NEEDS_CONTACT } from '../src/store/form-card.svelte';
import { parseCard, FORM_PREFILL_MAX, type PawBarCard } from '../src/lib/cards';
import { WAIT_MESSAGE, RETRY_MESSAGE } from '../src/lib/visitor-input';

const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };

let live: ReturnType<typeof mount> | null = null;
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function res(payload: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => payload };
}

const LEAD_FIELDS = [
  { name: 'name', label: 'Name', type: 'text', value: 'Priya' },
  { name: 'email', label: 'Email', type: 'email', value: 'priya@example.com' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'message', label: 'Message', type: 'textarea', value: '20 jackets for a team trip' },
];

function leadCard(fields: unknown[] = LEAD_FIELDS, extra: Record<string, unknown> = {}): PawBarCard {
  const card = parseCard(JSON.stringify({ kind: 'form', verb: 'send_to_team', fields, ...extra }));
  if (!card) throw new Error('lead card did not parse');
  return card;
}

function sentArgs(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(opts.body)).args;
}

describe('form prefill', () => {
  it('parses `value` as clipped plain text with control characters dropped', () => {
    const card = parseCard(
      JSON.stringify({
        kind: 'form',
        verb: 'book_visit',
        fields: [
          { name: 'a', label: 'A', type: 'text', value: '  Ada\u0000\u0007 Lovelace ' },
          { name: 'b', label: 'B', type: 'textarea', value: 'x'.repeat(900) },
          { name: 'c', label: 'C', type: 'text', value: { html: '<b>no</b>' } },
          { name: 'd', label: 'D', type: 'text', value: 42 },
        ],
      }),
    );
    const [a, b, c, d] = card!.fields!;
    expect(a.value).toBe('Ada Lovelace');
    expect(b.value).toHaveLength(FORM_PREFILL_MAX);
    expect(c.value).toBeUndefined();
    expect(d.value).toBeUndefined();
  });

  it('seeds the store; a gated form still caps at 256', () => {
    const card = parseCard(
      JSON.stringify({ kind: 'form', verb: 'book_visit', fields: [{ name: 'n', label: 'N', type: 'textarea', value: 'y'.repeat(400) }] }),
    )!;
    const form = new FormCardStore(card, new CartStore(config));
    expect(form.values.n).toHaveLength(256);
  });

  it('renders the prefill as the input value, editable, never as HTML', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    const json = JSON.stringify({
      kind: 'form',
      verb: 'book_visit',
      fields: [{ name: 'name', label: 'Name', type: 'text', value: '<img src=x onerror=alert(1)>' }],
    });
    live = mount(CardHarness, { target, props: { json, cart: new CartStore(config) } });
    flushSync();
    const input = target.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('<img src=x onerror=alert(1)>');
    expect(input.readOnly).toBe(false);
    expect(target.querySelector('img')).toBeNull();
    input.value = 'Ada';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(input.value).toBe('Ada');
  });
});

describe('send_to_team: parsing', () => {
  it('needs an email or phone field', () => {
    expect(parseCard(JSON.stringify({ kind: 'form', verb: 'send_to_team', fields: [{ name: 'name', label: 'Name', type: 'text' }] }))).toBeNull();
    expect(parseCard(JSON.stringify({ kind: 'form', verb: 'send_to_team', fields: [{ name: 'phone', label: 'Phone', type: 'tel' }] }))).not.toBeNull();
  });
});

describe('send_to_team: validation', () => {
  it('a malformed email is a field error and nothing is sent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormCardStore(leadCard(), new CartStore(config));
    form.setValue('email', 'priya@example');
    await form.submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(form.fieldErrors.email).toMatch(/valid email/);
    expect(form.phase).toBe('idle');
  });

  it('a phone with too few digits is a field error', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormCardStore(leadCard(), new CartStore(config));
    form.setValue('phone', '12-34');
    await form.submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(form.fieldErrors.phone).toMatch(/valid phone/);
  });

  it('needs at least one of email or phone', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormCardStore(leadCard(), new CartStore(config));
    form.setValue('email', '   ');
    await form.submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(form.error).toBe(LEAD_NEEDS_CONTACT);
  });

  it('a phone alone is enough; empty optional fields are left off the args', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ ok: true, result: {} }));
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormCardStore(leadCard(), new CartStore(config));
    form.setValue('email', '');
    form.setValue('message', '');
    form.setValue('phone', '+31 (6) 1234-5678 ext 9');
    await form.submit();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test.local/api/v1/paw-bar/action');
    expect(JSON.parse(String(opts.body)).verb).toBe('send_to_team');
    expect(sentArgs(fetchMock)).toEqual({ name: 'Priya', phone: '+31 (6) 1234-5678 ext 9' });
  });

  it('caps name at 120 and message at 2000, like the server', () => {
    const form = new FormCardStore(leadCard(), new CartStore(config));
    form.setValue('name', 'n'.repeat(500));
    form.setValue('message', 'm'.repeat(5000));
    expect(form.values.name).toHaveLength(120);
    expect(form.values.message).toHaveLength(2000);
  });
});

describe('send_to_team: outcomes', () => {
  it('success shows the server message, locks, and never polls a decision', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ ok: true, result: { message: 'Thanks Priya, we will call you today.' } }));
    vi.stubGlobal('fetch', fetchMock);
    const onSent = vi.fn();
    const form = new FormCardStore(leadCard(), new CartStore(config), onSent);
    await form.submit();
    expect(form.phase).toBe('sent');
    expect(form.sentMessage).toBe('Thanks Priya, we will call you today.');
    expect(onSent).not.toHaveBeenCalled();
    await form.submit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('success without a message uses the fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res({ ok: true, result: {} })));
    const form = new FormCardStore(leadCard(), new CartStore(config));
    await form.submit();
    expect(form.sentMessage).toBe(LEAD_SENT_FALLBACK);
  });

  it('429 asks the visitor to wait and keeps the values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res({ detail: 'Rate limit exceeded' }, 429)));
    const form = new FormCardStore(leadCard(), new CartStore(config));
    form.setValue('message', 'typed by hand');
    await form.submit();
    expect(form.phase).toBe('idle');
    expect(form.error).toBe(WAIT_MESSAGE);
    expect(form.values).toMatchObject({ name: 'Priya', email: 'priya@example.com', message: 'typed by hand' });
  });

  it('422 with a field puts the server message on that field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(res({ detail: { code: 'invalid_field', field: 'email', message: 'That address bounced.' } }, 422)),
    );
    const form = new FormCardStore(leadCard(), new CartStore(config));
    await form.submit();
    expect(form.fieldErrors).toEqual({ email: 'That address bounced.' });
    expect(form.error).toBeNull();
    expect(form.values.email).toBe('priya@example.com');
  });

  it('422 naming a field the form does not have, 500, and a network error all get the retry line', async () => {
    for (const reply of [
      () => Promise.resolve(res({ detail: { field: 'ssn', message: 'x' } }, 422)),
      () => Promise.resolve(res({ detail: 'boom' }, 500)),
      () => Promise.reject(new TypeError('Failed to fetch')),
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(reply));
      const form = new FormCardStore(leadCard(), new CartStore(config));
      await form.submit();
      expect(form.error).toBe(RETRY_MESSAGE);
      expect(form.fieldErrors).toEqual({});
      expect(form.phase).toBe('idle');
      expect(form.values.name).toBe('Priya');
    }
  });
});

describe('send_to_team: the card', () => {
  function render(cart: CartStore, fields: unknown[] = LEAD_FIELDS, extra: Record<string, unknown> = {}) {
    const target = document.createElement('div');
    document.body.append(target);
    const json = JSON.stringify({ ui: { type: 'form', props: { verb: 'send_to_team', fields, ...extra } } });
    live = mount(CardHarness, { target, props: { json, cart } });
    flushSync();
    return target;
  }
  const settle = async () => {
    for (let i = 0; i < 5; i++) await tick();
    flushSync();
  };

  it('defaults the title and button, and shows the prefill', () => {
    const t = render(new CartStore(config));
    expect(t.querySelector('.title')?.textContent).toBe('Send this to the team?');
    expect(t.querySelector('button.submit')?.textContent?.trim()).toBe('Send');
    expect((t.querySelector('input[type="email"]') as HTMLInputElement).value).toBe('priya@example.com');
  });

  it('keeps an explicit title and label', () => {
    const t = render(new CartStore(config), LEAD_FIELDS, { title: 'Get a quote', submit_label: 'Ask' });
    expect(t.querySelector('.title')?.textContent).toBe('Get a quote');
    expect(t.querySelector('button.submit')?.textContent?.trim()).toBe('Ask');
  });

  it('marks a bad field aria-invalid with its message attached', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const t = render(new CartStore(config));
    const email = t.querySelector('input[type="email"]') as HTMLInputElement;
    email.value = 'nope';
    email.dispatchEvent(new Event('input', { bubbles: true }));
    (t.querySelector('form') as HTMLFormElement).requestSubmit();
    await settle();
    expect(email.getAttribute('aria-invalid')).toBe('true');
    const msg = document.getElementById(email.getAttribute('aria-describedby')!);
    expect(msg?.textContent).toMatch(/valid email/);
  });

  it('after a success the form stays, read-only, under the server message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res({ ok: true, result: { message: 'Sent. The team will get back to you.' } })));
    const t = render(new CartStore(config));
    (t.querySelector('form') as HTMLFormElement).requestSubmit();
    await settle();
    expect(t.querySelector('button.submit')).toBeNull();
    expect(t.querySelector('.sent')?.textContent).toContain('Sent. The team will get back to you.');
    for (const el of t.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
      expect(el.readOnly).toBe(true);
    }
    expect((t.querySelector('textarea') as HTMLTextAreaElement).value).toBe('20 jackets for a team trip');
  });
});
