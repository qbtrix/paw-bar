<!-- Renamed 2026-07-08 to Paw Bar. Package name is now paw-bar-widget; host attribute data-paw-bar; global window.PawBar.
     2026-09-27: Development now points at app/README.md for the live glass app's dev pages.
     2026-09-27: the old zero-dependency vanilla widget (src/, dist/widget.js) was removed. This README now
     describes the two parts that ship: the loader and the app. -->

# Paw Bar

The customer-facing chat bar for sites built on Paw OS. A site owner pastes one
script tag into their page. That script mounts a sandboxed iframe, and the chat
app runs inside it.

## Layout

| Path | What it is |
|---|---|
| [`loader/`](loader/README.md) | The small script a site embeds. It creates the iframe, sizes it, and relays host-page signals. The backend serves the built `loader.js` at `/paw-bar/widget.js`. |
| [`app/`](app/README.md) | The Vite + Svelte 5 app inside the iframe (`pawbar.js` / `pawbar.css`). It has its own `package.json` and lockfile. |
| `tests/sandbox/` | Playwright tests of the iframe sandbox against the built loader, in Chromium, Firefox and WebKit. |

## Embed

See [loader/README.md](loader/README.md#embed) for the script tag and its
attributes.

## Development

Loader, from the repo root:

```bash
bun install --frozen-lockfile
bun run build:loader      # loader/dist/loader.js
bun run typecheck:loader
bun run test:loader       # jsdom tests against the built loader
bun run size:loader       # size budget
bun run test:sandbox      # needs build:loader first, plus Playwright browsers
```

App: see [app/README.md](app/README.md). To work on its UI with no backend, see
[Design without a backend](app/README.md#design-without-a-backend).

CI (`.github/workflows/ci.yml`) runs all of the above, plus a check that no
tracked file has CRLF line endings.

## Security

- The loader sandboxes the iframe and only accepts messages from the frame's
  own origin and window. See [loader/README.md](loader/README.md).
- The app sanitizes agent-written markdown with a pinned DOMPurify allowlist.
  See the security note in [app/README.md](app/README.md#security-note).
- The server enforces the origin allowlist and rate limits. The client is a
  renderer, not a security boundary.

## License

See LICENSE.
