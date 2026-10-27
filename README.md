<!-- Renamed 2026-07-08 to Paw Bar. Package name is now paw-bar-widget; host attribute data-paw-bar; global window.PawBar.
     2026-09-27: Development now points at app/README.md for the live glass app's dev pages.
     2026-09-27: the old zero-dependency vanilla widget (src/, dist/widget.js) was removed. This README now
     describes the two parts that ship: the loader and the app.      2026-09-27: the security list says markdown renders as a parsed tree, not through DOMPurify.
-->

# Paw Bar

The customer-facing chat bar for sites built on Paw OS. A site owner pastes one
script tag into their page. That script mounts a sandboxed iframe, and the chat
app runs inside it.

## Layout

| Path | What it is |
|---|---|
| [`loader/`](loader/README.md) | The small script a site embeds. It creates the iframe, sizes it, and relays host-page signals. The backend serves the built `loader.js` at `/paw-bar/widget.js`. |
| `actions/` | The opt-in page-actions script a site adds beside the loader (`/paw-bar/actions.js`), so the concierge can guide the visitor and suggest site tools. See [Site tools and WebMCP](#site-tools-and-webmcp). |
| [`app/`](app/README.md) | The Vite + Svelte 5 app inside the iframe (`pawbar.js` / `pawbar.css`). It has its own `package.json` and lockfile. |
| `tests/sandbox/` | Playwright tests of the iframe sandbox against the built loader, in Chromium, Firefox and WebKit. |

## Embed

See [loader/README.md](loader/README.md#embed) for the script tag and its
attributes.

## Site tools and WebMCP

A site can give the concierge actions it may suggest, such as
`request_invitation`. The concierge never runs anything itself. It suggests one
tool with checked args, the visitor sees the site's own description of the tool
and the exact args, and only after Confirm does the page run it, in the
visitor's own session. Results are shown to the visitor and never sent to the
model.

Tools come from two places, both read by `actions.js`:

- `window.pawbarTools`, a queue that works in every browser.
- [WebMCP](https://webmachinelearning.github.io/webmcp/) tools the page
  registered on `document.modelContext`, when the tag has `data-webmcp`.
  WebMCP is in a Chrome origin trial, so most browsers do not have it yet.
  A tool marked `consequentialHint` (payments, account changes, approvals) is
  never offered. A `pawbarTools` tool wins a shared name.

Both take the same tool object, so a site can write it once:

```html
<script src="https://<endpoint>/paw-bar/actions.js" data-webmcp defer></script>
<script>
  const tools = [{ name: 'request_invitation', description: '…', inputSchema: { … }, execute: async (args) => '…' }];
  tools.forEach((t) => document.modelContext?.registerTool(t)); // browser agents
  (window.pawbarTools ||= []).push(...tools);                    // Paw Bar, every browser
</script>
```

Paw Bar takes only flat schemas: an object whose properties are strings,
numbers, integers or booleans, with `description`, `enum`, `minimum`,
`maximum` and `maxLength`. A tool with anything else is dropped with a console
warning. `node app/scripts/webmcp-demo.mjs` (after the builds) runs a WebMCP
tool end to end against a stub `modelContext`.

## Development

Loader, from the repo root:

```bash
bun install --frozen-lockfile
bun run build:loader      # loader/dist/loader.js
bun run typecheck:loader
bun run test:loader       # jsdom tests against the built loader
bun run size:loader       # size budget
bun run test:sandbox      # needs build:loader first, plus Playwright browsers
bun run build:actions && bun run test:actions && bun run size:actions
```

App: see [app/README.md](app/README.md). To work on its UI with no backend, see
[Design without a backend](app/README.md#design-without-a-backend).

CI (`.github/workflows/ci.yml`) runs all of the above, plus a check that no
tracked file has CRLF line endings.

## Security

- The loader sandboxes the iframe and only accepts messages from the frame's
  own origin and window. See [loader/README.md](loader/README.md).
- The app renders agent-written markdown as a parsed tree with text bindings,
  never as an HTML string. See the security note in
  [app/README.md](app/README.md#security-note).
- The server enforces the origin allowlist and rate limits. The client is a
  renderer, not a security boundary.

## License

See LICENSE.
