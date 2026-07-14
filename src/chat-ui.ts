// chat-ui.ts — Concierge chat surface for the Paw Bar widget. Builds a scrolling
// message list + input row entirely with document.createElement and textContent
// (never innerHTML with content), mirroring render.ts's `.style.x =` styling and
// the shared --pp-* theme variables, so the chat is XSS-safe by construction.
// Created: 2026-07-14 (Paw Bar chat UI, T4) — mountConciergeChat(host, config)
//   builds the UI, reuses getCustomerRef() for the anonymous handle, and streams
//   each reply through chat-client.streamConciergeChat into a growing assistant
//   bubble (textContent += delta). Plaintext only — markdown/HTML rendering +
//   sanitization is a deliberate follow-up, so no innerHTML and no markdown lib.

import { streamConciergeChat } from './chat-client';
import { getCustomerRef } from './customer-ref';

export interface ConciergeConfig {
  endpoint: string;
  widgetId: string;
  signedKey: string;
}

const FONT = 'system-ui, sans-serif';

// A single assistant reply that grows as tokens stream in. textContent += keeps
// rendering safe: the browser never parses the deltas as markup.
interface AssistantBubble {
  append(delta: string): void;
  finalize(): void;
  fail(message: string): void;
}

export function mountConciergeChat(host: HTMLElement, config: ConciergeConfig): void {
  host.innerHTML = ''; // clear the host (empty-string reset, same as render.ts)
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.style.gap = '10px';
  host.style.fontFamily = FONT;
  host.style.width = '100%';
  host.style.boxSizing = 'border-box';

  const list = buildMessageList();
  const { form, input, sendBtn } = buildInputRow();
  host.appendChild(list);
  host.appendChild(form);

  const setSending = (sending: boolean): void => {
    input.disabled = sending;
    sendBtn.disabled = sending;
    sendBtn.style.opacity = sending ? '0.6' : '1';
  };

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    void send(text);
  });

  async function send(text: string): Promise<void> {
    addVisitorMessage(list, text);
    setSending(true);
    const bubble = startAssistantBubble(list);
    let ref: string;
    try {
      ref = await getCustomerRef();
    } catch (err) {
      bubble.fail(err instanceof Error ? err.message : 'Could not start a session.');
      setSending(false);
      input.focus();
      return;
    }

    await streamConciergeChat(
      {
        endpoint: config.endpoint,
        widgetId: config.widgetId,
        signedKey: config.signedKey,
        customerRef: ref,
      },
      text,
      {
        onChunk: (delta) => {
          bubble.append(delta);
          scrollToBottom(list);
        },
        onEnd: () => {
          bubble.finalize();
          setSending(false);
          input.focus();
        },
        onError: (message) => {
          bubble.fail(message);
          setSending(false);
          input.focus();
        },
      },
    );
  }
}

function buildMessageList(): HTMLElement {
  const list = document.createElement('div');
  // A polite live region so screen readers announce streamed replies.
  list.setAttribute('role', 'log');
  list.setAttribute('aria-live', 'polite');
  list.setAttribute('aria-label', 'Conversation');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '8px';
  list.style.overflowY = 'auto';
  list.style.maxHeight = 'var(--pp-chat-height, 320px)';
  list.style.padding = '4px';
  return list;
}

function buildInputRow(): {
  form: HTMLFormElement;
  input: HTMLInputElement;
  sendBtn: HTMLButtonElement;
} {
  const form = document.createElement('form');
  form.style.display = 'flex';
  form.style.gap = '8px';
  form.style.alignItems = 'center';

  const input = document.createElement('input');
  input.type = 'text';
  input.name = 'message';
  input.placeholder = 'Ask a question…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Message');
  input.style.flex = '1';
  input.style.minWidth = '0';
  input.style.padding = '10px 12px';
  input.style.borderRadius = '8px';
  input.style.border = '1px solid var(--pp-border, #ccc)';
  input.style.fontFamily = 'inherit';
  input.style.fontSize = '16px'; // 16px avoids iOS zoom-on-focus for mobile visitors

  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.textContent = 'Send';
  sendBtn.setAttribute('aria-label', 'Send');
  sendBtn.style.cursor = 'pointer';
  sendBtn.style.border = 'none';
  sendBtn.style.borderRadius = '8px';
  sendBtn.style.padding = '10px 16px';
  sendBtn.style.background = 'var(--pp-primary, #111)';
  sendBtn.style.color = 'var(--pp-onPrimary, #fff)';
  sendBtn.style.fontFamily = 'inherit';
  sendBtn.style.fontSize = '14px';
  sendBtn.style.fontWeight = '600';

  form.appendChild(input);
  form.appendChild(sendBtn);
  return { form, input, sendBtn };
}

function baseBubble(align: 'start' | 'end'): HTMLElement {
  const bubble = document.createElement('div');
  bubble.style.alignSelf = align === 'end' ? 'flex-end' : 'flex-start';
  bubble.style.maxWidth = '85%';
  bubble.style.padding = '8px 12px';
  bubble.style.borderRadius = '12px';
  bubble.style.fontSize = '13px';
  bubble.style.lineHeight = '1.4';
  bubble.style.whiteSpace = 'pre-wrap'; // preserve the plaintext reply's newlines
  bubble.style.wordBreak = 'break-word';
  return bubble;
}

function addVisitorMessage(list: HTMLElement, text: string): void {
  const bubble = baseBubble('end');
  bubble.textContent = text;
  bubble.style.background = 'var(--pp-primary, #111)';
  bubble.style.color = 'var(--pp-onPrimary, #fff)';
  list.appendChild(bubble);
  scrollToBottom(list);
}

function startAssistantBubble(list: HTMLElement): AssistantBubble {
  const bubble = baseBubble('start');
  bubble.style.background = 'var(--pp-surface, #f5f5f5)';
  bubble.style.color = 'var(--pp-text, #111)';
  bubble.textContent = '…'; // placeholder until the first token lands
  list.appendChild(bubble);
  scrollToBottom(list);

  let started = false;
  return {
    append(delta: string): void {
      if (!started) {
        bubble.textContent = '';
        started = true;
      }
      bubble.textContent += delta;
    },
    finalize(): void {
      // If the stream ended without a single token, show a gentle fallback so a
      // visitor is never left staring at a lone ellipsis.
      if (!started) bubble.textContent = 'No reply.';
    },
    fail(message: string): void {
      bubble.textContent = message || 'Something went wrong. Please try again.';
      bubble.style.background = 'var(--pp-error-surface, #fdecea)';
      bubble.style.color = 'var(--pp-error, #b3261e)';
    },
  };
}

function scrollToBottom(list: HTMLElement): void {
  list.scrollTop = list.scrollHeight;
}
