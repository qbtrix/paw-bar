// tests/scheme.spec.ts — the widget follows the site it is bolted to.
// Created 2026-08-19.
//
// THE REPORT THIS EXISTS FOR: "i see dark mode only". The widget shipped a
// single dark palette, so a light storefront got a dark slab in its corner. It
// cannot answer this for itself — a cross-origin frame can see nothing of the
// page around it — so the loader reads the host page and passes the answer on
// the frame URL, and this is where the precedence lives.
//
// The cascade is the whole feature, and every rung of it is a decision someone
// could reasonably get backwards later: an owner who set "always light" must
// not be overridden by a visitor's midnight OS, and a site that is plainly
// light must not be overridden by that same OS either.

import { describe, it, expect } from 'vitest';
import { resolveScheme, readSetting, hostSchemeFromUrl } from '../src/lib/scheme';

describe('scheme precedence', () => {
  it('the owner wins over everything', () => {
    // They know their brand. A visitor browsing at midnight does not get to
    // repaint a deliberately light widget.
    expect(resolveScheme({ owner: 'light', host: 'd', prefersDark: true })).toBe('light');
    expect(resolveScheme({ owner: 'dark', host: 'l', prefersDark: false })).toBe('dark');
  });

  it('the host page wins over the visitor OS', () => {
    // THE POINT OF THE FEATURE. A support widget belongs to the page it is
    // bolted to more than to the desktop behind it, so a light site gets a
    // light widget even for a visitor whose OS is dark.
    expect(resolveScheme({ owner: 'auto', host: 'l', prefersDark: true })).toBe('light');
    expect(resolveScheme({ owner: 'auto', host: 'd', prefersDark: false })).toBe('dark');
  });

  it('falls back to the visitor OS when the page says nothing', () => {
    // Standalone frame, or a host the loader could not read.
    expect(resolveScheme({ owner: 'auto', host: null, prefersDark: false })).toBe('light');
    expect(resolveScheme({ owner: 'auto', host: '', prefersDark: true })).toBe('dark');
  });

  it('falls back to dark when nothing is known at all', () => {
    // The palette this widget has always shipped, so an unknown environment
    // renders what every existing install already renders.
    expect(resolveScheme({})).toBe('dark');
    expect(resolveScheme({ owner: 'auto', host: null })).toBe('dark');
  });

  it('ignores a host value it does not recognise', () => {
    // The `?s=` param is on a URL anyone can edit. A junk value must fall
    // through to the next rung, never select something arbitrary.
    expect(resolveScheme({ owner: 'auto', host: 'purple', prefersDark: false })).toBe('light');
    expect(resolveScheme({ owner: 'auto', host: '<script>', prefersDark: true })).toBe('dark');
  });

  it('accepts the long spellings as well as the loader shorthand', () => {
    expect(resolveScheme({ owner: 'auto', host: 'light', prefersDark: true })).toBe('light');
    expect(resolveScheme({ owner: 'auto', host: 'dark', prefersDark: false })).toBe('dark');
  });
});

describe('readSetting', () => {
  it('defaults anything unrecognised to auto', () => {
    // The boot config is server-authored, but this file's whole job is to be
    // the boundary that does not assume that.
    for (const bad of [undefined, null, '', 'Light', 'LIGHT', 0, 1, {}, [], 'system']) {
      expect(readSetting(bad)).toBe('auto');
    }
  });

  it('passes the three real values through', () => {
    expect(readSetting('light')).toBe('light');
    expect(readSetting('dark')).toBe('dark');
    expect(readSetting('auto')).toBe('auto');
  });
});

describe('hostSchemeFromUrl', () => {
  it('reads the loader parameter off the frame URL', () => {
    expect(hostSchemeFromUrl('?key=abc&w=w1&po=https%3A%2F%2Fx.test&s=l')).toBe('l');
    expect(hostSchemeFromUrl('?s=d')).toBe('d');
  });

  it('is null when the loader did not send one', () => {
    // A standalone dev frame has no loader in front of it.
    expect(hostSchemeFromUrl('?key=abc')).toBeNull();
    expect(hostSchemeFromUrl('')).toBeNull();
  });
});
