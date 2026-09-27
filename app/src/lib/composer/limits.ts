// limits.ts — Message length cap for the composer. Created 2026-09-26.
// The paw_bar chat endpoint rejects a `message` over 8,000 characters with a
// 400, which the widget can only show as a generic failure. The bar's field
// (components/bar/PawBar.svelte) caps input here (maxlength) and refuses to
// send over it; tests/message-limit.spec.svelte.ts pins both. Keep
// MAX_MESSAGE_CHARS in step with the backend's limit.
// 2026-09-27 (old shell removed): the old Composer.svelte, which also used
// MESSAGE_LIMIT_HINT_AT for a near-limit hint, is gone. The bar has no hint
// yet, so MESSAGE_LIMIT_HINT_AT has no caller today.

/** Longest message the backend accepts, in characters. */
export const MAX_MESSAGE_CHARS = 8000;

/** Length at which the composer starts showing the limit hint. */
export const MESSAGE_LIMIT_HINT_AT = 7500;
