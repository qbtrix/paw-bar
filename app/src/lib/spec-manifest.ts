// lib/spec-manifest.ts — what the agent is told the Paw Bar can draw.
// Created 2026-09-27.
//
// One entry per widget in components/spec-widgets/registry.ts, in the shape of
// Ripple's manifest entries. buildPawBarManifest() wraps them with
// @ripple-ui/core/manifest's buildSlimManifest: the spec envelope, and only the
// actions the bar actually honours. Of the slim runtime's actions the bar keeps
// the local ones (set, toggle, push, remove, open) and `emit`; it ignores
// navigate, toast, pin and unpin (SpecCard.svelte), so the agent isn't offered
// them. The generated JSON is committed as pawbar-manifest.json (bun run
// manifest) for the backend to hand the agent; tests/spec-widgets.spec fails if
// the file, this list, or the registry drift apart.
//
// Not imported by the app bundle: only the build script and tests use it.

import { buildSlimManifest, type SlimManifest, type SlimWidgetEntry } from '@ripple-ui/core/manifest';

const text = (description: string, required = false) => ({ type: 'string', required, description });

export const PAWBAR_ACTIONS = ['set', 'toggle', 'push', 'remove', 'open', 'emit'] as const;

export const PAWBAR_WIDGETS: SlimWidgetEntry[] = [
  {
    type: 'text',
    category: 'display',
    description: 'A run of plain text. No markdown: put formatting in the reply prose instead.',
    props: {
      content: text('The text.', true),
      tone: { type: '"default" | "muted"', required: false, description: 'muted for secondary lines.' },
    },
    example: { type: 'text', props: { content: 'Ships in 2 working days.' } },
  },
  {
    type: 'heading',
    category: 'display',
    description: 'A short title for a block.',
    props: {
      content: text('The title, under 200 characters.', true),
      level: { type: '2 | 3 | 4', required: false, description: 'Heading level. Default 3.' },
    },
    example: { type: 'heading', props: { content: 'Your options' } },
  },
  {
    type: 'badge',
    category: 'display',
    description: 'A short status label, such as stock or delivery time.',
    props: {
      label: text('Under 80 characters.', true),
      tone: { type: '"neutral" | "success" | "warning" | "danger"', required: false, description: 'Default neutral.' },
    },
    example: { type: 'badge', props: { label: 'In stock', tone: 'success' } },
  },
  {
    type: 'button',
    category: 'input',
    description:
      'A button. on_click runs local actions (set, toggle, ...) or an emit the bar acts on: target "add_to_cart" with value { product_id, qty? }, or target "checkout". Any other emit is ignored.',
    props: {
      label: text('Button text, under 60 characters.', true),
      variant: { type: '"primary" | "secondary"', required: false, description: 'primary for the one main action.' },
      disabled: { type: 'boolean', required: false, description: 'Disable the button.' },
    },
    events: { on_click: { type: 'EventAction', required: false, description: 'Action run on click.' } },
    example: {
      type: 'button',
      props: { label: 'Add to cart', variant: 'primary' },
      on_click: { action: 'emit', target: 'add_to_cart', value: { product_id: 'wetsuit-43' } },
    },
  },
  {
    type: 'stack',
    category: 'layout',
    description: 'Lays its children out in a column (default) or a wrapping row. The only layout widget.',
    props: {
      direction: { type: '"column" | "row"', required: false, description: 'Default column.' },
      gap: { type: '"sm" | "md" | "lg"', required: false, description: 'Default md.' },
      align: { type: '"start" | "center" | "end"', required: false, description: 'Default start.' },
    },
    example: {
      type: 'stack',
      props: { direction: 'row', gap: 'sm' },
      children: [
        { type: 'badge', props: { label: 'In stock', tone: 'success' } },
        { type: 'text', props: { content: 'Ships tomorrow', tone: 'muted' } },
      ],
    },
  },
  {
    type: 'product-card',
    category: 'commerce',
    description:
      "Products from the site's catalog with add-to-cart and checkout buttons. Give catalog ids only; the server fills in name, price and image.",
    props: {
      ids: { type: 'string[]', required: true, description: 'Catalog product ids, most relevant first.' },
    },
    example: { type: 'product-card', props: { ids: ['wetsuit-43', 'booties-5mm'] } },
  },
  {
    type: 'form',
    category: 'input',
    description:
      'Collects the details a gated action needs, then submits it for the business to approve. verb must be a declared gated action and every field name one of its args.',
    props: {
      verb: text('The gated action, e.g. "book_visit".', true),
      title: text('Short title.'),
      submit_label: text('Button text.'),
      fields: {
        type: 'Array<{ name: string; label: string; type: "text" | "tel" | "email" | "number" | "textarea" }>',
        required: true,
        description: 'At most 8 fields, names unique.',
      },
    },
    example: {
      type: 'form',
      props: {
        verb: 'book_visit',
        title: 'Book a fitting',
        submit_label: 'Request',
        fields: [
          { name: 'name', label: 'Name', type: 'text' },
          { name: 'phone', label: 'Phone', type: 'tel' },
        ],
      },
    },
  },
];

/** The manifest the agent reads when it writes a spec for the Paw Bar. */
export function buildPawBarManifest(): SlimManifest {
  return buildSlimManifest({ widgets: PAWBAR_WIDGETS, actions: PAWBAR_ACTIONS });
}
