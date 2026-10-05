<!--
loader/README.md — embed and contract reference for the Paw Bar loader: the
small script a site pastes in to mount the concierge iframe, the query flags it
honours, the host-page facts it passes to the frame (scheme, site theme), the
permissions it grants the iframe, and the postMessage contract both ways.
-->

# Paw Bar loader

The zero-dependency script a site pastes in to embed the Paw Bar. It creates
one sandboxed iframe and owns its box (size, position, and the scrim behind an
open panel); the app in `../app` renders **inside** the iframe. It is
size-budgeted: 4KB gzipped (`scripts/check-size.mjs`).

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

The frame URL is
`{endpoint}/paw-bar/frame?key=…&w=…&po=…&s=l|d#t=…`:

- `po` is the host page origin the frame must post back to.
- `s` is the host page's colour scheme: its `color-scheme`, else its background
  luminance, else the visitor's OS preference.
- `#t=` is the **site theme**, base64url JSON, present when anything was
  detected. A fragment never reaches the server, so the frame request stays
  the same URL and nothing about the host page is logged.

The iframe carries `allow="clipboard-write; microphone"`: copy for replies, and
the mic for the bar's dictation button (a cross-origin frame gets neither
otherwise). The visitor's browser still asks before the mic turns on, and a
host page whose `Permissions-Policy` denies `microphone` overrides it. It is
sandboxed (`FRAME_SANDBOX` in `src/loader.ts`) with no top-navigation flag;
the server sends the same flags as a CSP `sandbox` header.

## Site theme

`detectSiteTheme()` reads the host page once with `getComputedStyle` (no
MutationObserver), before the iframe is created, and again on an OS scheme
change and at page `load`. Every facet is optional:

| Facet | Read from (first hit wins) |
|---|---|
| `accent` | `meta[name=theme-color]`; `:root` `--primary`, `--accent`, `--brand`, `--color-primary` and their `-color` / `color-` variants (a bare shadcn `H S% L%` triplet counts); the background of the first visible coloured `button`, `.btn`, `[class*=button]` or `a[class*=btn]`; the first link's colour (not the browser's default blue). Neutral colours (greys, near black or white) and transparent ones are skipped. |
| `bg`, `fg` | computed `body` (then `html`) background-color and color |
| `font` | computed `body` font-family |
| `fontHref` | the first `link[rel=stylesheet][href^="https://fonts.googleapis.com/css"]` |
| `radius` | that button's top-left `border-radius` in px (or the first filled button's), clamped to 0–32; percentages are skipped |

Colours are normalised to `#rrggbb`. The frame validates everything again and
decides how to layer it (see `../app/README.md`, "The bar follows the
website").

## Query flags on the host page

- `?pawbar=off` mounts nothing. The owner's appearance preview frames the real
  site with it, so the public embed doesn't draw a second bar behind the one
  being edited.
- `?pawbar=sniff` also mounts nothing, but posts
  `{ type: "pawbar:site-theme", theme }` to `window.parent` with targetOrigin
  `"*"` (the theme is public CSS facts): once on run, again at page `load`, on an
  OS scheme change, and whenever the parent posts `{ type: "pawbar:sniff" }`
  (checked by `event.source === window.parent`). The owner preview's scene
  iframe uses it to feed the site's look to the bar beside it.

Neither is a security control: hiding a widget on a page you are already
looking at costs nobody anything.

## postMessage contract

The frame origin is the origin of `data-endpoint`.

**Inbound (app → loader)** — honoured **only** when `event.origin ===` the
frame origin **and** `event.source ===` the iframe's `contentWindow`:

| Message | Effect |
|---|---|
| `pawbar:resize` `{h, w?, side?}` | size the docked box (height always, width for the chip); `side` docks an icon launcher in that corner |
| `pawbar:view` `{view: "bar" \| "chip" \| "panel"}` | switch the docked view |
| `pawbar:bar` `{compact, expanded}` | the docked bar's resting-width intent |
| `pawbar:open` / `pawbar:close` | open the panel column (with the scrim) / back to the dock |
| `pawbar:expand` `{on}` | full viewport on/off |
| `pawbar:overlay` `{on}` | an in-frame menu is open: report host-page clicks |
| `pawbar:drag` `{phase, x?, y?}` | move the dock; the new anchor persists in host localStorage |
| `pawbar:dead` | remove the iframe and the scrim |

**Outbound (loader → app)** — `targetOrigin` always pinned to the frame
origin, never `"*"`:

| Message | When |
|---|---|
| `pawbar:viewport` `{w, h}` | frame load and every host resize |
| `pawbar:page` `{url, title}` | frame load and every path/title change (origin + pathname only) |
| `pawbar:scheme` `{s}` | OS scheme change |
| `pawbar:site-theme` `{theme}` | the theme changed since the last one sent (scheme change, page load) |
| `pawbar:box` `{x, y, w, h}` | drag start |
| `pawbar:host-pointerdown` | a host-page click while an overlay is open |
| `pawbar:host-open` / `pawbar:host-close` | `PawBar.open()` / `PawBar.close()`, a scrim press |

## Programmatic control

```js
window.PawBar.open();  // open the panel + forward a pinned pawbar:host-open
window.PawBar.close(); // back to the dock + forward a pinned pawbar:host-close
```

## Build & test

```bash
bun run build:loader      # esbuild → loader/dist/loader.js (+ readable twin, gz size)
bun run size:loader       # fail if over the gzip budget
bun run typecheck:loader  # tsc --noEmit
node --test loader/test/loader.test.mjs   # jsdom unit tests against the built bundle
```
