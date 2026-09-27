<!-- README.md — glass concierge app. Created 2026-07-15 (A3). Documents the
     boot contract, build output, and commands for the loader (A2) + frame
     endpoint (A1) + smoke (A4) that integrate with this bundle.
     2026-09-27: added "Design without a backend", which documents the
     demo.html / host.html dev pages and their ?state= presets.
     2026-09-27 (new bar): bar.html, and scripts/widget-harness.mjs for
     checking the built widget under the real loader.
     2026-09-27 (old shell removed): host.html and demo.html?state=light are
     gone; demo.html now shows the new bar with a fake backend. The note
     about the frozen vanilla widget in ../src is gone with that widget.
     2026-09-27 (native markdown): marked and DOMPurify no longer ship; the
     build-output line, the test list and the security note describe the
     parsed-tree renderer in src/lib/md/ instead.
     2026-09-27 (spec renderer): added "Drawing a Ripple spec", covering
     components/spec/ and the vendored @ripple-ui/core tarball.
     2026-09-27 (slim runtime): the renderer runs on
     @ripple-ui/core/headless/slim; sizes updated.
     2026-09-27 (after the native markdown renderer merged): sizes re-measured;
     no budget change is needed; the tarball is packed from ripple-iui main.
     2026-09-27 (spec cards): "Generated UI in the thread" documents spec
     cards, the widgets and pawbar-manifest.json; @ripple-ui/core is now the
     v0.8.0 release asset (core 0.6.0). -->

# Paw Bar — Glass Concierge (`app/`)

A self-contained Vite + Svelte 5 SPA that renders inside an iframe and streams a
grounded, markdown-rich concierge chat from `/paw-bar/chat`. This is the
**visitor** face (concierge mode); owner/manager mode is a later wave.

It has its own `package.json`, own lockfile, own `node_modules`/`dist`
(git-ignored). The embed script that mounts it is in `../loader`.

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
real streamed reply still needs a running backend (that's the A4 smoke). To
work on the UI with no backend at all, use the demo pages below.

### postMessage lifecycle (app → loader)

The app owns the panel content; the loader owns the launcher chrome + iframe
sizing. The app posts (targetOrigin pinned to `parentOrigin`, never `*`):

- `{ type: "pawbar:resize", h }` — on every shell size change (ResizeObserver)
- `{ type: "pawbar:open" }` — pill → bar/panel
- `{ type: "pawbar:close" }` — collapsed back to the pill

## Build output

`bun run build` emits stable, un-hashed names the frame HTML can hard-reference:

- `dist/pawbar.js` — the single app chunk (Svelte + app; no markdown or sanitizer library)
- `dist/pawbar.css` — the single stylesheet

First-paint budget: **`pawbar.js` ≤ 80KB gz** (CI-enforced via `bun run size`).
Current: ~41KB gz.

## Commands

```bash
bun install
bun run dev      # dev harness (stubbed __PAWBAR__) at http://localhost:5173
bun run build    # emit dist/pawbar.{js,css}
bun run size     # enforce the ≤80KB gz main-chunk budget
bun run test     # vitest: sse parser, markdown security + parity with the old renderer, store flow + stop()
bun run check    # svelte-check (types + a11y)
```

## Design without a backend

`bun run dev` also serves two dev-only pages. Vite's build entry is
`index.html`, so neither ships. `demo.html` stubs `fetch` before the app boots
and answers with the shapes the router really returns, SSE frames included,
so every surface can be designed with no server running.

```bash
cd app
bun install --frozen-lockfile
bun run dev
```

| URL | What you get |
|---|---|
| `localhost:5173/demo.html` | The bar through the real `main.ts` boot, with `fetch` stubbed. Streamed replies (with code and sources), the conversation list, the cart and an owner reply all work with no server. |
| `demo.html?state=thread` | Opens straight into a populated conversation |
| `demo.html?state=cart` | Items in the cart, so the checkout controls show |
| `demo.html?state=long` | A very long streamed reply, for layout and scrolling |
| `localhost:5173/bar.html` | The new Paw Bar on its own, with a control strip for launcher, size, theme and corners, and a "Next reply" picker that fakes every reply type and failure. |

Run `bun run dev` from `app/`, not the repo root. The root `package.json` has
no `dev` script. Edits hot-reload in these pages.

To see the bar under the real loader, build both halves
(`node loader/build.mjs` at the root, `npx vite build` here), then run
`node scripts/widget-harness.mjs` from `app/`. It serves the real loader on a
fake customer page and the real app in its sandboxed frame, with a fake
backend, and prints the iframe's box at each step. `SCEN=` picks a scenario
(`main`, `icon`, `phone`, `consent`, `leave`, `viewport`, `grow`). The script
header explains each one. Anything that touches sizing or the loader protocol
should pass it: jsdom has no layout, so the unit tests can't see the iframe.

## Action loop (C2) — cards + cart + checkout

Replies can carry a fenced `pawbar-card` block the app intercepts **before**
markdown parsing and renders as native glass components (Svelte props only):

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

## Drawing a Ripple spec

`src/components/spec/` draws a Ripple spec (`{ ui, state?, theme? }`) with
components the app passes in, keyed by spec `type`. Ripple's slim headless
runtime (`@ripple-ui/core/headless/slim`) resolves expressions, `show`, `if`
and `each`, holds state and runs `set`, `toggle`, `push`, `remove` and `open`;
`SpecRenderer.svelte` and `SpecNode.svelte` only draw the result. Host actions
(`emit`, `navigate`, `toast`, `pin`, `unpin`) go to `onEvent`, so bar actions
such as add-to-cart arrive as `emit`. Other Ripple actions (`api`, flows,
`animate`) are skipped with a warning. No Ripple widget, stylesheet or schema
is bundled, and `tests/spec-renderer-imports.spec.ts` fails if anything beyond
`svelte`, the slim runtime and that folder gets imported.

```svelte
<SpecRenderer {spec} components={{ text: Text, button: Button }} onEvent={handle} fallback={Unavailable} />
```

- **Props to components** match Ripple's NodeRenderer: resolved props, `id`,
  `class`, `style`, the bound value and `name` for a bound node, `on*`
  handlers, `hasChildren`, and one snippet per non-empty slot.
- **Styling:** the spec's `theme` becomes CSS variables on the root, named as
  Ripple names them (`--primary`, `--radius`, `--ripple-font-sans`, ...), and
  `mode` becomes `data-mode`. Node `class` and `style` go to the component.
  Spec CSS is agent-written, so `components/spec/style.ts` drops anything that
  could load a resource or escape its declaration. The host's own `class` and
  `style` on the root are applied last and win.
- **Failures:** a type with no component, or a component that throws, draws
  `fallback` for that node only.
- **Size:** with the renderer and the widgets below wired in, `pawbar.js` is
  70.6 KB gzipped (measured 2026-09-27), inside the 80 KB budget.

`@ripple-ui/core` is not on npm, so it is vendored as
`vendor/ripple-ui-core-0.6.0.tgz`, the asset attached to the ripple-iui
[v0.8.0 release](https://github.com/qbtrix/ripple-iui/releases/tag/v0.8.0):
the slim runtime, the slim manifest, and loop variables in headless handlers.
To update it, download the new release's `ripple-ui-core-<v>.tgz` into
`vendor/` (`gh release download <tag> --repo qbtrix/ripple-iui --pattern
'ripple-ui-core-*.tgz' --dir vendor`), point `package.json` at it, and change
that entry's path and `sha512-` in `bun.lock` by hand. A clean install may reuse
a cached copy of a tarball; `bun pm cache rm` before reinstalling if the
contents look stale. bun keeps the tarball's hash in `bun.lock` and does not refresh it
for a file with the same name, so update that one `sha512-` value by hand
(`openssl dgst -sha512 -binary <tgz> | base64 -w0`) rather than deleting the
entry: a fresh resolve also upgrades unrelated packages.

## Generated UI in the thread

A reply can carry a generated block as a ```` ```pawbar-card ```` fence whose
JSON has a `ui` object: a Ripple spec (`{ ui, state? }`). `CardBlock` sends
those to `components/spec-widgets/SpecCard.svelte`; a fence without `ui` is a
legacy card and is unchanged. This is the interim transport until the typed
part stream exists.

- **Bounds:** `lib/spec-card.ts` refuses a fence over 32,000 characters, a
  tree over 80 nodes or nested deeper than 8, and a malformed tree or state.
  Refused specs show "Card unavailable". The spec's `theme` is dropped: the bar
  keeps the site owner's styling.
- **Widgets** (`components/spec-widgets/registry.ts`): `text`, `heading`,
  `badge`, `button`, `stack`, `product-card` and `form`. `product-card` and
  `form` are the existing `BarCatalog` and `FormCard`, with props validated by
  `lib/cards.parseCard` exactly as for a legacy card. There is no image widget
  on purpose: a model-chosen image is a request fired on render. A type outside
  the registry renders nothing and the rest of the block still draws.
- **Actions:** local actions run inside the spec. Of host events, only two do
  anything: `emit` `add_to_cart` with `{ product_id, qty? }` and `emit`
  `checkout`. Navigate, toast, pin and any other emit are ignored.
- **`product-card` takes catalog ids** in the manifest; the server is meant to
  fill in `items` (name, price, image) from the catalog. Until that backend
  step exists, a `product-card` with ids only shows "Card unavailable" rather
  than trusting model-written prices.
- **Manifest:** `pawbar-manifest.json` is what the agent is told the bar can
  draw: the spec envelope, the six actions the bar honours (`set`, `toggle`,
  `push`, `remove`, `open`, `emit`) and the seven widgets. It is generated from
  `src/lib/spec-manifest.ts` with `@ripple-ui/core/manifest`'s
  `buildSlimManifest` by `bun run manifest`, and committed;
  `tests/spec-widgets.spec.svelte.ts` fails if it is stale or if the manifest
  and the registry list different widgets.

## Security note

`pawbar.js` renders **agent-authored** markdown on a **public** origin, and it
never turns that markdown into an HTML string. `src/lib/md/` parses a reply
into a small tree whose node kinds are the only elements a reply can produce
(`src/lib/md/types.ts`), and `src/components/md/` draws it with text bindings.
Links always open in a new tab with `noopener noreferrer` and keep only
http(s), mailto and tel hrefs (site-relative ones resolve against the host
origin, `src/lib/md/links.ts`); images render as their alt text; the only form
control is a disabled task checkbox. `tests/markdown.spec.ts` renders every
payload the old DOMPurify allowlist was pinned against and asserts the result
stays inside that allowlist, including a fuzz run; `tests/md-parity.spec.ts`
checks realistic replies render exactly as the old marked + DOMPurify path did
(kept as `tests/fixtures/md-oracle.ts`, with both libraries as dev
dependencies); and `tests/no-html-injection.spec.ts` fails if any `{@html}`,
`innerHTML =` or similar sink appears in `src/`. Action cards are
JSON parsed + validated (`cards.parseCard`) and rendered via props only — no HTML
injection; untrusted `image_url`/`checkout_url` fields are scheme-guarded.
