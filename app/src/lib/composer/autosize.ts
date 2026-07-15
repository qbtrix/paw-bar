// autosize.ts — Grow a <textarea> to fit its content up to a max height, then
// scroll. Dep-free composer util (the severable core of paw-enterprise's
// AutosizeTextarea, rebuilt lean — ChatInput's 1499-line host is NOT ported).
// Created 2026-07-15 (A3 glass bar). Used as a Svelte action: <textarea use:autosize>.
// 2026-07-15: re-measure on width changes via ResizeObserver. The composer can
// mount mid-box-flip (chip→bar while the iframe is still chip-sized): the
// mount-time scrollHeight is then garbage and no input event ever corrects it,
// leaving a max-height bar (the "giant bar" restore bug). Width-gated so the
// observer can't loop on its own height writes.

export function autosize(node: HTMLTextAreaElement, maxHeight = 160) {
  function resize() {
    node.style.height = 'auto';
    const next = Math.min(node.scrollHeight, maxHeight);
    node.style.height = `${next}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }
  resize();
  node.addEventListener('input', resize);
  let lastWidth = -1;
  const ro = new ResizeObserver((entries) => {
    const width = Math.round(entries[0]?.contentRect.width ?? 0);
    if (width !== lastWidth) {
      lastWidth = width;
      resize();
    }
  });
  ro.observe(node);
  return {
    update(nextMax: number) {
      maxHeight = nextMax ?? maxHeight;
      resize();
    },
    destroy() {
      ro.disconnect();
      node.removeEventListener('input', resize);
    },
  };
}
