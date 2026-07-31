// tests/config.spec.ts — readConfig coverage for the window.__PAWBAR__ boot
// contract. Created 2026-07-16 (D4 greeting). Pins that readConfig reads the
// owner's `greeting` when the frame supplies a string, defaults it to '' when
// the field is absent (or __PAWBAR__ itself is absent), and coerces any
// non-string value to '' so a malformed payload can never inject a non-string
// into the shell's empty-state welcome. Runs under jsdom (real `window`).
import { describe, it, expect, afterEach } from 'vitest';
import { readConfig } from '../src/config';

type Boot = NonNullable<Window['__PAWBAR__']>;

const base: Boot = {
  siteKey: 'k1',
  widgetId: 'w1',
  endpoint: 'http://test.local/api/v1',
  parentOrigin: 'http://host.test',
  mode: 'concierge',
};

function setBoot(boot: unknown): void {
  (window as unknown as { __PAWBAR__?: unknown }).__PAWBAR__ = boot;
}

afterEach(() => {
  delete (window as unknown as { __PAWBAR__?: unknown }).__PAWBAR__;
});

describe('readConfig — greeting', () => {
  it('reads a present greeting string verbatim', () => {
    setBoot({ ...base, greeting: 'Welcome to Bella’s Bakery! Ask about our menu.' });
    expect(readConfig().greeting).toBe('Welcome to Bella’s Bakery! Ask about our menu.');
  });

  it("defaults to '' when the greeting field is absent", () => {
    setBoot({ ...base });
    expect(readConfig().greeting).toBe('');
  });

  it("defaults to '' when window.__PAWBAR__ is absent entirely", () => {
    delete (window as unknown as { __PAWBAR__?: unknown }).__PAWBAR__;
    expect(readConfig().greeting).toBe('');
  });

  it("coerces a non-string greeting (number) to ''", () => {
    setBoot({ ...base, greeting: 42 });
    expect(readConfig().greeting).toBe('');
  });

  it("coerces a non-string greeting (object) to ''", () => {
    setBoot({ ...base, greeting: { text: 'hi' } });
    expect(readConfig().greeting).toBe('');
  });
});
