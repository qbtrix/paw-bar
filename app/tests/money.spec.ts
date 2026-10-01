// tests/money.spec.ts — lib/money: amounts are ISO 4217 minor units.
// The exponent table must equal tests/fixtures/currency_exponents.json, which is
// the canonical table from the concierge catalog/money design and the same one
// pocketpaw (money.py) and paw-enterprise (core/shared/money.ts) carry. Never
// edit the fixture to make this pass; change all three copies together.
import { describe, it, expect } from 'vitest';
import tableRaw from './fixtures/currency_exponents.json?raw';
import { CURRENCY_EXPONENTS, exponent, formatMinor, fromMinor } from '../src/lib/money';

describe('currency exponent table', () => {
  it('matches the canonical table exactly', () => {
    expect({ ...CURRENCY_EXPONENTS }).toEqual(JSON.parse(tableRaw));
  });

  it('defaults every other code (and a missing one) to 2, case-insensitively', () => {
    expect(exponent('USD')).toBe(2);
    expect(exponent('ZZZ')).toBe(2);
    expect(exponent(undefined)).toBe(2);
    expect(exponent('jpy')).toBe(0);
    expect(exponent(' kwd ')).toBe(3);
    expect(exponent('CLF')).toBe(4);
  });

  it('converts minor units to the major amount', () => {
    expect(fromMinor(1500, 'JPY')).toBe(1500);
    expect(fromMinor(350, 'USD')).toBe(3.5);
    expect(fromMinor(1250, 'KWD')).toBe(1.25);
  });
});

describe('formatMinor', () => {
  it('formats a 2-decimal currency', () => {
    expect(formatMinor(350, 'USD')).toContain('3.50');
  });

  it('formats a zero-decimal currency without dividing by 100', () => {
    const s = formatMinor(1500, 'JPY');
    expect(s).toContain('1,500');
    expect(s).not.toContain('.');
  });

  it('formats a three-decimal currency with three digits', () => {
    expect(formatMinor(1250, 'KWD')).toContain('1.250');
  });

  it('uses the table, not CLDR, for IQD', () => {
    expect(formatMinor(1250, 'IQD')).toContain('1.250');
  });

  it('formats an unknown but well-formed code with 2 decimals', () => {
    expect(formatMinor(350, 'ZZZ')).toContain('3.50');
  });

  it('falls back to a plain string for a code Intl rejects, without throwing', () => {
    expect(formatMinor(350, 'dollars')).toBe('3.50 DOLLARS');
  });

  it('is empty when there is no amount', () => {
    expect(formatMinor(undefined, 'USD')).toBe('');
    expect(formatMinor(Number.NaN, 'USD')).toBe('');
  });

  it('defaults a missing currency to USD', () => {
    expect(formatMinor(350, undefined)).toContain('3.50');
  });
});
