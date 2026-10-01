// lib/spec-manifest.ts — what the agent is told the Paw Bar can draw.
//
// One entry per widget in components/spec-widgets/registry.ts, in the shape of
// Ripple's manifest entries. The atoms (text, heading, badge, button, flex) come
// straight from Ripple's SLIM_WIDGETS, so the bar and Ripple can't describe
// them differently; product-card, form and book_slot are the bar's own.
// buildPawBarManifest() wraps them with @ripple-ui/core/manifest's
// buildSlimManifest: the spec envelope, and only the actions the bar actually
// honours. Of the slim runtime's actions the bar keeps the local ones (set,
// toggle, push, remove, open) and `emit`; it ignores navigate, toast, pin and
// unpin (SpecCard.svelte), so the agent isn't offered them. The generated JSON
// is committed as pawbar-manifest.json (bun run manifest) for the backend to
// hand the agent; tests/spec-widgets.spec fails if the file, this list, or the
// registry drift apart.
//
// product-card and book_slot are server-hydrated: the agent writes ids, the
// server fills in what the bar draws (items; slots and session type).
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
      'Collects details and submits them. verb is either a declared gated action (every field name one of its args; the business approves it) or "send_to_team": when the visitor shares contact details or asks to be contacted, offer a send_to_team form with fields from name, email, phone, message (email or phone required), prefilled with what they said. Nothing is sent until the visitor taps the button, so never claim it was sent.',
    props: {
      verb: text('A declared gated action, e.g. "book_visit", or "send_to_team".', true),
      title: text('Short title.'),
      submit_label: text('Button text.'),
      fields: {
        type: 'Array<{ name: string; label: string; type: "text" | "tel" | "email" | "number" | "textarea"; value?: string }>',
        required: true,
        description: 'At most 8 fields, names unique. value (optional, at most 500 characters) prefills the field from the conversation; the visitor can edit it.',
      },
    },
    example: {
      type: 'form',
      props: {
        verb: 'send_to_team',
        submit_label: 'Send',
        fields: [
          { name: 'name', label: 'Name', type: 'text', value: 'Priya' },
          { name: 'email', label: 'Email', type: 'email', value: 'priya@example.com' },
          { name: 'message', label: 'Message', type: 'textarea', value: '20 jackets for a team trip' },
        ],
      },
    },
  },
  {
    type: 'book_slot',
    category: 'input',
    description:
      'Books a session in the conversation. Offer it when the visitor leans towards one of the open times in <availability>. Give slot_ids from that block only; the server fills in the times. The visitor picks one and confirms; never claim a session is booked before the card says so.',
    props: {
      session_type: text('The session type id from <availability>.', true),
      slot_ids: { type: 'string[]', required: true, description: '1 to 4 slot ids from <availability>, the best fit first.' },
      name: text("The visitor's name, if they gave it."),
      email: text("The visitor's email, if they gave it."),
      notes: text('What the session is about, in a sentence.'),
    },
    example: { type: 'book_slot', props: { session_type: 'intro-30', slot_ids: ['s1', 's2'], name: 'Priya', email: 'priya@example.com' } },
  },
];

/** Everything the bar draws: Ripple's standard atoms, then the bar's own. */
export const PAWBAR_WIDGETS: SlimWidgetEntry[] = [...SLIM_WIDGETS, ...BAR_WIDGETS];

/** The manifest the agent reads when it writes a spec for the Paw Bar. */
export function buildPawBarManifest(): SlimManifest {
  return buildSlimManifest({ widgets: PAWBAR_WIDGETS, actions: PAWBAR_ACTIONS });
}
