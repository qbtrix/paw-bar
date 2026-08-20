<!--
  FormCard.svelte — Native glass form for a kind:"form" pawbar-card. Created
  2026-07-30 (form cards). The agent emits this instead of asking for gated-
  action details in prose; the visitor fills typed inputs and the widget runs
  the action DIRECTLY through the shared cart store transport (structured verb
  + args — never free text into the transcript). Every label/title is a Svelte
  text binding — no HTML injection; visitor values live only in the form store
  and the action request body, never in localStorage or markdown. Submit flow
  (FormCardStore): all fields required (v1), values capped at 256; pending →
  button disabled; ok/pending outcome → the card swaps to a quiet confirmation
  line and nudges the contact prompt (existing decision-poll machinery); 4xx →
  inline error, form stays editable with values intact. Esc/blur never clear
  entered values (plain bound state, no reset paths).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { PawBarCard } from '../../lib/cards';
  import { FORM_VALUE_MAX, FormCardStore } from '../../store/form-card.svelte';
  import { useCart } from '../../store/cart.svelte';
  import { useContact } from '../../store/contact.svelte';

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

  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    void form.submit();
  }
</script>

{#if form.phase === 'sent'}
  <p class="sent" role="status">Sent for review — the team will confirm.</p>
{:else}
  <form class="form-card" onsubmit={onSubmit} novalidate>
    {#if card.title}
      <p class="title">{card.title}</p>
    {/if}
    <!-- Index, not field.name: the name is MODEL-EMITTED JSON, and a repeated
         key throws at render. lib/cards refuses a card whose field names
         collide (an ambiguous submission body is worse than no card), so this
         is the second line rather than the only one. -->
    {#each card.fields ?? [] as field, i (i)}
      <label class="field">
        <span class="label">{field.label}</span>
        {#if field.type === 'textarea'}
          <textarea
            rows="3"
            maxlength={FORM_VALUE_MAX}
            value={form.values[field.name] ?? ''}
            oninput={(e) => form.setValue(field.name, e.currentTarget.value)}
          ></textarea>
        {:else}
          <input
            type={field.type}
            maxlength={FORM_VALUE_MAX}
            value={form.values[field.name] ?? ''}
            oninput={(e) => form.setValue(field.name, e.currentTarget.value)}
          />
        {/if}
      </label>
    {/each}
    {#if form.error}
      <p class="error" role="alert">{form.error}</p>
    {/if}
    <button type="submit" class="submit" disabled={form.phase === 'submitting'}>
      {form.phase === 'submitting' ? 'Sending…' : card.submit_label || 'Send'}
    </button>
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
    border-radius: 14px;
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
    border-radius: 9px;
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
    border-radius: 9px;
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
