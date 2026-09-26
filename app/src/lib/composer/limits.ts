// limits.ts — Message length cap for the composer. Created 2026-09-26.
// The paw_bar chat endpoint rejects a `message` over 8,000 characters with a
// 400, which the widget can only show as a generic failure. Composer.svelte
// caps input here (maxlength), refuses to send over it, and shows a calm hint
// from MESSAGE_LIMIT_HINT_AT on. Keep MAX_MESSAGE_CHARS in step with the
// backend's limit.

/** Longest message the backend accepts, in characters. */
export const MAX_MESSAGE_CHARS = 8000;

/** Length at which the composer starts showing the limit hint. */
export const MESSAGE_LIMIT_HINT_AT = 7500;
