/// <reference types="vitest/config" />
// vite.config.ts — Build + test config for the glass concierge iframe app.
// Created 2026-07-15 (A3): emits a SINGLE, un-hashed JS + CSS pair
// (pawbar.js / pawbar.css) so the backend-served frame HTML can reference the
// bundle by a stable name. cssCodeSplit off + no manualChunks keeps it to one
// chunk each; marked + dompurify bundle INTO the app chunk (never a loader).
// Vitest runs under jsdom so DOMPurify.sanitize() and the runes store have a
// window; the pure sse parser runs there too with no DOM deps.
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig(({ mode }) => ({
  plugins: [svelte()],
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
  },
}));
