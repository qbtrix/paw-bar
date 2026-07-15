// paste-file.ts — Pull File objects out of a clipboard paste event. Dep-free
// composer util (severable core of paw-enterprise's paste-as-file handler).
// Created 2026-07-15 (A3 glass bar). v1 concierge has no upload wire yet, so the
// Composer only uses this to intercept an image/file paste and avoid dumping a
// base64 blob into the textarea — the returned Files are surfaced to the caller
// for a future attach flow (owner-mode wave). Returns [] for a plain text paste.

export function filesFromPaste(e: ClipboardEvent): File[] {
  const dt = e.clipboardData;
  if (!dt) return [];
  const files: File[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}
