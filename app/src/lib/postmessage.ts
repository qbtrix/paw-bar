// postmessage.ts — Lifecycle messages the iframe app sends UP to the outer
// loader that owns the launcher chrome + iframe sizing.
// Created 2026-07-15 (A3 glass bar): the loader hosts the panel iframe; this app
// owns the panel content and tells the loader when to resize/open/close. The
// targetOrigin is ALWAYS pinned to the configured parentOrigin — never "*" —
// so no other origin can observe these messages. Message shapes are the
// contract the A2 loader listens for: {type:"pawbar:resize",h}, {type:"pawbar:open"},
// {type:"pawbar:close"}.

export interface PawBarPoster {
  resize(height: number): void;
  open(): void;
  close(): void;
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
    resize(height: number) {
      post({ type: 'pawbar:resize', h: Math.max(0, Math.ceil(height)) });
    },
    open() {
      post({ type: 'pawbar:open' });
    },
    close() {
      post({ type: 'pawbar:close' });
    },
  };
}
