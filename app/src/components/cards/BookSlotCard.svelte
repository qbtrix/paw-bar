<!--
  BookSlotCard.svelte — the booking card: the visitor picks one of the offered
  times, checks the prefilled name, email and notes, and taps Confirm. The flow
  (validation, the action call, slot_taken, the booked/requested outcome) is
  BookSlotStore; this file only draws it.

  - The times are a native radio group in a fieldset with a legend, so arrow
    keys move between them and screen readers announce "1 of 3". The radio is
    visually hidden; its label is the pill, and shows focus and selection.
  - Every value is a Svelte text/value binding: the server's labels and the
    prefill are never HTML.
  - Confirm is disabled while a request is in flight. After a success the card
    locks: inputs read-only, the times disabled, and the outcome line replaces
    the button. "Add to calendar" opens in a new tab (the frame has no top
    navigation) with noopener noreferrer.
  - It wears `.form-card`, so inside the bar's thread PawBarFrame's form-card
    styles give it the same look as a form. As with FormCard, the error and
    outcome lines carry no role inside the thread (the thread is the live
    region already).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { BookSlotCard } from '../../lib/booking';
  import { BOOKING_FIELD_MAX } from '../../lib/booking';
  import { BookSlotStore, type BookingField } from '../../store/book-slot.svelte';
  import { useCart } from '../../store/cart.svelte';
  import { inBarThread } from './thread';

  let { card }: { card: BookSlotCard } = $props();
  // Init-capture on purpose: re-seeding on a reparse would clobber typed values.
  const store = new BookSlotStore(
    untrack(() => card),
    useCart(),
  );
  const thread = inBarThread();
  const uid = $props.id();

  const fields: { name: BookingField; label: string; type: 'text' | 'email' | 'textarea' }[] = [
    { name: 'name', label: 'Name', type: 'text' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'notes', label: 'Notes (optional)', type: 'textarea' },
  ];
  const busy = $derived(store.phase === 'submitting');
  const readonly = $derived(store.locked || (thread && busy));
  const duration = $derived(store.session.duration_min ? ` · ${store.session.duration_min} min` : '');

  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    void store.confirm();
  }
</script>

<form class="form-card book-slot" onsubmit={onSubmit} novalidate aria-busy={busy ? 'true' : undefined}>
  <p class="title">{store.session.label}{duration}</p>
  {#if store.notice}
    <p class="notice">{store.notice}</p>
  {/if}
  {#if store.slots.length}
    <fieldset class="slots" disabled={store.locked || busy}>
      <legend class="label">Pick a time</legend>
      {#each store.slots as slot (slot.slot_id)}
        <label class="slot">
          <input
            type="radio"
            name={`${uid}-slot`}
            value={slot.slot_id}
            checked={store.selected === slot.slot_id}
            onchange={() => store.select(slot.slot_id)}
          />
          {#if slot.start}
            <time datetime={slot.start}>{slot.label}</time>
          {:else}
            <span>{slot.label}</span>
          {/if}
        </label>
      {/each}
    </fieldset>
  {/if}
  {#each fields as field, i (field.name)}
    {@const fieldError = store.fieldErrors[field.name]}
    <label class="field">
      <span class="label">{field.label}</span>
      {#if field.type === 'textarea'}
        <textarea
          rows="2"
          maxlength={BOOKING_FIELD_MAX[field.name]}
          {readonly}
          aria-invalid={fieldError ? 'true' : undefined}
          aria-describedby={fieldError ? `${uid}-e${i}` : undefined}
          value={store.values[field.name]}
          oninput={(e) => store.setValue(field.name, e.currentTarget.value)}
        ></textarea>
      {:else}
        <input
          type={field.type}
          maxlength={BOOKING_FIELD_MAX[field.name]}
          required={field.name === 'email'}
          {readonly}
          aria-invalid={fieldError ? 'true' : undefined}
          aria-describedby={fieldError ? `${uid}-e${i}` : undefined}
          value={store.values[field.name]}
          oninput={(e) => store.setValue(field.name, e.currentTarget.value)}
        />
      {/if}
      {#if fieldError}
        <span class="error field-error" id={`${uid}-e${i}`}>{fieldError}</span>
      {/if}
    </label>
  {/each}
  {#if store.error}
    <p class="error" role={thread ? undefined : 'alert'}>{store.error}</p>
  {/if}
  {#if store.phase === 'booked'}
    <p class="sent" role={thread ? undefined : 'status'}>
      ✓ Booked for {store.bookedLabel}
      {#if store.icsUrl}
        · <a class="ics" href={store.icsUrl} target="_blank" rel="noopener noreferrer"
          >Add to calendar<span class="visually-hidden"> (opens in a new tab)</span></a
        >
      {/if}
    </p>
  {:else if store.phase === 'requested'}
    <p class="sent" role={thread ? undefined : 'status'}>{store.message}</p>
  {:else if store.slots.length}
    <button type="submit" class="submit" disabled={busy}>{busy ? 'Booking…' : 'Confirm'}</button>
  {/if}
</form>

<style>
  .book-slot {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 8px 0;
    padding: 12px;
    border: 1px solid var(--pawbar-border);
    border-radius: var(--pawbar-radius-md);
  }
  .title,
  .notice,
  .sent,
  .error {
    margin: 0;
  }
  .title {
    font-weight: 600;
  }
  .notice,
  .error {
    font-size: 12.5px;
  }
  .error {
    color: var(--pawbar-danger, #e5484d);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label {
    font-size: 12px;
  }
  .slots {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .slots legend {
    margin-bottom: 6px;
    padding: 0;
  }
  .slot {
    position: relative;
    padding: 6px 10px;
    border: 1px solid var(--pawbar-thread-line, color-mix(in oklab, currentColor 20%, transparent));
    border-radius: min(var(--pawbar-radius, 8px), 8px);
    font-size: 12.5px;
    cursor: pointer;
  }
  .slot:has(input:checked) {
    border-color: transparent;
    background: var(--pawbar-accent, var(--pawbar-bubble-bg, rgb(255 255 255 / 0.86)));
    color: var(--pawbar-accent-fg, var(--pawbar-bubble-fg, #1c1c21));
  }
  .slot:has(input:focus-visible) {
    outline: 2px solid var(--pawbar-ring, var(--pawbar-accent, currentColor));
    outline-offset: 2px;
  }
  .slots:disabled .slot {
    cursor: default;
    opacity: 0.7;
  }
  /* The radio stays in the accessibility tree and takes focus; the label is what shows. */
  .slot input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    pointer-events: none;
  }
  .ics {
    color: inherit;
    text-decoration: underline;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
