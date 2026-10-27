// bar-steps.ts — the open bar's size steps and the visitor's dock, as pure
// functions so they unit-test without layout.
//
// STEPS. The open card has three sizes: docked → wide → full screen. `wide` is
// a wider card with a taller thread, still floating over the site; `full` is
// the full-page chat. They are two flags rather than one level because leaving
// full screen goes back to wide: full keeps `wide` set underneath it. On a
// narrow host (a phone, a short laptop) there is no room for a wide card beside
// the page, so the step is skipped: docked goes straight to full and back.
//
// DOCK. Where the closed bar sits along the bottom edge. The owner's placement
// is the default; a visitor may move it when the owner allows that, and the
// pick is kept in the frame's storage per site. The bar launcher has three
// spots, the icon launcher two corners. Storage blocked or holding junk means
// the owner's default stands.

export interface Steps {
  wide: boolean;
  full: boolean;
}

/** One step bigger. */
export function stepUp(s: Steps, narrow: boolean): Steps {
  if (s.full) return s;
  if (!s.wide && !narrow) return { wide: true, full: false };
  return { wide: s.wide, full: true };
}

/** One step smaller. Leaving full screen lands on wide when it was wide
 *  before (and there is room for it). */
export function stepDown(s: Steps, narrow: boolean): Steps {
  if (s.full) return { wide: s.wide && !narrow, full: false };
  return { wide: false, full: false };
}

export type Dock = 'left' | 'center' | 'right';

export function docksFor(launcher: 'bar' | 'icon'): Dock[] {
  return launcher === 'icon' ? ['left', 'right'] : ['left', 'center', 'right'];
}

/** Where the owner put it: the icon launcher's corner, else the centre. */
export function ownerDock(launcher: 'bar' | 'icon', side: 'left' | 'right'): Dock {
  return launcher === 'icon' ? side : 'center';
}

export const DOCK_KEY = '__pawbar_dock_v1:';

export function readDock(key: string, launcher: 'bar' | 'icon'): Dock | null {
  try {
    const v = localStorage.getItem(key) as Dock | null;
    return v && docksFor(launcher).includes(v) ? v : null;
  } catch {
    return null; // storage blocked: the owner's placement stands
  }
}

export function writeDock(key: string, dock: Dock): void {
  try {
    localStorage.setItem(key, dock);
  } catch {
    /* storage blocked: the move lasts for this page view only */
  }
}
