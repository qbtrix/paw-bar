<!--
loader/README.md — Created 2026-07-15 (A2). Embed + contract reference for the
Paw Bar glass-bar loader: the tiny script a foreign site pastes in to mount the
glass concierge iframe.
-->

# Paw Bar loader

The ~2KB zero-dependency script a site pastes in to embed the Paw Bar glass
concierge. It creates and sizes the launcher iframe; the glass app renders
**inside** the iframe.

## Embed

```html
<script
  src="https://api.example.com/api/v1/paw-bar/loader.js"
  data-site-key="sk_live_…"
  data-widget-id="w_…"
  data-endpoint="https://api.example.com/api/v1"
  async
></script>
```

| Attribute        | Required | Default                                  |
| ---------------- | -------- | ---------------------------------------- |
| `data-site-key`  | yes      | —                                        |
| `data-widget-id` | yes      | —                                        |
| `data-endpoint`  | no       | the script's own origin + `/api/v1`      |

The loader mounts a fixed, bottom-right iframe pointing at
`{endpoint}/paw-bar/frame?key=…&w=…&po=…`, where `po` is the host page origin the
iframe must post back to.

## postMessage contract

The frame origin = the origin of `data-endpoint`.

- **Inbound (app → loader)** — honoured **only** when `event.origin ===` the
  frame origin **and** `event.source ===` the iframe's `contentWindow`:
  - `{ type: "pawbar:resize", h }` — set the iframe height (clamped to viewport)
  - `{ type: "pawbar:open" }` — expand to the panel box
  - `{ type: "pawbar:close" }` — collapse to the launcher box
- **Outbound (loader → app)** — `targetOrigin` is always pinned to the frame
  origin, never `"*"`.

## Programmatic control

```js
window.PawBar.open();  // expand + forward a pinned pawbar:host-open intent
window.PawBar.close(); // collapse + forward a pinned pawbar:host-close intent
```

## Build & test

```bash
bun run build:loader      # esbuild → loader/dist/loader.js (+ gz size)
bun run size:loader       # fail if > 2KB gzipped
bun run typecheck:loader  # tsc --noEmit
bun run test:loader       # jsdom unit tests (node:test)
```
