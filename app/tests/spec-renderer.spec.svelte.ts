// tests/spec-renderer.spec.svelte.ts — SpecRenderer draws a Ripple spec with
// components passed in. Created 2026-09-27.
//
// Driven through small stand-ins in tests/fixtures/spec/. Each test acts on a
// spec the way a host would and asserts on the DOM: state and actions, per-row
// actions inside `each`, binding, slots, unknown and throwing components, host
// actions, and every way styling can arrive (spec theme, node class and style,
// host class and style) including the filter on agent-written CSS.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import type { UINode } from '@ripple-ui/core/headless/slim';
import SpecRenderer from '../src/components/spec/SpecRenderer.svelte';
import Label from './fixtures/spec/Label.svelte';
import Press from './fixtures/spec/Press.svelte';
import Field from './fixtures/spec/Field.svelte';
import Box from './fixtures/spec/Box.svelte';
import Broken from './fixtures/spec/Broken.svelte';
import Missing from './fixtures/spec/Missing.svelte';
import Styled from './fixtures/spec/Styled.svelte';

const components = { text: Label, button: Press, input: Field, box: Box, broken: Broken, styled: Styled };
const node = (n: Record<string, unknown>) => n as unknown as UINode;

let live: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

function render(props: Record<string, unknown>) {
  const target = document.createElement('div');
  document.body.append(target);
  const state = $state<Record<string, unknown>>({ components, ...props });
  live = mount(SpecRenderer, { target, props: state as never });
  flushSync();
  return { target, props: state };
}

const byId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe('SpecRenderer: drawing and state', () => {
  it('draws a full spec with its own initial state', () => {
    render({ spec: { ui: node({ type: 'text', id: 'hi', props: { content: 'Hello {state.name}' } }), state: { name: 'Ada' } } });
    expect(byId('hi')?.textContent).toBe('Hello Ada');
  });

  it('lets the state prop override the spec state', () => {
    render({
      spec: { ui: node({ type: 'text', id: 'hi', props: { content: '{state.name}' } }), state: { name: 'Ada' } },
      state: { name: 'Grace' },
    });
    expect(byId('hi')?.textContent).toBe('Grace');
  });

  it('runs a set action and redraws', async () => {
    render({
      spec: node({
        type: 'box',
        children: [
          node({ type: 'text', id: 'count', props: { content: '{state.count}' } }),
          node({ type: 'button', id: 'inc', on_click: { action: 'set', target: 'count', value: '{state.count + 1}' } }),
        ],
      }),
      state: { count: 1 },
    });
    byId('inc')!.click();
    await tick();
    expect(byId('count')?.textContent).toBe('2');
  });

  it('gives each copy inside each its own loop variables', async () => {
    render({
      spec: node({
        type: 'box',
        children: [
          node({ type: 'text', id: 'picked', props: { content: '{state.picked}' } }),
          node({
            type: 'each',
            items: '{state.rows}',
            item_as: 'row',
            children: [
              node({ type: 'button', props: { label: '{row.name}' }, on_click: { action: 'set', target: 'picked', value: '{row.id}' } }),
            ],
          }),
        ],
      }),
      state: { rows: [{ id: 'r1', name: 'First' }, { id: 'r2', name: 'Second' }], picked: '' },
    });
    const second = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Second')!;
    second.click();
    await tick();
    expect(byId('picked')?.textContent).toBe('r2');
  });

  it('writes a bound value on change and names the field by its path', async () => {
    render({
      spec: node({
        type: 'box',
        children: [
          node({ type: 'input', bind: '{state.form.email}' }),
          node({ type: 'text', id: 'echo', props: { content: '{state.form.email}' } }),
        ],
      }),
      state: { form: { email: '' } },
    });
    const field = byId('field') as HTMLInputElement;
    expect(field.name).toBe('form.email');
    field.value = 'a@b.co';
    // Svelte 5 listens for change at the root, so the event has to bubble.
    field.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    expect(byId('echo')?.textContent).toBe('a@b.co');
  });

  it('redraws when the spec changes and keeps the state', async () => {
    const { props } = render({ spec: node({ type: 'text', id: 'a', props: { content: 'A {state.n}' } }), state: { n: 1 } });
    expect(byId('a')?.textContent).toBe('A 1');
    props.spec = node({ type: 'text', id: 'b', props: { content: 'B {state.n}' } });
    flushSync();
    expect(byId('b')?.textContent).toBe('B 1');
  });
});

describe('SpecRenderer: host actions, slots and failures', () => {
  it('sends host actions to onEvent', () => {
    const onEvent = vi.fn();
    render({ spec: node({ type: 'button', id: 'go', on_click: { action: 'emit', event: 'picked', payload: { id: 7 } } }), onEvent });
    byId('go')!.click();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0]).toMatchObject({ type: 'emit' });
  });

  it('passes a slot snippet only when that slot has children', () => {
    render({ spec: node({ type: 'box', children: [node({ type: 'text', slot: 'header', props: { content: 'Top' } })] }) });
    const box = byId('box')!;
    expect(box.dataset.hasHeader).toBe('yes');
    expect(box.dataset.hasChildren).toBe('no');
    expect(box.dataset.hasChildrenFlag).toBe('no');
  });

  it('passes children and hasChildren when the default slot has children', () => {
    render({ spec: node({ type: 'box', children: [node({ type: 'text', props: { content: 'Body' } })] }) });
    const box = byId('box')!;
    expect(box.dataset.hasHeader).toBe('no');
    expect(box.dataset.hasChildren).toBe('yes');
    expect(box.dataset.hasChildrenFlag).toBe('yes');
  });

  it('draws the fallback for a type with no component', () => {
    render({ spec: node({ type: 'chart' }), fallback: Missing });
    expect(byId('fallback')?.textContent).toBe('chart');
    expect(byId('fallback')?.dataset.error).toBe('no');
  });

  it('draws nothing for an unknown type when onUnknownWidget returns false', () => {
    render({ spec: node({ type: 'chart' }), fallback: Missing, onUnknownWidget: () => false });
    expect(byId('fallback')).toBeNull();
  });

  it('does not warn about unknown types', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render({ spec: node({ type: 'chart' }) });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps a throwing component to its own node', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render({
      spec: node({ type: 'box', children: [node({ type: 'broken' }), node({ type: 'text', id: 'ok', props: { content: 'still here' } })] }),
      fallback: Missing,
    });
    expect(byId('fallback')?.dataset.error).toBe('yes');
    expect(byId('ok')?.textContent).toBe('still here');
    error.mockRestore();
  });
});

describe('SpecRenderer: styling', () => {
  const root = (target: HTMLElement) => target.querySelector('.pawbar-spec') as HTMLElement;

  it('turns the spec theme into CSS variables and mode into data-mode', () => {
    const { target } = render({
      spec: {
        ui: node({ type: 'styled', id: 's' }),
        theme: { colors: { primary: '#ff5500', 'primary-foreground': 'white' }, radius: '12px', fonts: { sans: 'Inter, sans-serif' }, mode: 'dark' },
      },
    });
    const el = root(target);
    expect(el.style.getPropertyValue('--primary')).toBe('#ff5500');
    expect(el.style.getPropertyValue('--primary-foreground')).toBe('white');
    expect(el.style.getPropertyValue('--radius')).toBe('12px');
    expect(el.style.getPropertyValue('--ripple-font-sans')).toBe('Inter, sans-serif');
    expect(el.dataset.mode).toBe('dark');
  });

  it('lets the theme prop replace the spec theme', () => {
    const { target } = render({
      spec: { ui: node({ type: 'styled', id: 's' }), theme: { colors: { primary: 'red' } } },
      theme: { colors: { primary: 'blue' } },
    });
    expect(root(target).style.getPropertyValue('--primary')).toBe('blue');
  });

  it('applies host class and style last, so the host wins', () => {
    const { target } = render({
      spec: { ui: node({ type: 'styled', id: 's' }), theme: { colors: { primary: 'red' } } },
      class: 'site-theme',
      style: '--primary: green',
    });
    const el = root(target);
    expect(el.classList.contains('site-theme')).toBe(true);
    expect(el.style.getPropertyValue('--primary')).toBe('green');
  });

  it('passes node class and style to the component', () => {
    render({ spec: node({ type: 'styled', id: 's', class: 'tight {state.tone}', style: { paddingTop: '4px', '--gap': '2px' } }), state: { tone: 'warm' } });
    const el = byId('s')!;
    expect(el.className).toBe('tight warm');
    expect(el.style.paddingTop).toBe('4px');
    expect(el.style.getPropertyValue('--gap')).toBe('2px');
  });

  it('drops spec CSS that could load something or break out', () => {
    const { target } = render({
      spec: {
        ui: node({
          type: 'styled',
          id: 's',
          style: { background: 'url(https://evil.example/p.png)', color: 'red; position: fixed', 'margin-top': '3px' },
        }),
        theme: { colors: { primary: 'red', accent: 'url(x)' } },
      },
    });
    const el = byId('s')!;
    expect(el.style.marginTop).toBe('3px');
    expect(el.style.background).toBe('');
    expect(el.style.color).toBe('');
    expect(el.style.position).toBe('');
    expect(root(target).style.getPropertyValue('--accent')).toBe('');
    expect(root(target).style.getPropertyValue('--primary')).toBe('red');
  });
});
