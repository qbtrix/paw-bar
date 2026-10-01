// tests/cards.spec.ts — Fence interceptor + card parse coverage. Pins that a
// ```pawbar-card fence is diverted from the markdown path into an `md`/`card`
// segment, that parseCard validates + coerces agent-authored JSON safely
// (malformed → null, never throws), that kind:"form" cards are strict (verb and
// fields required, field type allowlist, capped at MAX_FORM_FIELDS), and that
// the untrusted-field guards hold: safeImageUrl rejects javascript:/svg, and
// safeCardUrl / cardHref keep only http(s) or single-slash site paths.
// Price formatting lives in lib/money (tests/money.spec.ts).
import { describe, it, expect } from 'vitest';
import { parseSegments, setLinkBase } from '../src/lib/markdown';
import {
  parseCard,
  isRenderable,
  verbLabel,
  safeImageUrl,
  safeCardUrl,
  cardHref,
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
    expect(segs.map((s) => s.type)).toEqual(['md', 'card', 'md']);
    const card = segs.find((s) => s.type === 'card');
    expect(card && 'json' in card && card.json).toContain('"Espresso"');
  });

  it('still routes a normal code fence to `code`', () => {
    const segs = parseSegments("```js\nconst x = 1;\n```");
    expect(segs.map((s) => s.type)).toEqual(['code']);
  });

  it('shimmer-masks an in-flight unclosed card fence while streaming', () => {
    const segs = parseSegments(`Loading picks:\n\`\`\`pawbar-card\n{"kind":"product"`, true);
    expect(segs.map((s) => s.type)).toEqual(['md', 'code-loading']);
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

  it('safeCardUrl keeps http(s) and single-slash site paths only', () => {
    expect(safeCardUrl('https://shop.example/p/1')).toBe('https://shop.example/p/1');
    expect(safeCardUrl('HTTP://shop.example/p')).toBe('HTTP://shop.example/p');
    expect(safeCardUrl(' /products/x ')).toBe('/products/x');
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'mailto:a@b.example',
      '//evil.example/x',
      '/\\evil.example',
      '/a\\b',
      '/a\tb',
      'products/x',
      '#top',
      'https://',
      '',
      undefined,
    ]) {
      expect(safeCardUrl(bad), String(bad)).toBe('');
    }
  });

  it('parseCard keeps a safe url and drops an unsafe one', () => {
    const first = (url: unknown) =>
      parseCard(JSON.stringify({ kind: 'product', items: [{ id: 'a', name: 'A', url }] }))!.items[0];
    expect(first('/products/a').url).toBe('/products/a');
    expect(first('https://shop.example/a').url).toBe('https://shop.example/a');
    expect(first('javascript:alert(1)').url).toBeUndefined();
    expect(first('//evil.example').url).toBeUndefined();
    expect(first(42).url).toBeUndefined();
  });

  it('cardHref resolves a site path against the host page origin, or drops it', () => {
    const item = { id: 'a', name: 'A', url: '/products/a', actions: [] };
    try {
      setLinkBase(null);
      expect(cardHref(item)).toBeNull();
      setLinkBase('https://shop.example');
      expect(cardHref(item)).toBe('https://shop.example/products/a');
      expect(cardHref({ ...item, url: 'https://other.example/x' })).toBe('https://other.example/x');
      expect(cardHref({ ...item, url: undefined })).toBeNull();
    } finally {
      setLinkBase(null);
    }
  });

  it('safeImageUrl allows http(s)/raster-data and rejects script/svg', () => {
    expect(safeImageUrl('https://x.test/a.png')).toBe('https://x.test/a.png');
    expect(safeImageUrl('data:image/png;base64,AAAA')).toContain('data:image/png');
    expect(safeImageUrl('javascript:alert(1)')).toBe('');
    expect(safeImageUrl('data:image/svg+xml;utf8,<svg onload=alert(1)>')).toBe('');
    expect(safeImageUrl(undefined)).toBe('');
  });

  // ── Key uniqueness (2026-08-19) ───────────────────────────────────────────
  // The card components render these lists in keyed {#each} blocks. Both are
  // index-keyed now so a repeat can no longer throw, but a duplicate that
  // reaches the DOM is still wrong output — the same CTA drawn twice, or a form
  // whose submitted body silently drops one of the visitor's answers. This card
  // is model-emitted JSON, so both cases are payloads to survive rather than
  // states to assume away.
  it('dedupes a repeated product action verb', () => {
    const card = parseCard(
      JSON.stringify({
        kind: 'product',
        items: [{ id: 'e', name: 'Espresso', actions: ['add_to_cart', 'add_to_cart', 'checkout'] }],
      }),
    );
    expect(card?.items?.[0].actions).toEqual(['add_to_cart', 'checkout']);
  });

  it('refuses a form whose field names collide', () => {
    // Not deduped — REFUSED. The submitted body is keyed on the field name, so
    // two fields sharing one means one answer overwrites the other. There is no
    // reading of this card that is safe to render, and the quiet
    // "card unavailable" fallback is the honest outcome.
    expect(
      parseCard(
        JSON.stringify({
          kind: 'form',
          verb: 'book_visit',
          fields: [
            { name: 'phone', label: 'Phone', type: 'tel' },
            { name: 'phone', label: 'Mobile', type: 'tel' },
          ],
        }),
      ),
    ).toBeNull();
  });
});
