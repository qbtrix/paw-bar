// tests/cards.spec.ts — Fence interceptor + card parse/format coverage. Created
// 2026-07-15 (C2 action loop). Pins that a ```pawbar-card fence is diverted from
// the markdown/DOMPurify path into a `card` segment, that parseCard validates +
// coerces agent-authored JSON safely (malformed → null, never throws), and that
// the untrusted-field guards hold (safeImageUrl rejects javascript:/svg).
// 2026-07-30 (form cards): + kind:"form" parse coverage — verb/fields required,
// strict field shape + type allowlist (violation → null → quiet fallback),
// fields capped at MAX_FORM_FIELDS, optional title/submit_label, renderable.
import { describe, it, expect } from 'vitest';
import { parseSegments } from '../src/lib/markdown';
import {
  parseCard,
  isRenderable,
  verbLabel,
  formatPrice,
  safeImageUrl,
  MAX_FORM_FIELDS,
} from '../src/lib/cards';

const CARD = `{"kind":"product","items":[{"id":"espresso","name":"Espresso","price_cents":350,"currency":"USD","image_url":"https://x.test/e.png","actions":["add_to_cart"]}]}`;

const FORM_CARD = JSON.stringify({
  kind: 'form',
  verb: 'book_visit',
  title: 'Book a repair visit',
  submit_label: 'Send request',
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'issue', label: 'What needs fixing?', type: 'textarea' },
  ],
});

describe('parseSegments — pawbar-card fence interceptor', () => {
  it('diverts a pawbar-card fence into a `card` segment (not `code`)', () => {
    const segs = parseSegments(`Here are our picks:\n\`\`\`pawbar-card\n${CARD}\n\`\`\`\nEnjoy.`);
    expect(segs.map((s) => s.type)).toEqual(['html', 'card', 'html']);
    const card = segs.find((s) => s.type === 'card');
    expect(card && 'json' in card && card.json).toContain('"Espresso"');
  });

  it('still routes a normal code fence to `code`', () => {
    const segs = parseSegments("```js\nconst x = 1;\n```");
    expect(segs.map((s) => s.type)).toEqual(['code']);
  });

  it('shimmer-masks an in-flight unclosed card fence while streaming', () => {
    const segs = parseSegments(`Loading picks:\n\`\`\`pawbar-card\n{"kind":"product"`, true);
    expect(segs.map((s) => s.type)).toEqual(['html', 'code-loading']);
  });
});

describe('parseCard', () => {
  it('parses a valid product card', () => {
    const card = parseCard(CARD);
    expect(card).not.toBeNull();
    expect(card?.kind).toBe('product');
    expect(card?.items).toHaveLength(1);
    expect(card?.items[0]).toMatchObject({ id: 'espresso', name: 'Espresso', price_cents: 350, actions: ['add_to_cart'] });
  });

  it('returns null on malformed JSON', () => {
    expect(parseCard('{"kind":"product","items":[')).toBeNull();
  });

  it('returns null when there are no renderable items', () => {
    expect(parseCard('{"kind":"product","items":[]}')).toBeNull();
    expect(parseCard('{"kind":"product","items":[{"id":"x"}]}')).toBeNull(); // no name
  });

  it('drops non-string actions and unnamed items, defaults kind', () => {
    const card = parseCard('{"items":[{"name":"A","actions":["add_to_cart",42]},{"price_cents":1}]}');
    expect(card?.kind).toBe('product');
    expect(card?.items).toHaveLength(1);
    expect(card?.items[0].actions).toEqual(['add_to_cart']);
  });

  it('preserves an unknown kind (so the renderer can gate it to the fallback)', () => {
    const card = parseCard('{"kind":"booking","items":[{"name":"Table for 2","actions":["reserve"]}]}');
    expect(card?.kind).toBe('booking');
  });
});

describe('parseCard — kind:"form" (gated-action detail collector)', () => {
  it('parses a valid form card with title + submit_label', () => {
    const card = parseCard(FORM_CARD);
    expect(card).not.toBeNull();
    expect(card?.kind).toBe('form');
    expect(card?.verb).toBe('book_visit');
    expect(card?.title).toBe('Book a repair visit');
    expect(card?.submit_label).toBe('Send request');
    expect(card?.fields).toEqual([
      { name: 'name', label: 'Name', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'issue', label: 'What needs fixing?', type: 'textarea' },
    ]);
  });

  it('title and submit_label are optional', () => {
    const card = parseCard(
      '{"kind":"form","verb":"book_visit","fields":[{"name":"name","label":"Name","type":"text"}]}',
    );
    expect(card?.verb).toBe('book_visit');
    expect(card?.title).toBeUndefined();
    expect(card?.submit_label).toBeUndefined();
  });

  it('rejects a form without a verb or without fields', () => {
    expect(parseCard('{"kind":"form","fields":[{"name":"a","label":"A","type":"text"}]}')).toBeNull();
    expect(parseCard('{"kind":"form","verb":"book_visit"}')).toBeNull();
    expect(parseCard('{"kind":"form","verb":"book_visit","fields":[]}')).toBeNull();
  });

  it('rejects a field missing name/label or with a non-allowlisted type', () => {
    expect(
      parseCard('{"kind":"form","verb":"v","fields":[{"label":"A","type":"text"}]}'),
    ).toBeNull();
    expect(parseCard('{"kind":"form","verb":"v","fields":[{"name":"a","type":"text"}]}')).toBeNull();
    expect(
      parseCard('{"kind":"form","verb":"v","fields":[{"name":"a","label":"A","type":"date"}]}'),
    ).toBeNull();
    expect(
      parseCard('{"kind":"form","verb":"v","fields":[{"name":"a","label":"A","type":"checkbox"}]}'),
    ).toBeNull();
  });

  it(`caps fields at ${MAX_FORM_FIELDS}`, () => {
    const fields = Array.from({ length: 12 }, (_, i) => ({
      name: `f${i}`,
      label: `F${i}`,
      type: 'text',
    }));
    const card = parseCard(JSON.stringify({ kind: 'form', verb: 'v', fields }));
    expect(card?.fields).toHaveLength(MAX_FORM_FIELDS);
  });

  it('a form card is renderable (and still safely gated when malformed)', () => {
    expect(isRenderable(parseCard(FORM_CARD))).toBe(true);
    expect(isRenderable(parseCard('{"kind":"form","verb":"v","fields":"nope"}'))).toBe(false);
  });
});

describe('isRenderable — kind gate (unknown kind → fallback)', () => {
  it('renders a product card', () => {
    expect(isRenderable(parseCard(CARD))).toBe(true);
  });

  it('routes an unknown kind to the fallback', () => {
    expect(isRenderable(parseCard('{"kind":"booking","items":[{"name":"X","actions":[]}]}'))).toBe(false);
  });

  it('routes a malformed / itemless card (null) to the fallback', () => {
    expect(isRenderable(null)).toBe(false);
    expect(isRenderable(parseCard('{bad json'))).toBe(false);
  });
});

describe('card helpers', () => {
  it('labels known + unknown verbs', () => {
    expect(verbLabel('add_to_cart')).toBe('Add to cart');
    expect(verbLabel('checkout')).toBe('Checkout');
    expect(verbLabel('join_waitlist')).toBe('Join Waitlist');
  });

  it('formats prices from minor units', () => {
    expect(formatPrice(350, 'USD')).toContain('3.50');
    expect(formatPrice(undefined)).toBe('');
  });

  it('safeImageUrl allows http(s)/raster-data and rejects script/svg', () => {
    expect(safeImageUrl('https://x.test/a.png')).toBe('https://x.test/a.png');
    expect(safeImageUrl('data:image/png;base64,AAAA')).toContain('data:image/png');
    expect(safeImageUrl('javascript:alert(1)')).toBe('');
    expect(safeImageUrl('data:image/svg+xml;utf8,<svg onload=alert(1)>')).toBe('');
    expect(safeImageUrl(undefined)).toBe('');
  });
});
