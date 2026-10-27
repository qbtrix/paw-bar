// tests/bar-steps.spec.ts — the open bar's size steps and the visitor's dock
// (lib/bar-steps): docked → wide → full and back one step at a time, no wide
// step on a narrow host, and a stored dock that only ever names a real spot.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  stepUp,
  stepDown,
  docksFor,
  ownerDock,
  readDock,
  writeDock,
  DOCK_KEY,
} from '../src/lib/bar-steps';

const docked = { wide: false, full: false };
const wide = { wide: true, full: false };
const fullFromWide = { wide: true, full: true };
const fullFromDocked = { wide: false, full: true };

describe('size steps', () => {
  it('goes docked → wide → full', () => {
    expect(stepUp(docked, false)).toEqual(wide);
    expect(stepUp(wide, false)).toEqual(fullFromWide);
    expect(stepUp(fullFromWide, false)).toEqual(fullFromWide);
  });

  it('comes back down one step at a time', () => {
    expect(stepDown(fullFromWide, false)).toEqual(wide);
    expect(stepDown(wide, false)).toEqual(docked);
    expect(stepDown(docked, false)).toEqual(docked);
  });

  it('skips wide on a narrow host, both ways', () => {
    expect(stepUp(docked, true)).toEqual(fullFromDocked);
    expect(stepDown(fullFromDocked, true)).toEqual(docked);
    // Wide on a wide window, then the window narrowed: leaving full skips it.
    expect(stepDown(fullFromWide, true)).toEqual(docked);
  });
});

describe('dock', () => {
  beforeEach(() => localStorage.clear());

  it('offers three spots for the bar and two corners for the icon', () => {
    expect(docksFor('bar')).toEqual(['left', 'center', 'right']);
    expect(docksFor('icon')).toEqual(['left', 'right']);
  });

  it("defaults to the owner's placement", () => {
    expect(ownerDock('bar', 'left')).toBe('center');
    expect(ownerDock('icon', 'left')).toBe('left');
    expect(ownerDock('icon', 'right')).toBe('right');
  });

  it('remembers a pick per site key', () => {
    writeDock(DOCK_KEY + 'w1', 'left');
    expect(readDock(DOCK_KEY + 'w1', 'bar')).toBe('left');
    expect(readDock(DOCK_KEY + 'w2', 'bar')).toBeNull();
  });

  it('ignores a stored spot the launcher does not have, or junk', () => {
    writeDock(DOCK_KEY + 'w1', 'center');
    expect(readDock(DOCK_KEY + 'w1', 'icon')).toBeNull();
    localStorage.setItem(DOCK_KEY + 'w1', 'top');
    expect(readDock(DOCK_KEY + 'w1', 'bar')).toBeNull();
  });

  it('fails safe when storage is blocked', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => writeDock(DOCK_KEY + 'w1', 'left')).not.toThrow();
    expect(readDock(DOCK_KEY + 'w1', 'bar')).toBeNull();
    get.mockRestore();
    set.mockRestore();
  });
});
