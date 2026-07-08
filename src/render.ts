// DOM renderer — turns a Paw Bar spec into a sandboxed tree of native
// elements. Never uses innerHTML with user-supplied content; every string
// comes in via textContent so an attacker-controlled spec cannot inject
// executable markup.

import type { Block, FormField, ListItem, Spec } from './types';

export type EventEmitter = (event: string, payload: Record<string, unknown>) => void;

export function render(spec: Spec, host: HTMLElement, emit: EventEmitter): void {
  host.innerHTML = '';
  applyTheme(host, spec.theme);
  host.style.display = 'flex';
  host.style.flexDirection = layoutFlexDirection(spec.layout);
  host.style.gap = '12px';

  for (const block of spec.blocks) {
    const node = renderBlock(block, emit);
    if (node) host.appendChild(node);
  }
}

function layoutFlexDirection(layout: Spec['layout']): string {
  if (layout === 'horizontal') return 'row';
  if (layout === 'grid') return 'row';
  return 'column';
}

function applyTheme(host: HTMLElement, theme: Record<string, string> | undefined): void {
  if (!theme) return;
  for (const [key, value] of Object.entries(theme)) {
    const safeKey = key.replace(/[^a-zA-Z0-9-]/g, '');
    const safeValue = String(value).replace(/[<>]/g, '');
    if (safeKey && safeValue) host.style.setProperty(`--pp-${safeKey}`, safeValue);
  }
}

function renderBlock(block: Block, emit: EventEmitter): HTMLElement | null {
  switch (block.type) {
    case 'text':
      return renderText(block);
    case 'image':
      return renderImage(block);
    case 'list':
      return renderList(block.items ?? [], emit);
    case 'button':
      return renderButton(block, emit);
    case 'form':
      return renderForm(block.fields ?? [], block.submit_event ?? 'submit', emit);
    case 'divider':
      return renderDivider();
    default:
      return null;
  }
}

function renderText(block: Block): HTMLElement {
  const el = document.createElement('p');
  el.textContent = block.content ?? '';
  el.style.margin = '0';
  el.style.fontFamily = 'system-ui, sans-serif';
  if (block.style === 'heading') {
    el.style.fontSize = '16px';
    el.style.fontWeight = '700';
  } else if (block.style === 'muted') {
    el.style.fontSize = '12px';
    el.style.color = 'var(--pp-muted, #666)';
  } else {
    el.style.fontSize = '13px';
    el.style.color = 'var(--pp-text, #111)';
  }
  return el;
}

function renderImage(block: Block): HTMLElement | null {
  if (!block.src || !isSafeUrl(block.src)) return null;
  const img = document.createElement('img');
  img.src = block.src;
  img.alt = block.alt ?? '';
  img.style.maxWidth = '100%';
  img.style.borderRadius = '8px';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  return img;
}

function renderList(items: ListItem[], emit: EventEmitter): HTMLElement {
  const ul = document.createElement('ul');
  ul.style.listStyle = 'none';
  ul.style.padding = '0';
  ul.style.margin = '0';
  ul.style.display = 'flex';
  ul.style.flexDirection = 'column';
  ul.style.gap = '8px';
  for (const item of items) {
    ul.appendChild(renderListItem(item, emit));
  }
  return ul;
}

function renderListItem(item: ListItem, emit: EventEmitter): HTMLElement {
  const li = document.createElement('li');
  li.style.display = 'flex';
  li.style.justifyContent = 'space-between';
  li.style.alignItems = 'center';
  li.style.padding = '10px 12px';
  li.style.borderRadius = '10px';
  li.style.background = 'var(--pp-surface, #f5f5f5)';
  li.style.fontFamily = 'system-ui, sans-serif';
  li.style.fontSize = '13px';
  if (item.disabled) {
    li.style.opacity = '0.5';
  }

  const left = document.createElement('div');
  const title = document.createElement('div');
  title.textContent = item.title;
  title.style.fontWeight = '600';
  left.appendChild(title);
  if (item.meta) {
    const meta = document.createElement('div');
    meta.textContent = item.meta;
    meta.style.fontSize = '11px';
    meta.style.color = 'var(--pp-muted, #666)';
    left.appendChild(meta);
  }
  li.appendChild(left);

  if (item.action && !item.disabled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Select';
    btn.style.cursor = 'pointer';
    btn.style.border = 'none';
    btn.style.borderRadius = '6px';
    btn.style.padding = '6px 10px';
    btn.style.background = 'var(--pp-primary, #111)';
    btn.style.color = 'var(--pp-onPrimary, #fff)';
    btn.style.fontSize = '12px';
    btn.addEventListener('click', () => {
      emit(item.action!.event, item.action!.payload ?? {});
    });
    li.appendChild(btn);
  }
  return li;
}

function renderButton(block: Block, emit: EventEmitter): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = block.label ?? 'Submit';
  btn.style.cursor = 'pointer';
  btn.style.border = 'none';
  btn.style.borderRadius = '8px';
  btn.style.padding = '10px 14px';
  btn.style.background = 'var(--pp-primary, #111)';
  btn.style.color = 'var(--pp-onPrimary, #fff)';
  btn.style.fontFamily = 'system-ui, sans-serif';
  btn.style.fontSize = '13px';
  btn.style.fontWeight = '600';
  btn.addEventListener('click', () => {
    if (block.href && isSafeUrl(block.href)) {
      window.open(block.href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (block.action) emit(block.action.event, block.action.payload ?? {});
  });
  return btn;
}

function renderForm(fields: FormField[], submitEvent: string, emit: EventEmitter): HTMLElement {
  const form = document.createElement('form');
  form.style.display = 'flex';
  form.style.flexDirection = 'column';
  form.style.gap = '8px';
  form.style.fontFamily = 'system-ui, sans-serif';
  for (const field of fields) {
    const wrap = document.createElement('label');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '4px';
    wrap.style.fontSize = '12px';
    if (field.label) {
      const lbl = document.createElement('span');
      lbl.textContent = field.label;
      lbl.style.fontWeight = '600';
      wrap.appendChild(lbl);
    }
    const input =
      field.type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
    if (input instanceof HTMLInputElement) {
      input.type = field.type === 'textarea' ? 'text' : (field.type ?? 'text');
    }
    input.name = field.name;
    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.required) input.required = true;
    input.style.padding = '8px';
    input.style.borderRadius = '6px';
    input.style.border = '1px solid var(--pp-border, #ccc)';
    input.style.fontFamily = 'inherit';
    input.style.fontSize = '13px';
    wrap.appendChild(input);
    form.appendChild(wrap);
  }
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Submit';
  submit.style.alignSelf = 'flex-start';
  submit.style.cursor = 'pointer';
  submit.style.border = 'none';
  submit.style.borderRadius = '8px';
  submit.style.padding = '8px 14px';
  submit.style.background = 'var(--pp-primary, #111)';
  submit.style.color = 'var(--pp-onPrimary, #fff)';
  submit.style.fontWeight = '600';
  submit.style.fontSize = '13px';
  form.appendChild(submit);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const payload: Record<string, unknown> = {};
    data.forEach((value, key) => {
      payload[key] = typeof value === 'string' ? value : value.name;
    });
    emit(submitEvent, payload);
  });
  return form;
}

function renderDivider(): HTMLElement {
  const hr = document.createElement('hr');
  hr.style.border = 'none';
  hr.style.borderTop = '1px solid var(--pp-border, #ddd)';
  hr.style.margin = '4px 0';
  return hr;
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
