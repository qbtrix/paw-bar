// Shared types — deliberately narrow to match ee/paw_print/models.py on the
// server. Unknown fields on a block are ignored so forward-compatible spec
// additions don't break older bundles.

export type BlockType = 'text' | 'image' | 'list' | 'button' | 'form' | 'divider';

export interface Action {
  event: string;
  payload?: Record<string, unknown>;
}

export interface ListItem {
  title: string;
  meta?: string;
  action?: Action;
  disabled?: boolean;
}

export interface FormField {
  name: string;
  label?: string;
  type?: 'text' | 'email' | 'number' | 'textarea';
  placeholder?: string;
  required?: boolean;
}

export interface Block {
  type: BlockType;
  content?: string;
  style?: 'body' | 'heading' | 'muted';
  src?: string;
  alt?: string;
  items?: ListItem[];
  label?: string;
  href?: string;
  action?: Action;
  fields?: FormField[];
  submit_event?: string;
}

export interface Spec {
  widget_id: string;
  pocket_id: string;
  layout?: 'vertical' | 'horizontal' | 'grid';
  theme?: Record<string, string>;
  blocks: Block[];
}

export interface MountConfig {
  endpoint: string;
  widgetId: string;
  container: HTMLElement;
}
