<!-- README.md — glass concierge app. Created 2026-07-15 (A3). Documents the
     boot contract, build output, and commands for the loader (A2) + frame
     endpoint (A1) + smoke (A4) that integrate with this bundle. -->

# Paw Bar — Glass Concierge (`app/`)

A self-contained Vite + Svelte 5 SPA that renders inside an iframe and streams a
grounded, markdown-rich concierge chat from `/paw-bar/chat`. This is the
**visitor** face (concierge mode); owner/manager mode is a later wave.

It lives in `app/` beside the **frozen** vanilla widget in `../src` (untouched):
own `package.json`, own lockfile, own `node_modules`/`dist` (git-ignored).

## Boot contract

The serving frame HTML (backend endpoint, A1) sets a global **before** this
bundle loads:

```js
window.__PAWBAR__ = {
  siteKey: string,        // signed_key for POST /paw-bar/chat
  widgetId: string,
  endpoint: string,       // REST base, e.g. "http://localhost:8888/api/v1"
  parentOrigin: string,   // exact host origin; postMessage targetOrigin is pinned to this
  mode: "concierge",
  tokens?: Record<string,string>, // white-label --pawbar-* overrides
  theme?: "light" | "dark",       // default "dark"
};
```

With no global (plain `vite dev`) it falls back to localhost dev defaults — a
real streamed reply still needs a running backend (that's the A4 smoke).

### postMessage lifecycle (app → loader)

The app owns the panel content; the loader owns the launcher chrome + iframe
sizing. The app posts (targetOrigin pinned to `parentOrigin`, never `*`):

- `{ type: "pawbar:resize", h }` — on every shell size change (ResizeObserver)
- `{ type: "pawbar:open" }` — pill → bar/panel
- `{ type: "pawbar:close" }` — collapsed back to the pill

## Build output

`bun run build` emits stable, un-hashed names the frame HTML can hard-reference:

- `dist/pawbar.js` — the single app chunk (Svelte + marked + dompurify + app)
- `dist/pawbar.css` — the single stylesheet

First-paint budget: **`pawbar.js` ≤ 80KB gz** (CI-enforced via `bun run size`).
Current: ~41KB gz.

## Commands

```bash
bun install
bun run dev      # dev harness (stubbed __PAWBAR__) at http://localhost:5173
bun run build    # emit dist/pawbar.{js,css}
bun run size     # enforce the ≤80KB gz main-chunk budget
bun run test     # vitest: sse parser, DOMPurify allowlist pin, store flow + stop()
bun run check    # svelte-check (types + a11y)
```

## Action loop (C2) — cards + cart + checkout

Replies can carry a fenced `pawbar-card` block the app intercepts **before**
markdown render and renders as native glass components (Svelte props only — the
DOMPurify path is untouched):

````
```pawbar-card
{"kind":"product","items":[{"id":"espresso","name":"Espresso",
 "price_cents":350,"currency":"USD","image_url":"","actions":["add_to_cart"]}]}
```
````

A CTA click posts a **structured action event** (never free text) to the action
endpoints and adopts the server's cart; checkout is a **handoff** to the site's
real checkout (opened in the click gesture) — the app never executes payment.

- `POST {endpoint}/paw-bar/action` — body `{key, w, customer_ref, verb, args}` → `{ok, result, cart?}`
- `GET {endpoint}/paw-bar/cart` — query `key, w, customer_ref` → `{items, total_cents, currency, checkout_url}`

`verb` is allowlisted per widget and server-validated. `add_to_cart`/`checkout`
are `auto`; gated verbs (e.g. `book_table`) become owner approvals server-side.
Card parsing/validation lives in `src/lib/cards.ts`; transport in
`src/lib/action-client.ts`; the cart runes store in `src/store/cart.svelte.ts`
(provided to card CTAs via Svelte context). A malformed/truncated card, or an
unknown `kind`, renders a quiet "card unavailable" line — never raw JSON. An
in-flight (still-streaming) card fence shows the shimmer placeholder until it
closes.

## Security note

`pawbar.js` sanitizes **agent-authored** markdown on a **public** origin. The
DOMPurify `ALLOWED_TAGS` / `ADD_ATTR` allowlist in `src/lib/markdown.ts` is
copied verbatim from paw-enterprise's `MarkdownRenderer.svelte` and pinned by
`tests/markdown.spec.ts` — any drift fails the test. The only `innerHTML` in the
app is that sanitized output; everything else is a text binding. Action cards are
JSON parsed + validated (`cards.parseCard`) and rendered via props only — no HTML
injection; untrusted `image_url`/`checkout_url` fields are scheme-guarded.
