<!--
  FormCard.svelte — Native form for a kind:"form" pawbar-card (also the spec
  `form` widget, via SpecForm). The agent emits it instead of asking for
  details in prose; the visitor fills typed inputs and the card runs the action
  directly through the shared cart store transport (structured verb + args —
  never free text into the transcript). Every label, title, prefill and server
  message is a Svelte text or value binding — no HTML injection. The submit
  flow lives in FormCardStore; Esc/blur never clear entered values.

  Two kinds of form:
  - A gated owner action: on ok/pending the card swaps to a quiet sent line and
    nudges the contact prompt (decision-poll machinery). On error the form
    stays editable with values intact.
  - The built-in `send_to_team` lead form: titled "Send this to the team?" by
    default, per-field errors (aria-invalid + aria-describedby), and on success
    the form stays visible but locked read-only under the server's message.

  Inside the bar's thread (inBarThread): inputs go readonly (not disabled, so
  values stay readable) and the form aria-busy while it submits, a failed
  submit focuses the first bad field, and the sent/error lines carry no role,
  because the thread is the bar's one live region and already announces
  additions. The look comes from PawBarFrame (`.frame :global(.form-card …)`).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { PawBarCard } from '../../lib/cards';
  import { FormCardStore } from '../../store/form-card.svelte';
  import { useCart } from '../../store/cart.svelte';
  import { useContact } from '../../store/contact.svelte';
  import { inBarThread } from './thread';

  let { card }: { card: PawBarCard } = $props();
  const cart = useCart();
  const contact = useContact();
  // Init-capture on purpose (untrack): a completed fence's card is stable, and
  // re-seeding the store on a reparse would clobber the visitor's typed values.
  const form = new FormCardStore(
    untrack(() => card),
    cart,
    () => void contact?.maybeOffer(),
  );

  const thread = inBarThread();
  let formEl: HTMLFormElement | undefined = $state();

  const uid = $props.id();

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    await form.submit();
    const flagged = Object.keys(form.fieldErrors);
    if (!thread || (!form.error && flagged.length === 0) || !formEl) return;
    // Focus the first field the visitor has to fix (or the first field when
    // the server refused the whole thing).
    const bad = card.fields?.findIndex((f) => (form.isLead ? flagged : form.missing).includes(f.name)) ?? -1;
    formEl.querySelectorAll<HTMLElement>('input, textarea')[Math.max(0, bad)]?.focus();
  }
  const busy = $derived(form.phase === 'submitting');
  const locked = $derived(form.isLead && form.phase === 'sent');
  const readonly = $derived(locked || (thread && busy));
  const title = $derived(card.title || (form.isLead ? 'Send this to the team?' : ''));
</script>

{#if form.phase === 'sent' && !form.isLead}
  {#if thread}
    <p class="sent">✓ Sent. We'll take it from here.</p>
  {:else}
    <p class="sent" role="status">Sent for review — the team will confirm.</p>
  {/if}
{:else}
  <form class="form-card" bind:this={formEl} onsubmit={onSubmit} novalidate aria-busy={thread && busy ? 'true' : undefined}>
    {#if title}
      <p class="title">{title}</p>
    {/if}
    <!-- Index, not field.name: the name is MODEL-EMITTED JSON, and a repeated
         key throws at render. lib/cards refuses a card whose field names
         collide (an ambiguous submission body is worse than no card), so this
         is the second line rather than the only one. -->
    {#each card.fields ?? [] as field, i (i)}
      {@const fieldError = form.fieldErrors[field.name]}
      <label class="field">
        <span class="label">{field.label}</span>
        {#if field.type === 'textarea'}
          <textarea
            rows="3"
            maxlength={form.maxFor(field.name)}
            {readonly}
            aria-invalid={fieldError ? 'true' : undefined}
            aria-describedby={fieldError ? `${uid}-e${i}` : undefined}
            value={form.values[field.name] ?? ''}
            oninput={(e) => form.setValue(field.name, e.currentTarget.value)}
          ></textarea>
        {:else}
          <input
            type={field.type}
            maxlength={form.maxFor(field.name)}
            {readonly}
            aria-invalid={fieldError ? 'true' : undefined}
            aria-describedby={fieldError ? `${uid}-e${i}` : undefined}
            value={form.values[field.name] ?? ''}
            oninput={(e) => form.setValue(field.name, e.currentTarget.value)}
          />
        {/if}
        {#if fieldError}
          <span class="error field-error" id={`${uid}-e${i}`}>{fieldError}</span>
        {/if}
      </label>
    {/each}
    {#if form.error}
      <p class="error" role={thread ? undefined : 'alert'}>{form.error}</p>
    {/if}
    {#if locked}
      <p class="sent" role={thread ? undefined : 'status'}>✓ {form.sentMessage}</p>
    {:else}
      <button type="submit" class="submit" disabled={form.phase === 'submitting'}>
        {form.phase === 'submitting' ? 'Sending…' : card.submit_label || 'Send'}
      </button>
    {/if}
  </form>
{/if}

<style>
  .form-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 8px 0;
    padding: 12px;
    border: 1px solid var(--pawbar-border);
    border-radius: var(--pawbar-radius-md);
    background: var(--pawbar-assistant-bubble);
  }
  .title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label {
    font-size: 12px;
    font-weight: 500;
    color: var(--pawbar-fg-muted);
  }
  input,
  textarea {
    font: inherit;
    font-size: 13px;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--pawbar-border);
    border-radius: var(--pawbar-radius-xs);
    background: color-mix(in oklab, var(--pawbar-fg) 4%, transparent);
    color: var(--pawbar-fg);
    resize: vertical;
  }
  input:focus,
  textarea:focus {
    outline: none;
    border-color: var(--pawbar-accent);
  }
  .error {
    margin: 0;
    font-size: 12.5px;
    color: var(--pawbar-danger, #e5484d);
  }
  .field-error {
    font-size: 12px;
  }
  .sent {
    margin: 8px 0;
    font-size: 12.5px;
    font-style: italic;
    color: var(--pawbar-fg-muted);
  }
  .submit {
    align-self: flex-start;
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    padding: 7px 14px;
    border-radius: var(--pawbar-radius-xs);
    border: 1px solid transparent;
    background: var(--pawbar-accent);
    color: var(--pawbar-accent-fg);
    cursor: pointer;
    transition: background 0.14s ease, opacity 0.14s ease;
  }
  .submit:hover:not(:disabled) {
    background: color-mix(in oklab, var(--pawbar-accent) 88%, black);
  }
  .submit:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
