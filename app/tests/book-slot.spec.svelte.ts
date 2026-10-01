// tests/book-slot.spec.svelte.ts — the `book_slot` card: book a session in the
// conversation.
//
// Covers parsing the server-hydrated props (no slots → nothing drawn), the
// radio-group slot picker, the email-required check, the confirm request
// (verb, args, idempotency key per card and slot), the booked and requested
// outcomes (lock, "Booked for", the add-to-calendar link and its URL safety),
// 409 slot_taken replacing the slots in place, 429 / 422 / other errors, the
// double-tap guard, and that typed values survive every failure.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import CardHarness from './fixtures/spec/CardHarness.svelte';
import { CartStore } from '../src/store/cart.svelte';
import { BookSlotStore, SLOT_TAKEN, SLOT_TAKEN_NONE, REQUESTED_FALLBACK } from '../src/store/book-slot.svelte';
import { parseBookSlot, safeIcsUrl, MAX_SLOTS, type BookSlotCard } from '../src/lib/booking';
import { WAIT_MESSAGE, RETRY_MESSAGE } from '../src/lib/visitor-input';

const config = { endpoint: 'https://api.example/api/v1', widgetId: 'w1', siteKey: 'k1' };

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

const SLOTS = [
  { slot_id: 's1', label: 'Tue 14 Oct, 2:00 pm', start: '2026-10-14T12:00:00Z' },
  { slot_id: 's2', label: 'Wed 15 Oct, 10:00 am', start: '2026-10-15T08:00:00Z' },
];
const PROPS = {
  session_type: { id: 'intro-30', label: 'Intro call', duration_min: 30 },
  slots: SLOTS,
  name: 'Priya',
  email: 'priya@example.com',
  notes: 'Team jackets',
};

function card(props: Record<string, unknown> = PROPS): BookSlotCard {
  const c = parseBookSlot(props);
  if (!c) throw new Error('book_slot did not parse');
  return c;
}

function store(fetchImpl?: (...a: unknown[]) => unknown, props?: Record<string, unknown>) {
  const fetchMock = vi.fn(fetchImpl ?? (async () => res({ ok: true, result: { status: 'booked', label: 'Tue 14 Oct, 2:00 pm' } })));
  vi.stubGlobal('fetch', fetchMock);
  return { s: new BookSlotStore(card(props), new CartStore(config)), fetchMock };
}

function body(fetchMock: ReturnType<typeof vi.fn>, call = 0): { verb: string; args: Record<string, unknown> } {
  const [, opts] = fetchMock.mock.calls[call] as [string, RequestInit];
  return JSON.parse(String(opts.body));
}

describe('parsing the hydrated card', () => {
  it('reads session, slots and prefill', () => {
    const c = card();
    expect(c.session).toEqual({ id: 'intro-30', label: 'Intro call', duration_min: 30 });
    expect(c.slots.map((s) => s.slot_id)).toEqual(['s1', 's2']);
    expect(c).toMatchObject({ name: 'Priya', email: 'priya@example.com', notes: 'Team jackets' });
  });

  it('drops the card with no usable slot or no session id', () => {
    expect(parseBookSlot({ ...PROPS, slots: [] })).toBeNull();
    expect(parseBookSlot({ ...PROPS, slots: undefined, slot_ids: ['s1'] })).toBeNull();
    expect(parseBookSlot({ ...PROPS, slots: [{ slot_id: 's1' }] })).toBeNull();
    expect(parseBookSlot({ ...PROPS, session_type: undefined })).toBeNull();
    expect(parseBookSlot({ ...PROPS, session_type: { label: 'No id' } })).toBeNull();
  });

  it('dedupes slots, caps them, ignores a bad start, and clips text', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ slot_id: `s${i}`, label: `Slot ${i}` }));
    expect(parseBookSlot({ ...PROPS, slots: many })!.slots).toHaveLength(MAX_SLOTS);
    const c = parseBookSlot({
      ...PROPS,
      session_type: 'intro-30',
      slots: [{ slot_id: 'a', label: 'A', start: 'not a date' }, { slot_id: 'a', label: 'again' }],
      name: 'n'.repeat(300),
    })!;
    expect(c.slots).toEqual([{ slot_id: 'a', label: 'A' }]);
    expect(c.session).toEqual({ id: 'intro-30', label: 'intro-30' });
    expect(c.name).toHaveLength(120);
  });
});

describe('add-to-calendar URL safety', () => {
  const api = config.endpoint;
  it('keeps https and same-API paths', () => {
    expect(safeIcsUrl('https://cal.example/e.ics', api)).toBe('https://cal.example/e.ics');
    expect(safeIcsUrl('/api/v1/paw-bar/booking/ics/abc', api)).toBe('https://api.example/api/v1/paw-bar/booking/ics/abc');
  });
  it('drops javascript:, data:, protocol-relative, backslash and plain http elsewhere', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/calendar,BEGIN', '//evil.example/x.ics', '/\\evil.example', 'http://evil.example/x.ics', 'ics/abc', '', 42]) {
      expect(safeIcsUrl(bad, api), String(bad)).toBe('');
    }
  });
});

describe('confirming', () => {
  it('sends book_slot with the slot, session id, fields and an idempotency key', async () => {
    const { s, fetchMock } = store();
    s.select('s2');
    await s.confirm();
    const b = body(fetchMock);
    expect(b.verb).toBe('book_slot');
    expect(b.args).toEqual({
      slot_id: 's2',
      session_type: 'intro-30',
      name: 'Priya',
      email: 'priya@example.com',
      notes: 'Team jackets',
      idem: s.idemFor('s2'),
    });
    expect(String(b.args.idem)).toMatch(/:s2$/);
  });

  it('the idempotency key is stable per card and slot, and differs across cards', () => {
    const { s } = store();
    expect(s.idemFor('s1')).toBe(s.idemFor('s1'));
    expect(s.idemFor('s1')).not.toBe(s.idemFor('s2'));
    expect(new BookSlotStore(card(), new CartStore(config)).idemFor('s1')).not.toBe(s.idemFor('s1'));
  });

  it('needs a slot and an email that looks right; nothing is sent until then', async () => {
    const { s, fetchMock } = store();
    await s.confirm();
    expect(s.error).toMatch(/Pick a time/);
    s.select('s1');
    s.setValue('email', '');
    await s.confirm();
    expect(s.fieldErrors.email).toMatch(/email/);
    s.setValue('email', 'priya@');
    await s.confirm();
    expect(s.fieldErrors.email).toMatch(/valid email/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preselects the only slot', () => {
    const { s } = store(undefined, { ...PROPS, slots: [SLOTS[0]] });
    expect(s.selected).toBe('s1');
  });

  it('a double tap sends once', async () => {
    let resolve!: (v: unknown) => void;
    const { s, fetchMock } = store(() => new Promise((r) => (resolve = r)));
    s.select('s1');
    const first = s.confirm();
    const second = s.confirm();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    resolve(res({ ok: true, result: { status: 'booked', label: 'Tue' } }));
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('outcomes', () => {
  it('booked: locks with the label and a safe calendar link', async () => {
    const { s } = store(async () => res({ ok: true, result: { status: 'booked', label: 'Tue 14 Oct, 2:00 pm (your time)', ics_url: '/api/v1/paw-bar/ics/b1' } }));
    s.select('s1');
    await s.confirm();
    expect(s.phase).toBe('booked');
    expect(s.locked).toBe(true);
    expect(s.bookedLabel).toBe('Tue 14 Oct, 2:00 pm (your time)');
    expect(s.icsUrl).toBe('https://api.example/api/v1/paw-bar/ics/b1');
    s.select('s2');
    expect(s.selected).toBe('s1');
  });

  it('booked: an unsafe calendar link is dropped, and a missing label falls back to the slot', async () => {
    const { s } = store(async () => res({ ok: true, result: { status: 'booked', ics_url: 'javascript:alert(1)' } }));
    s.select('s2');
    await s.confirm();
    expect(s.icsUrl).toBe('');
    expect(s.bookedLabel).toBe('Wed 15 Oct, 10:00 am');
  });

  it('requested (ask me first): shows the message and locks', async () => {
    const { s } = store(async () => res({ ok: true, result: { status: 'requested', message: 'Requested. Sam will confirm by email.' } }));
    s.select('s1');
    await s.confirm();
    expect(s.phase).toBe('requested');
    expect(s.message).toBe('Requested. Sam will confirm by email.');
    const fallback = store(async () => res({ ok: true, result: { status: 'requested' } })).s;
    fallback.select('s1');
    await fallback.confirm();
    expect(fallback.message).toBe(REQUESTED_FALLBACK);
  });

  it('409 slot_taken replaces the slots in place and keeps typed values', async () => {
    const alternatives = [
      { slot_id: 's3', label: 'Thu 16 Oct, 9:00 am', start: '2026-10-16T07:00:00Z' },
      { slot_id: 's4', label: 'Thu 16 Oct, 3:00 pm', start: '2026-10-16T13:00:00Z' },
    ];
    const { s } = store(async () => res({ detail: { code: 'slot_taken', alternatives } }, 409));
    s.setValue('notes', 'typed by hand');
    s.select('s1');
    await s.confirm();
    expect(s.phase).toBe('idle');
    expect(s.slots.map((x) => x.slot_id)).toEqual(['s3', 's4']);
    expect(s.selected).toBeNull();
    expect(s.notice).toBe(SLOT_TAKEN);
    expect(s.values).toEqual({ name: 'Priya', email: 'priya@example.com', notes: 'typed by hand' });
  });

  it('409 slot_taken with no alternatives removes the taken slot and says so', async () => {
    const { s } = store(async () => res({ detail: { code: 'slot_taken', alternatives: [] } }, 409));
    s.select('s1');
    await s.confirm();
    expect(s.slots.map((x) => x.slot_id)).toEqual(['s2']);
    expect(s.notice).toBe(SLOT_TAKEN_NONE);
  });

  it('429 asks to wait; 422 with a field marks it; anything else is a retry; values stay', async () => {
    const cases: [() => Promise<unknown>, (s: BookSlotStore) => void][] = [
      [async () => res({ detail: 'Rate limit exceeded' }, 429), (s) => expect(s.error).toBe(WAIT_MESSAGE)],
      [
        async () => res({ detail: { code: 'invalid_field', field: 'email', message: 'Use a work email.' } }, 422),
        (s) => {
          expect(s.fieldErrors).toEqual({ email: 'Use a work email.' });
          expect(s.error).toBeNull();
        },
      ],
      [async () => res({ detail: 'slot_taken' }, 500), (s) => expect(s.error).toBe(RETRY_MESSAGE)],
      [async () => Promise.reject(new TypeError('Failed to fetch')), (s) => expect(s.error).toBe(RETRY_MESSAGE)],
    ];
    for (const [reply, check] of cases) {
      const { s } = store(reply);
      s.setValue('name', 'Priya K');
      s.select('s2');
      await s.confirm();
      check(s);
      expect(s.phase).toBe('idle');
      expect(s.selected).toBe('s2');
      expect(s.values.name).toBe('Priya K');
    }
  });
});

describe('the card', () => {
  function render(props: Record<string, unknown> = PROPS, cart: CartStore | null = new CartStore(config)) {
    const target = document.createElement('div');
    document.body.append(target);
    const json = JSON.stringify({ ui: { type: 'book_slot', props } });
    live = mount(CardHarness, { target, props: { json, cart: cart ?? undefined } });
    flushSync();
    return target;
  }
  const settle = async () => {
    for (let i = 0; i < 5; i++) await tick();
    flushSync();
  };

  it('draws a labelled radio group of the slots and the prefilled fields', () => {
    const t = render();
    expect(t.querySelector('fieldset legend')?.textContent).toBe('Pick a time');
    const radios = [...t.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios).toHaveLength(2);
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    expect(t.querySelector('time')?.getAttribute('datetime')).toBe(SLOTS[0].start);
    expect(t.querySelector('.title')?.textContent).toBe('Intro call · 30 min');
    expect((t.querySelector('input[type="email"]') as HTMLInputElement).value).toBe('priya@example.com');
    expect((t.querySelector('input[type="email"]') as HTMLInputElement).required).toBe(true);
  });

  it('draws nothing when the server left no slots', () => {
    const t = render({ ...PROPS, slots: [] });
    expect(t.querySelector('form')).toBeNull();
    expect(t.textContent?.trim()).toBe('');
  });

  it('confirms the picked slot, then locks with the calendar link in a new tab', async () => {
    const fetchMock = vi.fn(async () => res({ ok: true, result: { status: 'booked', label: 'Wed 15 Oct, 10:00 am', ics_url: 'https://cal.example/b.ics' } }));
    vi.stubGlobal('fetch', fetchMock);
    const t = render();
    const radios = t.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    radios[1].click();
    flushSync();
    (t.querySelector('form') as HTMLFormElement).requestSubmit();
    await settle();
    expect(body(fetchMock).args.slot_id).toBe('s2');
    expect(t.querySelector('.sent')?.textContent).toContain('Booked for Wed 15 Oct, 10:00 am');
    const a = t.querySelector('a.ics') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('https://cal.example/b.ics');
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener noreferrer');
    expect(a.textContent).toContain('opens in a new tab');
    expect(t.querySelector('button.submit')).toBeNull();
    expect((t.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    expect((t.querySelector('input[type="email"]') as HTMLInputElement).readOnly).toBe(true);
  });

  it('a 409 swaps the times in place', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ detail: { code: 'slot_taken', alternatives: [{ slot_id: 's9', label: 'Fri 17 Oct, 11:00 am' }] } }, 409)));
    const t = render();
    t.querySelector<HTMLInputElement>('input[type="radio"]')!.click();
    flushSync();
    (t.querySelector('form') as HTMLFormElement).requestSubmit();
    await settle();
    const labels = [...t.querySelectorAll('.slot')].map((l) => l.textContent?.trim());
    expect(labels).toEqual(['Fri 17 Oct, 11:00 am']);
    expect(t.querySelector('.notice')?.textContent).toBe(SLOT_TAKEN);
    expect(t.querySelector<HTMLInputElement>('input[type="radio"]')!.checked).toBe(true);
  });

  it('the Confirm button is disabled while the request is in flight', async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => (resolve = r))));
    const t = render({ ...PROPS, slots: [SLOTS[0]] });
    (t.querySelector('form') as HTMLFormElement).requestSubmit();
    await settle();
    expect((t.querySelector('button.submit') as HTMLButtonElement).disabled).toBe(true);
    await vi.waitFor(() => expect(typeof resolve).toBe('function'));
    resolve(res({ ok: true, result: { status: 'requested' } }));
    await settle();
    expect(t.querySelector('.sent')?.textContent).toBe(REQUESTED_FALLBACK);
  });
});
