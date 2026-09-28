// tests/card-parity.spec.ts — the client half of the card-parity check with
// pocketpaw. Created 2026-09-28.
//
// fixtures/card_parity/ is a byte-for-byte copy of pocketpaw's
// tests/fixtures/card_parity/: shared pawbar-card fence bodies (cases.json) and
// the verdict each side must reach (expected.json). This file runs every case
// through the real parseSpecCard and asserts the `client` column, and checks
// that the bounds and host events in expected.json are the ones the bar uses.
// pocketpaw's tests/cloud/test_paw_bar_concierge_v2_output.py asserts the
// `server` column and the server constants, so a bound changed on one side
// fails a test on that side. Refreshing: see "Card parity with pocketpaw" in
// README.md. Never edit expected.json to make this pass.

import { describe, it, expect } from 'vitest';
import casesRaw from './fixtures/card_parity/cases.json?raw';
import expectedRaw from './fixtures/card_parity/expected.json?raw';
import {
  parseSpecCard,
  MAX_SPEC_CHARS,
  MAX_SPEC_NODES,
  MAX_SPEC_DEPTH,
  SPEC_HOST_EVENTS,
} from '../src/lib/spec-card';

type Case = { name: string; about: string; body: string };
type Expected = {
  bounds: { max_chars: number; max_nodes: number; max_depth: number; host_events: string[] };
  verdicts: Record<string, { client: 'spec' | 'invalid' | 'legacy'; server: string }>;
};

const cases = JSON.parse(casesRaw) as Case[];
const expected = JSON.parse(expectedRaw) as Expected;

describe('card parity with pocketpaw', () => {
  it('every case has a verdict and every verdict has a case', () => {
    expect(new Set(cases.map((c) => c.name))).toEqual(new Set(Object.keys(expected.verdicts)));
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s reaches the committed client verdict', (_name, c) => {
    expect(parseSpecCard(c.body).kind).toBe(expected.verdicts[c.name].client);
  });

  it('the bounds and host events match the constants the bar uses', () => {
    expect(expected.bounds).toEqual({
      max_chars: MAX_SPEC_CHARS,
      max_nodes: MAX_SPEC_NODES,
      max_depth: MAX_SPEC_DEPTH,
      host_events: [...SPEC_HOST_EVENTS],
    });
  });
});
