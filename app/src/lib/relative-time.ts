// relative-time.ts — the compact age a conversation list shows ("now", "5m",
// "3h", "2d", then a date).
// Created 2026-09-27, lifted out of MessagesTab so the new bar's conversation
// list reads the same ages as the Messages tab.

/** Compact relative age. Anything older than a week reads as a date: "8d"
 *  stops being useful at the point where the visitor would rather know when. */
export function ago(iso: string, at: number): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((at - then) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
