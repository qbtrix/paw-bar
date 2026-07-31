// sse.ts — Incremental Server-Sent Events frame parser for the concierge chat
// stream. Pure + DOM-free + fetch-free on purpose so it unit-tests in Node
// without a live backend (see tests/sse-parser.spec.ts).
// Ported VERBATIM 2026-07-15 (A3 glass bar) from the frozen widget's
//   feat/paw-bar-chat-ui:src/sse.ts (T4) — already pure + unit-tested; no
//   behavior change. Feed it decoded response chunks via push(); it buffers
//   partial frames across chunk boundaries, normalizes CRLF, splits on the
//   blank-line frame delimiter, and returns complete SseFrames. Matches the
//   wire shape ee/paw_bar/router.py `_sse` writes: `event: <name>\n`, one or
//   more `data: <value>\n`, optional `id:`, `: comment` heartbeats.

export interface SseFrame {
  event: string;
  data: string;
  id?: string;
}

export interface SseParser {
  // Feed one decoded text chunk; returns every frame that completed in it.
  // Partial trailing frames stay buffered until their terminating blank line.
  push(chunk: string): SseFrame[];
}

export function createSseParser(): SseParser {
  let buffer = '';
  return {
    push(chunk: string): SseFrame[] {
      // Normalize CRLF / lone CR to LF so the blank-line split is uniform
      // regardless of how the server terminates its lines (SSE allows any).
      buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const frames: SseFrame[] = [];
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const frame = parseFrame(raw);
        if (frame) frames.push(frame);
        sep = buffer.indexOf('\n\n');
      }
      return frames;
    },
  };
}

// Parse a single frame block (no trailing blank line) into an SseFrame, or null
// when the block carries no data (a bare `: ping` heartbeat or a comment-only
// block dispatches nothing per the SSE spec).
function parseFrame(raw: string): SseFrame | null {
  let event = 'message';
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue; // blank / comment (ping)
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1); // strip one leading space

    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
    else if (field === 'id') id = value;
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n'), id };
}
