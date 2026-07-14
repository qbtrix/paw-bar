// tests/chat.spec.ts — Browser integration for the concierge chat mode. Mocks
// POST /paw-bar/chat with a canned SSE body (the exact frame shapes the backend
// streams) and drives the real mount → chat UI → streaming client → bubble path.
// Created: 2026-07-14 (Paw Bar chat UI, T4) — proves the mode switch (a host with
//   data-site-key renders chat, not a spec), that a visitor message and the
//   streamed reply render via textContent, and that an HTTP error shows an error
//   state. Complements the pure sse-parser.spec.ts unit tests.

import { test, expect } from '@playwright/test';

const SITE_KEY = 'site_key_' + 'a'.repeat(24);

// message.persisted → one text chunk → stream_end: what concierge_chat's gen() emits.
const SSE_REPLY =
  'event: message.persisted\ndata: {"run_id":"r1","client_message_id":"c1"}\n\n' +
  'event: chunk\ndata: {"content":"We open at 8am!","type":"text"}\n\n' +
  'event: stream_end\ndata: {"assistant_message_id":"m1","cancelled":false}\n\n';

async function mountChatHost(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.evaluate((siteKey) => {
    const host = document.createElement('div');
    host.setAttribute('data-paw-bar', 'pp_chat_widget');
    host.setAttribute('data-site-key', siteKey);
    document.body.appendChild(host);
    (window as unknown as { PawBar: { mount: (el: HTMLElement) => void } }).PawBar.mount(host);
  }, SITE_KEY);
}

test.describe('concierge chat mode', () => {
  test('streams a reply into the chat UI', async ({ page }) => {
    let sentBody: Record<string, unknown> | null = null;
    await page.route('**/paw-bar/chat', async (route) => {
      sentBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: SSE_REPLY,
      });
    });

    await mountChatHost(page);
    await page.getByLabel('Message').fill('What time do you open?');
    await page.getByRole('button', { name: 'Send' }).click();

    // The visitor's message and the streamed assistant reply both render.
    await expect(page.getByText('What time do you open?')).toBeVisible();
    await expect(page.getByText('We open at 8am!')).toBeVisible();

    // The request carried the documented contract shape.
    expect(sentBody).toMatchObject({
      widget_id: 'pp_chat_widget',
      signed_key: SITE_KEY,
      message: 'What time do you open?',
    });
    expect((sentBody as { customer_ref: string }).customer_ref).toMatch(/^[a-f0-9]{64}$/);
  });

  test('shows an error state when the endpoint fails', async ({ page }) => {
    await page.route('**/paw-bar/chat', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ detail: 'Rate limit exceeded' }),
      }),
    );

    await mountChatHost(page);
    await page.getByLabel('Message').fill('hello');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText(/paw-bar chat failed \(429\)/)).toBeVisible();
    // The input is re-enabled so the visitor can retry.
    await expect(page.getByLabel('Message')).toBeEnabled();
  });
});
