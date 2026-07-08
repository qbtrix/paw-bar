<!-- Renamed 2026-07-08 to Paw Bar. Package name is now paw-bar-widget; host attribute data-paw-bar; global window.PawBar. -->

# Paw Bar

Embeddable customer-facing widget for Paw OS pockets. The frontend side of the full-stack decision loop Palantir cannot offer: events on a brand-embedded widget flow into a Pocket, Instinct nudges the owner, approved actions flow back.

## Target

- Zero framework dependencies.
- Under 10 KB gzipped, enforced by `scripts/check-size.mjs`.
- Mounts on every `[data-paw-bar]` element in the DOM at `DOMContentLoaded`.

## Usage

```html
<script src="https://pp.pocketpaw.dev/widget.js"></script>
<div data-paw-bar="pp_your_widget_id"
     data-endpoint="https://runtime.pocketpaw.dev/api/v1"></div>
```

Point `data-endpoint` at your paw-runtime install. Omit it in production and the bundle falls back to the default host.

### Lifecycle events

The host element emits native `CustomEvent`s that embedders can listen for:

- `pp.ready` — spec loaded and DOM rendered.
- `pp.event` — a user action (button click, form submit) was accepted by the server. `detail.result.fabric_object_id` is set when an `event_mapping` turned it into a Fabric object.
- `pp.error` — spec load or event post failed. `detail.reason` holds the message.

## Development

```bash
bun install        # or npm install
bun run build      # produces dist/widget.js
bun run test:size  # enforces the 10KB gzipped budget
bun run test       # Playwright integration tests
```

Playwright serves `tests/fixtures/` over HTTP and mocks the paw-runtime API, so you do not need the full stack running locally to iterate on the bundle.

## Security

- `customer_ref` is a SHA-256 hash of a random seed stored in `localStorage`. No email, no IP, no PII.
- Widget never uses `innerHTML` with spec-provided content. All strings land via `textContent`. Images require `http:` or `https:` URLs; other schemes are rejected.
- Button `href` values are URL-validated before opening in a new tab with `noopener,noreferrer`.
- The server enforces the origin allowlist + rate limits; the client is a renderer, not a security boundary.

## License

See LICENSE.
