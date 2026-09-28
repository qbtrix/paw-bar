// components/spec-widgets/props.ts — coercion for spec-supplied props.
// Created 2026-09-27. Spec props are agent-written JSON, so a widget never
// trusts their type: numbers and booleans read as text, objects and arrays read
// as nothing rather than as "[object Object]", and enums fall back to a default.

/** A prop as display text: strings as-is, numbers and booleans stringified. */
export function asString(v: unknown, max = 2000): string {
  if (typeof v === 'string') return v.slice(0, max);
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  return '';
}

/** One of `allowed`, or `fallback`. */
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
