// from-loader.ts — The one gate for messages the host loader sends DOWN to the
// frame (pawbar:host-open, :page, :viewport, and anything added later).
//
// A message counts only when it comes from the real parent window and from the
// exact parentOrigin in the boot config. An empty origin, or a value that is
// not a concrete origin ('*', 'null'), admits nothing. Skipping the origin
// check in that case would let any page that frames the bar drive it, and
// host commands (page actions) must never inherit that hole. main.ts warns
// once at boot when the origin is missing, so the failure is visible.

export interface LoaderGate {
  self: Window;
  parent: Window;
  parentOrigin: string;
}

/** True when parentOrigin is a concrete origin the gate can pin to. */
export function isPinnedOrigin(origin: string): boolean {
  return !!origin && origin !== '*' && origin !== 'null';
}

export function isFromLoader(ev: MessageEvent, gate: LoaderGate): boolean {
  if (gate.parent === gate.self || ev.source !== gate.parent) return false;
  if (!isPinnedOrigin(gate.parentOrigin)) return false;
  return ev.origin === gate.parentOrigin;
}
