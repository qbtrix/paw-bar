// Playwright smoke + integration tests for the Paw Print widget bundle.
// Created: 2026-04-13 — Mock the runtime API with `page.route()` so the widget
// can load a fixed spec, render DOM, emit pp.event on button click, and post
// a mock event with a hashed customer_ref.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BUDGET_BYTES = 10 * 1024;

const DEMO_SPEC = {
  widget_id: 'pp_test_widget',
  pocket_id: 'pocket-1',
  layout: 'vertical',
  blocks: [
    { type: 'text', style: 'heading', content: 'Today at Brew & Co' },
    {
      type: 'list',
      items: [
        {
          title: 'Oat Milk Latte',
          meta: '$5 — 34 in stock',
          action: { event: 'order_click', payload: { item: 'oat_latte' } },
        },
        {
          title: 'Americano',
          meta: '$4 — out of stock',
          disabled: true,
        },
      ],
    },
  ],
};

test.describe('widget bundle', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/paw-print/spec/pp_test_widget', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DEMO_SPEC),
      }),
    );
    await page.route('**/paw-print/events/pp_test_widget', async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accepted: true, event: body, fabric_object_id: 'obj_created' }),
      });
    });
  });

  test('renders the spec into the host container', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText("Today at Brew & Co")).toBeVisible();
    await expect(page.getByText('Oat Milk Latte')).toBeVisible();
    await expect(page.getByText('Americano')).toBeVisible();
  });

  test('posting a button click emits pp.event with the fabric object id', async ({ page }) => {
    await page.goto('/');
    const eventPromise = page.evaluate(() => {
      return new Promise<Record<string, unknown>>((resolve) => {
        document.querySelector('[data-paw-print]')!.addEventListener(
          'pp.event',
          (ev) => resolve((ev as CustomEvent).detail as Record<string, unknown>),
          { once: true },
        );
      });
    });

    await page.getByRole('button', { name: 'Select' }).first().click();
    const detail = (await eventPromise) as {
      event: string;
      payload: Record<string, unknown>;
      result: { accepted: boolean; fabric_object_id: string };
    };
    expect(detail.event).toBe('order_click');
    expect(detail.payload).toMatchObject({ item: 'oat_latte' });
    expect(detail.result.accepted).toBe(true);
    expect(detail.result.fabric_object_id).toBe('obj_created');
  });

  test('posts with a hashed customer_ref that persists across reloads', async ({ page }) => {
    let firstRef: string | null = null;
    let secondRef: string | null = null;

    await page.route('**/paw-print/events/pp_test_widget', async (route) => {
      const body = route.request().postDataJSON() as { customer_ref: string };
      if (firstRef === null) firstRef = body.customer_ref;
      else secondRef = body.customer_ref;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accepted: true, event: body, fabric_object_id: 'obj_x' }),
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Select' }).first().click();
    await expect.poll(() => firstRef).not.toBeNull();

    await page.reload();
    await page.getByRole('button', { name: 'Select' }).first().click();
    await expect.poll(() => secondRef).not.toBeNull();

    expect(firstRef).toMatch(/^[a-f0-9]{64}$/);
    expect(firstRef).toBe(secondRef);
  });

  test('disabled list items do not render an action button', async ({ page }) => {
    await page.goto('/');
    const buttons = await page.getByRole('button', { name: 'Select' }).all();
    expect(buttons.length).toBe(1);
  });
});

test.describe('bundle size budget', () => {
  test('dist/widget.js stays under the 10KB gzipped budget', async () => {
    const bundle = readFileSync(join(process.cwd(), 'dist/widget.js'));
    const gz = gzipSync(bundle, { level: 9 });
    expect(gz.byteLength).toBeLessThan(BUDGET_BYTES);
  });
});
