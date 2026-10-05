// tests/from-loader.spec.ts — the gate every loader → frame message passes.
// A message counts only when it comes from the real parent window AND from
// the exact configured parent origin. An empty parentOrigin (the boot config
// carried no allowed origin) admits nothing: the gate fails closed instead of
// skipping the origin check, which is what BarShell's inline guard used to do.

import { describe, it, expect } from 'vitest';
import { isFromLoader } from '../src/lib/from-loader';

const parent = {} as Window;
const self = {} as Window;
const HOST = 'https://shop.example';

function ev(source: unknown, origin: string): MessageEvent {
  return { source, origin } as unknown as MessageEvent;
}

describe('isFromLoader', () => {
  it('accepts the parent window at the pinned origin', () => {
    expect(isFromLoader(ev(parent, HOST), { self, parent, parentOrigin: HOST })).toBe(true);
  });

  it('rejects another origin', () => {
    expect(isFromLoader(ev(parent, 'https://evil.example'), { self, parent, parentOrigin: HOST })).toBe(false);
  });

  it('rejects a source that is not the parent window', () => {
    expect(isFromLoader(ev({}, HOST), { self, parent, parentOrigin: HOST })).toBe(false);
  });

  it('rejects everything when the frame is not embedded', () => {
    expect(isFromLoader(ev(self, HOST), { self, parent: self, parentOrigin: HOST })).toBe(false);
  });

  it('fails closed when parentOrigin is empty, even from the real parent', () => {
    expect(isFromLoader(ev(parent, HOST), { self, parent, parentOrigin: '' })).toBe(false);
    expect(isFromLoader(ev(parent, 'https://evil.example'), { self, parent, parentOrigin: '' })).toBe(false);
  });

  it('never treats "*" or "null" as a pinned origin', () => {
    expect(isFromLoader(ev(parent, 'null'), { self, parent, parentOrigin: 'null' })).toBe(false);
    expect(isFromLoader(ev(parent, HOST), { self, parent, parentOrigin: '*' })).toBe(false);
  });
});
