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
//   {type:"pawbar:open"}              panel open → loader docks the COLUMN
//     (2026-08-19: this used to make the iframe full-viewport, which meant the
//     host page could not be clicked while the bar was open — a modal in all
//     but name. The loader now sizes the box to the column itself.)
//   {type:"pawbar:expand", on}        opt-in big reading surface (full-viewport)
//   {type:"pawbar:close"}             panel closed → loader re-docks
//   {type:"pawbar:drag", phase,x,y}   move protocol: "start" → loader goes
//     full-viewport and replies {type:"pawbar:box",x,y,w,h} so the app can track
//     the pointer; "end" carries the new dock anchor for the loader to adopt.
//   {type:"pawbar:bar", compact, expanded}   how wide the DOCKED BAR wants to
//     rest (2026-08-22). `compact` is the owner's resting mode; `expanded` is
//     whether the visitor is currently hovering/focusing/drafting in it. The
//     loader owns both widths (BAR_W_REST / BAR_W) and animates between them.
//
//     THE APP DOES NOT ANIMATE ITS OWN WIDTH, and that is the entire design.
//     The hover morph that shipped before 2026-08-19 did: the app eased
//     .bar-slot's width, a ResizeObserver reported every intermediate value,
//     and the loader started its own eased box transition toward a target the
//     content had already passed — so the frame was permanently behind its own
//     contents and the composer was visibly clipped. Sending an INTENT instead
//     of a measurement inverts that. The frame leads, the app is width:100% of
//     whatever box it is handed, and content that fills its frame can never
//     overflow it however the frame is moving.
//   {type:"pawbar:overlay", on}       a menu/popover is showing (2026-08-19).
//     Outside-click dismissal inside the frame can only see pointer events
//     inside the FRAME, so a click on the host page left the quick menu or the
//     cart popover hanging open over a page the visitor had moved on from.
//     While this is on, a click on the host page answers with a bare
//     {type:"pawbar:host-pointerdown"} — no coordinates, no target, nothing
//     about the host page crosses the boundary, and nothing is sent at all
//     while it is off.

export interface PawBarPoster {
  resize(height: number, width?: number): void;
  view(view: 'bar' | 'chip'): void;
  open(): void;
  /** Ask the loader for the big reading surface (true) or the docked column
   *  (false). Separate from open/close so collapsing an expanded panel returns
   *  to the column rather than shutting the conversation. */
  expand(on: boolean): void;
  close(): void;
  dragStart(): void;
  dragEnd(x: number, y: number): void;
  /** Tell the loader whether a dismissible overlay is showing, so it can watch
   *  the host page for the click that should close it. */
  overlay(on: boolean): void;
  /** Declare how wide the docked bar wants to be. An INTENT, never a measured
   *  width — see the protocol note at the top of this file for why that
   *  distinction is the difference between this working and clipping. */
  bar(compact: boolean, expanded: boolean): void;
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
    expand(on: boolean) {
      post({ type: 'pawbar:expand', on });
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
    overlay(on: boolean) {
      post({ type: 'pawbar:overlay', on });
    },
    bar(compact: boolean, expanded: boolean) {
      post({ type: 'pawbar:bar', compact, expanded });
    },
  };
}
