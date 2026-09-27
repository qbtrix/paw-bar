/// <reference types="vitest/config" />
// vite.config.ts — Build + test config for the glass concierge iframe app.
// 2026-09-27 (new bar): `__PAWBAR_GLASS__` is a build-time literal from
// VITE_PAWBAR_UI, so the default bundle carries only the new bar and a glass
// build only reaches the old shell; inlineDynamicImports keeps that one file.
// Created 2026-07-15 (A3): emits a SINGLE, un-hashed JS + CSS pair
// (pawbar.js / pawbar.css) so the backend-served frame HTML can reference the
// bundle by a stable name. cssCodeSplit off + no manualChunks keeps it to one
// chunk each; marked + dompurify bundle INTO the app chunk (never a loader).
// Vitest runs under jsdom so DOMPurify.sanitize() and the runes store have a
// window; the pure sse parser runs there too with no DOM deps.
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// No Node typings in this project; the config still runs under Node.
function buildEnv(name: string): string | undefined {
  return (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[name];
}

export default defineConfig(({ mode }) => ({
  plugins: [svelte()],
  // Which widget the bundle carries (2026-09-27). Default: the new bar only.
  // VITE_PAWBAR_UI=glass builds the old GlassShell instead (see main.ts). A
  // literal, so the unused shell is dropped from the bundle, not just skipped.
  define: { __PAWBAR_GLASS__: JSON.stringify(buildEnv('VITE_PAWBAR_UI') === 'glass') },
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    sourcemap: true,
    rollupOptions: {
      output: {
        // Stable filenames the frame HTML can hard-reference; no content hash.
        entryFileNames: 'pawbar.js',
        assetFileNames: (asset) =>
          asset.names?.some((n) => n.endsWith('.css')) ? 'pawbar.css' : 'assets/[name][extname]',
        manualChunks: undefined,
        // One file, always: the frame loads pawbar.js by name, so the glass
        // build's lazy import of the old shell is folded back into it.
        inlineDynamicImports: true,
      },
    },
  },
  // Component tests mount real components, so under test Svelte must resolve to
  // its CLIENT build. Without this vitest picks svelte/index-server.js and every
  // mount() throws lifecycle_function_unavailable — which is why this app
  // shipped with zero component tests and a render-time crash nobody caught.
  // Scoped to `mode === 'test'` so the production build is untouched.
  resolve: mode === 'test' ? { conditions: ['browser'] } : {},
  test: {
    environment: 'jsdom',
    // *.spec.svelte.ts is compiled by vite-plugin-svelte as a runes module, so
    // a component test can hold $state props and drive a real prop update the
    // way the app does. Plain .spec.ts cannot — runes are a compiler feature.
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.svelte.ts'],
    // jsdom has no ResizeObserver, and both size-sensitive components need one
    // to mount at all. The stub is drivable rather than a no-op — see the note
    // in tests/setup.ts for why that distinction decides whether the tests of
    // those components mean anything.
    setupFiles: ['tests/setup.ts'],
    // Vitest disables CSS processing by default, which makes every stylesheet
    // read as an empty string — `?raw`, `?inline` and a plain import alike. The
    // white-label guard in tests/theming.spec.ts asserts on tokens.css, and
    // without this it would have passed by reading nothing at all.
    css: true,
  },
}));
