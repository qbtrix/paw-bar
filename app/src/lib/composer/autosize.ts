// autosize.ts — Grow a <textarea> to fit its content up to a max height, then
// scroll. Dep-free composer util (the severable core of paw-enterprise's
// AutosizeTextarea, rebuilt lean — ChatInput's 1499-line host is NOT ported).
// Created 2026-07-15 (A3 glass bar). Used as a Svelte action: <textarea use:autosize>.

export function autosize(node: HTMLTextAreaElement, maxHeight = 160) {
  function resize() {
    node.style.height = 'auto';
    const next = Math.min(node.scrollHeight, maxHeight);
    node.style.height = `${next}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }
  resize();
  node.addEventListener('input', resize);
  return {
    update(nextMax: number) {
      maxHeight = nextMax ?? maxHeight;
      resize();
    },
    destroy() {
      node.removeEventListener('input', resize);
    },
  };
}
