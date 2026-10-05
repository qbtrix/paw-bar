// lib/live-config.svelte.ts — the boot config as reactive state.
//
// main.ts is plain TypeScript and cannot declare runes, but the owner preview
// changes owner settings after boot (lib/preview-tokens, pawbar:preview-config)
// and BarShell has to redraw from them. Wrapping the config in a deep $state
// proxy here means a write to any field reaches every template that reads it.
// On a public embed nothing ever writes to it, and it behaves as a plain object.

export function liveConfig<T extends object>(config: T): T {
  const live = $state(config);
  return live;
}
