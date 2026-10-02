// page-tools.ts — the frame's registry of site-declared tools.
//
// A site registers tools on its own page (`window.pawbarTools.push({...})`);
// the host script (actions/src/actions.ts) checks their outline and posts
// {type:'pawbar:tools', tools:[{name, description, inputSchema, confirm}]} into
// the frame. BarShell hands each message here, only when it came from
// parentOrigin, and the latest good list wins. The frame asks for the list on
// boot with {type:'pawbar:tools-request'}.
//
// The message is still input from another document, and the host script keeps
// to its gzip budget by checking only an outline, so the full rules live here,
// the same as pocketpaw's action_spec.valid_tools (a rejected tool is dropped
// alone, with a console warning for the site developer):
//   * only the first TOOLS_MAX entries are read; a repeated name keeps the first;
//   * name /^[a-z][a-z0-9_]{0,39}$/; description one-line text, 1–200 chars
//     after whitespace runs collapse (stored collapsed);
//   * schema {type:'object', properties?, required?} and nothing else, at most
//     TOOL_SCHEMA_MAX characters of compact JSON (JSON.stringify(...).length);
//   * property names ARG_NAME_RE; each property a string/number/integer/boolean
//     with optional description (one-line, ≤ 200), enum (1–ENUM_MAX values of
//     its type; a string value is 1–ENUM_STRING_MAX chars by JS .length with
//     none of < > « »), minimum ≤ maximum (numbers only),
//     maxLength (strings only, whole, ≥ 0); `required` lists known names once.
// `confirm` is true unless the host said exactly false: the frame is the
// authority on it, and it never reaches the server.
//
// validateToolArgs checks a model's `args` against a tool schema the way the
// server does: absent args are {}, no extra keys, every required key present,
// types (an integer is a number with no fraction; a boolean is never a number),
// strings ≤ ARG_STRING_MAX and maxLength, enum, inclusive minimum/maximum.
// The verdicts are pinned for both sides in tests/fixtures/action_parity
// (cases.json tool_* and tool_schemas.json; limits in expected.json bounds).

export type ToolArg = string | number | boolean;
export type ToolPropType = 'string' | 'number' | 'integer' | 'boolean';

export interface ToolProp {
  type: ToolPropType;
  description?: string;
  enum?: ToolArg[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
}

export interface ToolSchema {
  type: 'object';
  properties?: Record<string, ToolProp>;
  required?: string[];
}

export interface PageTool {
  name: string;
  description: string;
  inputSchema: ToolSchema;
  confirm: boolean;
}

/** What the chat request carries: no `confirm`, no `execute`. */
export interface WireTool {
  name: string;
  description: string;
  input_schema: ToolSchema;
}

export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const ARG_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const TOOLS_MAX = 12;
export const TOOL_DESCRIPTION_MAX = 200;
export const TOOL_SCHEMA_MAX = 2048;
export const ARG_STRING_MAX = 200;
export const ENUM_MAX = 50;
export const ENUM_STRING_MAX = 80;
/** Characters an enum string may not hold (same rule as the server). */
export const ENUM_STRING_BAD = /[<>«»]/;
export const ARG_TYPES: readonly ToolPropType[] = ['string', 'number', 'integer', 'boolean'];
const SCHEMA_KEYS = ['type', 'properties', 'required'];
const PROP_KEYS = ['type', 'description', 'enum', 'minimum', 'maximum', 'maxLength'];
const CONTROL = /[\u0000-\u001f\u007f]/;

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Non-empty one-line text of at most `cap` chars, whitespace collapsed, or null. */
function oneLine(value: unknown, cap: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text && text.length <= cap && !CONTROL.test(text) ? text : null;
}

/** Does `value` have JSON type `type`? An integer is a number with no fraction. */
function fits(value: unknown, type: ToolPropType): value is ToolArg {
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return isNum(value);
  return typeof value === type;
}

function validEnumString(v: string): boolean {
  return v.length >= 1 && v.length <= ENUM_STRING_MAX && !ENUM_STRING_BAD.test(v);
}

function validProp(p: unknown): p is ToolProp {
  if (!isObj(p) || !Object.keys(p).every((k) => PROP_KEYS.includes(k))) return false;
  const type = p.type as ToolPropType;
  if (!ARG_TYPES.includes(type)) return false;
  if (own(p, 'description') && !oneLine(p.description, TOOL_DESCRIPTION_MAX)) return false;
  if (own(p, 'enum')) {
    const e = p.enum;
    if (!Array.isArray(e) || !e.length || e.length > ENUM_MAX || !e.every((v) => fits(v, type))) return false;
    if (type === 'string' && !e.every((v) => validEnumString(v as string))) return false;
  }
  const numeric = type === 'number' || type === 'integer';
  for (const k of ['minimum', 'maximum']) {
    if (own(p, k) && !(numeric && isNum(p[k]))) return false;
  }
  if (own(p, 'minimum') && own(p, 'maximum') && (p.minimum as number) > (p.maximum as number)) return false;
  if (own(p, 'maxLength') && !(type === 'string' && Number.isInteger(p.maxLength) && (p.maxLength as number) >= 0)) {
    return false;
  }
  return true;
}

/** An untrusted schema as a ToolSchema (a copy), or null. */
export function sanitizeToolSchema(raw: unknown): ToolSchema | null {
  if (!isObj(raw) || raw.type !== 'object' || !Object.keys(raw).every((k) => SCHEMA_KEYS.includes(k))) return null;
  const props = raw.properties ?? {};
  if (!isObj(props)) return null;
  if (!Object.keys(props).every((k) => ARG_NAME_RE.test(k)) || !Object.values(props).every(validProp)) return null;
  const required = raw.required ?? [];
  if (!Array.isArray(required) || !required.every((k) => typeof k === 'string' && own(props, k))) return null;
  if (new Set(required).size !== required.length) return null;
  let json: string;
  try {
    json = JSON.stringify(raw);
  } catch {
    return null;
  }
  return json.length <= TOOL_SCHEMA_MAX ? (JSON.parse(json) as ToolSchema) : null;
}

/** One untrusted tool from the host page, or null. */
export function sanitizeTool(raw: unknown): PageTool | null {
  if (!isObj(raw)) return null;
  const { name } = raw;
  if (typeof name !== 'string' || !TOOL_NAME_RE.test(name)) return null;
  const description = oneLine(raw.description, TOOL_DESCRIPTION_MAX);
  const inputSchema = description ? sanitizeToolSchema(raw.inputSchema) : null;
  if (!description || !inputSchema) return null;
  return { name, description, inputSchema, confirm: raw.confirm !== false };
}

/** The host's list as tools: the first TOOLS_MAX entries read, bad ones
 *  dropped, a repeated name keeps the first. Never throws. */
export function sanitizeTools(raw: unknown): PageTool[] {
  if (!Array.isArray(raw)) return [];
  const out: PageTool[] = [];
  for (const item of raw.slice(0, TOOLS_MAX)) {
    const tool = sanitizeTool(item);
    if (!tool) {
      // The site developer's channel: actions.js checks only the outline of a
      // tool, so one it let through can still be refused here.
      console.warn('[paw-bar] tool rejected:', isObj(item) ? item.name : item);
    } else if (!out.some((t) => t.name === tool.name)) {
      out.push(tool);
    }
  }
  return out;
}

/** `args` checked against `schema`: a fresh copy, or null when anything is off.
 *  Absent (undefined or null) args are {}. */
export function validateToolArgs(schema: ToolSchema, args: unknown): Record<string, ToolArg> | null {
  const given = args ?? {};
  if (!isObj(given)) return null;
  const props = schema.properties ?? {};
  for (const k of schema.required ?? []) if (!own(given, k)) return null;
  const out: Record<string, ToolArg> = {};
  for (const [k, v] of Object.entries(given)) {
    if (!own(props, k)) return null;
    const p = props[k];
    if (!fits(v, p.type)) return null;
    if (typeof v === 'string' && v.length > Math.min(ARG_STRING_MAX, p.maxLength ?? ARG_STRING_MAX)) return null;
    if (p.enum && !p.enum.includes(v)) return null;
    if (typeof v === 'number' && ((p.minimum !== undefined && v < p.minimum) || (p.maximum !== undefined && v > p.maximum))) {
      return null;
    }
    out[k] = v;
  }
  return out;
}

// ── The registry ─────────────────────────────────────────────────────────────
let current: PageTool[] = [];

/** Record what the host page declared. A message that is not a list is ignored. */
export function setPageTools(raw: unknown): void {
  if (Array.isArray(raw)) current = sanitizeTools(raw);
}

export function getPageTools(): readonly PageTool[] {
  return current;
}

export function findPageTool(name: string | undefined, tools: readonly PageTool[] = current): PageTool | undefined {
  return name ? tools.find((t) => t.name === name) : undefined;
}

/** The registry as the chat request's `page.tools`. */
export function wireTools(tools: readonly PageTool[] = current): WireTool[] {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
}

/** Tests only. */
export function resetPageTools(): void {
  current = [];
}
