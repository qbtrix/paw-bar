// caret.ts — Insert text at the caret of a <textarea>, preserving the caret
// position after the inserted run. Dep-free composer util (severable core of
// paw-enterprise's caret-insert helper). Created 2026-07-15 (A3 glass bar).
// Returns the new full value so the caller can sync its bound state.

export function insertAtCaret(node: HTMLTextAreaElement, text: string): string {
  const start = node.selectionStart ?? node.value.length;
  const end = node.selectionEnd ?? node.value.length;
  const next = node.value.slice(0, start) + text + node.value.slice(end);
  node.value = next;
  const caret = start + text.length;
  // Restore the caret on the next frame so the DOM value has settled.
  node.setSelectionRange(caret, caret);
  return next;
}
