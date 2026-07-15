<!--
  Composer.svelte — Lean Svelte 5 composer host (~100 lines). Created 2026-07-15
  (A3 glass bar). Rebuilt fresh instead of porting paw-enterprise's 1499-line
  ChatInput (5 store couplings). Autosizing textarea, Enter-to-send /
  Shift+Enter-newline, paste-intercept (files surfaced, not dumped as base64),
  and a send button that becomes a Stop button mid-stream. Voice/emoji are
  owner-mode later — out of scope for the concierge visitor face.
  2026-07-15 polish: 15px type, roomier padding, 36px send, softer focus ring
  (45% ring mix — the full-strength ring read as a harsh outline).
-->
<script lang="ts">
  import { autosize } from '../lib/composer/autosize';
  import { filesFromPaste } from '../lib/composer/paste-file';

  let {
    isStreaming = false,
    placeholder = 'Ask about this site…',
    onSend,
    onStop,
  }: {
    isStreaming?: boolean;
    placeholder?: string;
    onSend: (text: string) => void;
    onStop: () => void;
  } = $props();

  let value = $state('');
  let el: HTMLTextAreaElement | null = $state(null);
  const canSend = $derived(value.trim().length > 0 && !isStreaming);

  export function focus() {
    el?.focus();
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

<form class="composer" onsubmit={(e) => { e.preventDefault(); submit(); }}>
  <textarea
    bind:this={el}
    bind:value
    use:autosize
    rows="1"
    {placeholder}
    onkeydown={onKeydown}
    onpaste={onPaste}
    aria-label="Message"
  ></textarea>
  {#if isStreaming}
    <button type="button" class="send stop" onclick={onStop} aria-label="Stop">
      <span class="stop-icon"></span>
    </button>
  {:else}
    <button type="submit" class="send" disabled={!canSend} aria-label="Send">
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
        <path d="M4 12l15-7-6 7 6 7-15-7z" fill="currentColor" />
      </svg>
    </button>
  {/if}
</form>

<style>
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--pawbar-border);
    border-radius: 16px;
    background: var(--pawbar-surface-strong);
  }
  .composer:focus-within {
    border-color: var(--pawbar-ring);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--pawbar-ring) 45%, transparent);
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
    padding: 6px 4px 6px 8px;
  }
  textarea::placeholder {
    color: var(--pawbar-fg-muted);
  }
  .send {
    flex: none;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    background: var(--pawbar-accent);
    color: var(--pawbar-accent-fg);
    transition: opacity 0.15s ease;
  }
  .send:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .send.stop {
    background: color-mix(in oklab, var(--pawbar-fg) 14%, transparent);
    color: var(--pawbar-fg);
  }
  .stop-icon {
    width: 11px;
    height: 11px;
    border-radius: 3px;
    background: currentColor;
  }
</style>
