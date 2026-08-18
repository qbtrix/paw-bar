// tests/customer-ref.spec.ts — the anonymous visitor handle is per-SITE.
// Created 2026-08-19 (Messenger).
//
// The bug this pins: `pawbar.customer_ref` was a single unnamespaced key, while
// the transcript key sitting right beside it was namespaced per widget. That is
// not an inconsistency, it is a leak — this storage lives in the FRAME's origin,
// which is the backend's, and that origin is shared by every site the backend
// serves. So one browser handed the SAME handle to every tenant's bar, and two
// unrelated site owners saw one visitor under one id.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Loaded FRESH per test rather than statically imported. The module caches
// resolved handles in memory by design, and a static import would keep that
// cache across every test in this file while each test gets a new storage map —
// so the assertions would be reading a handle minted against storage that no
// longer exists. `load()` is what makes each test a real cold start.
async function load() {
  vi.resetModules();
  return (await import('../src/lib/customer-ref')).getCustomerRef;
}

// This repo's vitest/jsdom ships a method-less localStorage in some suites —
// shim a Map-backed Storage (the workspace's standard fix) so the assertions
// below are about the module, never about the environment.
let map: Map<string, string>;

beforeEach(() => {
  map = new Map<string, string>();
  const shim = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage;
  vi.stubGlobal('localStorage', shim);
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getCustomerRef', () => {
  it('gives two different widgets two different handles', async () => {
    // One module instance, two sites — the case that actually happens when a
    // page embeds two bars served from the same backend origin.
    const getCustomerRef = await load();
    const a = await getCustomerRef('widget-a');
    const b = await getCustomerRef('widget-b');

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives CONCURRENT callers one handle, not one each', async () => {
    // The bug this pins, caught by running the widget rather than by reading
    // it: four stores (chat, cart, contact, operator) ask as the panel opens,
    // minting is async, and a resolved-value cache is missed by all four before
    // the first await settles. One page load produced three different refs — so
    // the operator poll was asking about a visitor the chat had never been, and
    // the owner's replies could never have arrived.
    const getCustomerRef = await load();

    const refs = await Promise.all([
      getCustomerRef('widget-a'),
      getCustomerRef('widget-a'),
      getCustomerRef('widget-a'),
      getCustomerRef('widget-a'),
    ]);

    expect(new Set(refs).size).toBe(1);
    // And storage agrees with what the callers were handed.
    expect(map.get('pawbar.customer_ref.v2.widget-a')).toBe(refs[0]);
  });

  it('keeps concurrent callers on DIFFERENT widgets apart', async () => {
    const getCustomerRef = await load();

    const [a, b] = await Promise.all([
      getCustomerRef('widget-a'),
      getCustomerRef('widget-b'),
    ]);

    // Sharing the in-flight promise must not collapse two sites into one
    // visitor — that is the leak this file exists to prevent.
    expect(a).not.toBe(b);
  });

  it('is stable for one widget across calls and across a reload', async () => {
    const getCustomerRef = await load();
    const first = await getCustomerRef('widget-a');
    expect(await getCustomerRef('widget-a')).toBe(first);

    // A reload is a fresh module over the SAME storage — the iframe does this
    // on every host-page navigation.
    const reloaded = await load();
    expect(await reloaded('widget-a')).toBe(first);
  });

  it('namespaces the storage key so one site cannot read another', async () => {
    const getCustomerRef = await load();
    await getCustomerRef('widget-a');
    const keys = [...map.keys()].filter((k) => k.startsWith('pawbar.customer_ref'));

    expect(keys).toContain('pawbar.customer_ref.v2.widget-a');
    // The bare key is what leaked across tenants; nothing may write it again.
    expect(keys).not.toContain('pawbar.customer_ref');
  });

  it('adopts a pre-namespace handle once, so an in-flight visitor is not orphaned', async () => {
    const legacy = 'a'.repeat(64);
    map.set('pawbar.customer_ref', legacy);
    const getCustomerRef = await load();

    // The first widget to look inherits the conversation the server already has.
    expect(await getCustomerRef('widget-a')).toBe(legacy);

    // A SIBLING site must not also inherit it — that would recreate the exact
    // cross-tenant sharing this change exists to end.
    const fresh = await load();
    expect(await fresh('widget-b')).not.toBe(legacy);
  });

  it('still returns a usable handle when storage is blocked', async () => {
    const blocked = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    Object.defineProperty(window, 'localStorage', { value: blocked, configurable: true });

    const fresh = await load();
    const ref = await fresh('widget-a');

    // Safari private mode: session-only chat, never a crash and never an empty
    // handle (the server rejects a ref shorter than 8 chars).
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
    expect(await fresh('widget-a')).toBe(ref);
  });
});
