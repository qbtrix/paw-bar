// lib/spec-manifest.ts — what the agent is told the Paw Bar can draw.
// Created 2026-09-27.
//
// One entry per widget in components/spec-widgets/registry.ts, in the shape of
// Ripple's manifest entries. The atoms (text, heading, badge, button, flex) come
// straight from Ripple's SLIM_WIDGETS, so the bar and Ripple can't describe
// them differently; product-card and form are the bar's own. buildPawBarManifest() wraps them with
// @ripple-ui/core/manifest's buildSlimManifest: the spec envelope, and only the
// actions the bar actually honours. Of the slim runtime's actions the bar keeps
// the local ones (set, toggle, push, remove, open) and `emit`; it ignores
// navigate, toast, pin and unpin (SpecCard.svelte), so the agent isn't offered
// them. The generated JSON is committed as pawbar-manifest.json (bun run
// manifest) for the backend to hand the agent; tests/spec-widgets.spec fails if
// the file, this list, or the registry drift apart.
//
// Not imported by the app bundle: only the build script and tests use it.

import { buildSlimManifest, SLIM_WIDGETS, type SlimManifest, type SlimWidgetEntry } from '@ripple-ui/core/manifest';

const text = (description: string, required = false) => ({ type: 'string', required, description });

export const PAWBAR_ACTIONS = ['set', 'toggle', 'push', 'remove', 'open', 'emit'] as const;

/** The bar's own widgets, beyond Ripple's standard slim atoms. */
const BAR_WIDGETS: SlimWidgetEntry[] = [
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

/** Everything the bar draws: Ripple's standard atoms, then the bar's own. */
export const PAWBAR_WIDGETS: SlimWidgetEntry[] = [...SLIM_WIDGETS, ...BAR_WIDGETS];

/** The manifest the agent reads when it writes a spec for the Paw Bar. */
export function buildPawBarManifest(): SlimManifest {
  return buildSlimManifest({ widgets: PAWBAR_WIDGETS, actions: PAWBAR_ACTIONS });
}
