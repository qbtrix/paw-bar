// money.ts — Every amount on the wire (price_cents, total_cents, line_total_cents,
// …) is in ISO 4217 MINOR units of its currency; the "_cents" names are
// historical. ¥1,500 is 1500, $3.50 is 350, 1.250 KWD is 1250.
//
// CURRENCY_EXPONENTS is the ISO 4217 exception list; every other code has 2
// decimals. pocketpaw (src/pocketpaw/money.py) and paw-enterprise
// (core/shared/money.ts) carry the same table, and tests/money.spec.ts pins this
// copy to tests/fixtures/currency_exponents.json. Never edit one copy alone.
// We don't use Intl's resolvedOptions() digits: CLDR disagrees with ISO for
// some codes (IQD), and the server and every client must agree exactly.

export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = Object.freeze({
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLF: 4, UYW: 4,
});

function normalize(code: string | undefined): string {
  const c = (code ?? '').trim().toUpperCase();
  return c || 'USD';
}

/** Decimal places of a currency's minor unit; 2 for any code not in the table. */
export function exponent(code: string | undefined): number {
  return CURRENCY_EXPONENTS[normalize(code)] ?? 2;
}

/** Minor units → major amount (1250 KWD → 1.25). */
export function fromMinor(amount: number, code: string | undefined): number {
  return amount / 10 ** exponent(code);
}

/** Display string for an amount in minor units; '' when there's no amount.
 *  Never throws: a code Intl rejects falls back to "1.25 XX". */
export function formatMinor(amount: number | undefined, code: string | undefined = 'USD'): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '';
  const c = normalize(code);
  const e = exponent(c);
  const major = fromMinor(amount, c);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: c,
      minimumFractionDigits: e,
      maximumFractionDigits: e,
    }).format(major);
  } catch {
    return `${major.toFixed(e)} ${c}`;
  }
}
