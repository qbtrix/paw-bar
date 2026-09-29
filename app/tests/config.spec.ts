// tests/config.spec.ts — readConfig coverage for the window.__PAWBAR__ boot
// contract. Created 2026-07-16 (D4 greeting). Pins that readConfig reads the
// owner's `greeting` when the frame supplies a string, defaults it to '' when
// the field is absent (or __PAWBAR__ itself is absent), and coerces any
// non-string value to '' so a malformed payload can never inject a non-string
// into the shell's empty-state welcome. Runs under jsdom (real `window`).
// 2026-09-27 (old shell removed): a boot config that still sends the retired
// `ui` field ('glass' or anything else) reads cleanly and is ignored.
// `tokens` and `tokensDark` read as plain string maps, {} when absent or not a
// map; `launcher`, `side` and `logo` read with their defaults.
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

describe('readConfig — retired ui field', () => {
  it("ignores ui: 'glass' and reads the rest of the config", () => {
    setBoot({ ...base, ui: 'glass', greeting: 'hi' });
    const config = readConfig();
    expect(config.greeting).toBe('hi');
    expect(config.widgetId).toBe('w1');
    expect('ui' in config).toBe(false);
  });

  it('ignores a ui value it has never heard of', () => {
    setBoot({ ...base, ui: 42 });
    expect('ui' in readConfig()).toBe(false);
  });
});

describe('readConfig — token maps', () => {
  it('reads tokens and tokensDark as given', () => {
    setBoot({ ...base, tokens: { '--pawbar-accent': '#111' }, tokensDark: { '--pawbar-accent': '#eee' } });
    const config = readConfig();
    expect(config.tokens).toEqual({ '--pawbar-accent': '#111' });
    expect(config.tokensDark).toEqual({ '--pawbar-accent': '#eee' });
  });

  it('an older backend with no tokensDark reads as {}', () => {
    setBoot({ ...base, tokens: { '--pawbar-accent': '#111' } });
    expect(readConfig().tokensDark).toEqual({});
  });

  it('a value that is not a map reads as {}, and non-string values are dropped', () => {
    setBoot({ ...base, tokens: ['--pawbar-accent', '#111'], tokensDark: { '--pawbar-accent': 3, '--pawbar-fg': '#fff' } });
    const config = readConfig();
    expect(config.tokens).toEqual({});
    expect(config.tokensDark).toEqual({ '--pawbar-fg': '#fff' });
    setBoot({ ...base, tokensDark: 'dark' });
    expect(readConfig().tokensDark).toEqual({});
  });
});

describe('readConfig — launcher, side, logo', () => {
  it('reads the owner placement and logo', () => {
    setBoot({ ...base, launcher: 'icon', side: 'left', logo: 'https://cdn.test/logo.png' });
    const config = readConfig();
    expect(config.launcher).toBe('icon');
    expect(config.side).toBe('left');
    expect(config.logo).toBe('https://cdn.test/logo.png');
  });

  it('defaults to the bar on the right, and refuses a script logo', () => {
    setBoot({ ...base, launcher: 'bubble', side: 'top', logo: 'javascript:alert(1)' });
    const config = readConfig();
    expect(config.launcher).toBe('bar');
    expect(config.side).toBe('right');
    expect(config.logo).toBe('');
  });
});
