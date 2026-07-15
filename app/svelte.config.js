// svelte.config.js — Svelte 5 compiler config for the glass concierge app.
// Created 2026-07-15 (A3): runes mode, vitePreprocess for <style>/TS in .svelte.
// No SvelteKit — this is a plain Vite + Svelte SPA.
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: true,
  },
};
