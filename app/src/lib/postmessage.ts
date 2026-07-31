// postmessage.ts — Lifecycle messages the iframe app sends UP to the outer
// loader that owns the launcher chrome + iframe sizing.
// Created 2026-07-15 (A3 glass bar): the loader hosts the panel iframe; this app
// owns the panel content and tells the loader when to resize/open/close. The
// targetOrigin is ALWAYS pinned to the configured parentOrigin — never "*" —
// so no other origin can observe these messages.
// 2026-07-15 bar-first contract: the docked resting state is now a center-bottom
// BAR that minimizes to a CHIP (captain direction). New messages —
//   {type:"pawbar:resize", h, w}      size of the docked content (w matters for chip)
//   {type:"pawbar:view", view}        dock view flip: "bar" | "chip"
//   {type:"pawbar:open"}              panel open → loader goes full-viewport
//   {type:"pawbar:close"}             panel closed → loader re-docks
//   {type:"pawbar:drag", phase,x,y}   move protocol: "start" → loader goes
//     full-viewport and replies {type:"pawbar:box",x,y,w,h} so the app can track
//     the pointer; "end" carries the new dock anchor for the loader to adopt.

export interface PawBarPoster {
  resize(height: number, width?: number): void;
  view(view: 'bar' | 'chip'): void;
  open(): void;
  close(): void;
  dragStart(): void;
  dragEnd(x: number, y: number): void;
}

export function createPoster(parentOrigin: string): PawBarPoster {
  // In a standalone dev page there's no distinct parent (window.parent === window);
  // posting is a harmless no-op there. A real embed always has a cross-doc parent.
  const target = window.parent && window.parent !== window ? window.parent : null;

  function post(payload: Record<string, unknown>): void {
    if (!target) return;
    // parentOrigin is the exact host origin from the boot config. If it's the
    // dev '*'-less fallback (window.location.origin) the post still pins to a
    // concrete origin — we never broadcast to '*'.
    try {
      target.postMessage(payload, parentOrigin);
    } catch {
      /* origin mismatch / detached parent — drop the lifecycle hint */
    }
  }

  return {
    resize(height: number, width?: number) {
      post({
        type: 'pawbar:resize',
        h: Math.max(0, Math.ceil(height)),
        ...(width !== undefined ? { w: Math.max(0, Math.ceil(width)) } : {}),
      });
    },
    view(view: 'bar' | 'chip') {
      post({ type: 'pawbar:view', view });
    },
    open() {
      post({ type: 'pawbar:open' });
    },
    close() {
      post({ type: 'pawbar:close' });
    },
    dragStart() {
      post({ type: 'pawbar:drag', phase: 'start' });
    },
    dragEnd(x: number, y: number) {
      post({ type: 'pawbar:drag', phase: 'end', x: Math.round(x), y: Math.round(y) });
    },
  };
}
