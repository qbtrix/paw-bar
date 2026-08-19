<!--
  Composer.svelte — Lean Svelte 5 composer host. Created 2026-07-15 (A3 glass
  bar). Rebuilt fresh instead of porting paw-enterprise's 1499-line ChatInput
  (5 store couplings). Autosizing textarea, Enter-to-send /
  Shift+Enter-newline, paste-intercept (files surfaced, not dumped as base64),
  and a send button that becomes a Stop button mid-stream. Voice/emoji are
  owner-mode later — out of scope for the concierge visitor face.
  2026-07-15 polish: 15px type, roomier padding, 36px send, softer focus ring
  (45% ring mix — the full-strength ring read as a harsh outline).
  2026-07-30 paw-os design-language pass: send button is now a CIRCLE with the
  lucide ArrowUp stroke glyph (matching ChatPill / ChatInput's rounded-full +
  ArrowUp) — the old left-pointing filled play-glyph read as "back". Mobile
  (≤640px): 32px send, 16px textarea type so iOS Safari doesn't auto-zoom on
  focus.

  2026-08-19 (input redesign, captain direction): this is now the widget's ONLY
  text input — the resting bar holds a live one rather than a label that grew
  into one on hover. Two changes follow from that:

  • The send button is quiet until there is something to send. A permanently
    filled accent circle on a resting widget is a call to action for an action
    the visitor has not started; filling it the moment their first character
    lands makes the button mean "this will send" instead of "this is a button".
    Disabled-and-dimmed said the same thing at 40% opacity, which on a
    translucent surface over an unknown host page is not reliably legible.

  • `aria-keyshortcuts` states the Enter binding rather than leaving it to be
    discovered. A textarea that submits on Enter is a surprise worth declaring,
    and a placeholder cannot carry it (it disappears the moment they type).
-->
<script lang="ts">
  import { autosize } from '../lib/composer/autosize';
  import { filesFromPaste } from '../lib/composer/paste-file';

  let {
    isStreaming = false,
    placeholder = 'Ask about this site…',
    variant = 'panel',
    onSend,
    onStop,
  }: {
    isStreaming?: boolean;
    placeholder?: string;
    /** 'panel' draws its own boxed surface; 'bare' is chromeless for hosts
     *  that already ARE the surface (the docked bar — the pill is the chrome,
     *  the input inside it draws none). */
    variant?: 'panel' | 'bare';
    onSend: (text: string) => void;
    onStop: () => void;
  } = $props();

  let value = $state('');
  let el: HTMLTextAreaElement | null = $state(null);
  const canSend = $derived(value.trim().length > 0 && !isStreaming);

  export function focus() {
    el?.focus();
  }

  /** Hand the visitor a starting sentence without sending it (2026-08-19).
   *  Used when a Home starter or an unanswered Help search opens the
   *  conversation: the point is to save typing, so it must stay editable and
   *  must never overwrite something they have already begun writing. */
  export function prefill(text: string) {
    if (!text || value.trim()) return;
    value = text;
    queueMicrotask(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    });
  }

  function submit() {
    if (!canSend) return;
    onSend(value.trim());
    value = '';
    // Reset the textarea height after clearing.
    if (el) {
      el.style.height = 'auto';
      el.focus();
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function onPaste(e: ClipboardEvent) {
    // v1 has no upload wire; just prevent binary blobs from landing as text.
    if (filesFromPaste(e).length > 0) e.preventDefault();
  }
</script>

<form class="composer" class:bare={variant === 'bare'} onsubmit={(e) => { e.preventDefault(); submit(); }}>
  <textarea
    bind:this={el}
    bind:value
    use:autosize
    rows="1"
    {placeholder}
    onkeydown={onKeydown}
    onpaste={onPaste}
    aria-label="Message"
    aria-keyshortcuts="Enter"
  ></textarea>
  {#if isStreaming}
    <button type="button" class="send stop" onclick={onStop} aria-label="Stop">
      <span class="stop-icon"></span>
    </button>
  {:else}
    <button type="submit" class="send" class:ready={canSend} disabled={!canSend} aria-label="Send">
      <!-- ArrowUp — the paw-os send affordance (matches ChatPill / ChatInput). -->
      <svg
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        stroke-width="2.25"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m5 12 7-7 7 7" />
        <path d="M12 19V5" />
      </svg>
    </button>
  {/if}
</form>

<style>
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 8px 8px 8px 6px;
    border: 1px solid var(--pawbar-border);
    border-radius: 24px;
    background: var(--pawbar-surface-sunken);
  }
  .composer:focus-within {
    border-color: color-mix(in oklab, var(--pawbar-ring) 70%, transparent);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--pawbar-ring) 28%, transparent);
  }
  /* Chromeless variant: the host (the docked pill bar) is the surface, and it
     draws the focus ring for the whole pill. */
  .composer.bare,
  .composer.bare:focus-within {
    border: none;
    background: none;
    box-shadow: none;
    padding: 0;
  }
  textarea {
    flex: 1;
    resize: none;
    border: none;
    outline: none;
    background: none;
    color: var(--pawbar-fg);
    font: inherit;
    font-size: 15px;
    line-height: 1.5;
    max-height: 160px;
    padding: 7px 4px 7px 10px;
  }
  textarea::placeholder {
    color: var(--pawbar-fg-muted);
  }
  .send {
    flex: none;
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--pawbar-border);
    /* paw-os language: send is a CIRCLE (ChatPill / ChatInput rounded-full). */
    border-radius: 50%;
    cursor: pointer;
    background: color-mix(in oklab, var(--pawbar-fg) 7%, transparent);
    color: var(--pawbar-fg-muted);
    transition:
      background var(--pawbar-duration-fast) var(--pawbar-ease),
      color var(--pawbar-duration-fast) var(--pawbar-ease),
      border-color var(--pawbar-duration-fast) var(--pawbar-ease);
  }
  /* It fills the moment there is something to send. Colour is the signal, not
     opacity: a 40%-alpha glyph on a translucent surface over an unknown host
     page is not reliably legible, and "greyed out" is a guess where "quiet
     circle vs. accent circle" is a statement. */
  .send.ready {
    background: var(--pawbar-accent);
    border-color: transparent;
    color: var(--pawbar-accent-fg);
  }
  .send:disabled {
    cursor: default;
  }
  .send:focus-visible {
    outline: 2px solid var(--pawbar-ring);
    outline-offset: 2px;
  }
  .send.stop {
    background: color-mix(in oklab, var(--pawbar-fg) 14%, transparent);
    border-color: transparent;
    color: var(--pawbar-fg);
  }
  .stop-icon {
    width: 11px;
    height: 11px;
    border-radius: 3px;
    background: currentColor;
  }
  /* Keyed on the POINTER, not on width. This composer lives inside a
     content-sized iframe, so a width query measures the box the widget drew
     for itself — the 360px bar matched "≤640px" on a 1280px desktop, meaning
     every desktop got the phone treatment. Both rules here are about a finger
     on glass (a bigger tap target, and 16px type because that is the threshold
     under which iOS Safari zooms the page on focus), so asking about the
     pointer is both correct and size-independent. */
  @media (hover: none) and (pointer: coarse) {
    .send {
      width: 32px;
      height: 32px;
    }
    textarea {
      font-size: 16px; /* 16px stops iOS Safari's focus auto-zoom */
    }
  }
</style>
