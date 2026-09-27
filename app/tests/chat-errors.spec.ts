// tests/chat-errors.spec.ts — the send-failure classifier and its copy.
// Created 2026-09-27 (paw-bar states, section D; spec
// docs/design/drafts/2026-09-27-paw-bar-states-ux-failures.md §2–3). Pure unit
// coverage for lib/chat-errors: every row of the classification and detail
// tables, the quota never-strand rule, Retry-After handling, the copy never
// carrying a code, and the once-per-kind owner warning.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  classifyError,
  cooldownMs,
  FAILURE_COPY,
  formatCopy,
  reportFailure,
  type FailureKind,
  type RawFailure,
} from '../src/lib/chat-errors';

const first = { firstUserTurn: true };
const later = { firstUserTurn: false };
const http = (status: number, detail: string | null, retryAfter: string | null = null): RawFailure => ({
  source: 'http',
  status,
  detail,
  retryAfter,
});

afterEach(() => vi.restoreAllMocks());

describe('classifyError: transport', () => {
  it('a fetch rejection while offline is offline, queued on the user turn', () => {
    expect(classifyError({ source: 'network', online: false, afterResponse: false }, first)).toMatchObject({
      kind: 'offline',
      scope: 'turn',
      on: 'user',
    });
  });

  it('a fetch rejection while "online" is unreachable, not offline', () => {
    expect(classifyError({ source: 'network', online: true, afterResponse: false }, first).kind).toBe('unreachable');
  });

  it('a read that fails after the response started is interrupted, even offline', () => {
    const f = classifyError({ source: 'network', online: false, afterResponse: true }, first);
    expect(f).toMatchObject({ kind: 'interrupted', on: 'assistant' });
  });

  it('SSE frames and the empty end land on the assistant turn', () => {
    expect(classifyError({ source: 'frame', event: 'interrupted' }, first)).toMatchObject({ kind: 'interrupted', on: 'assistant' });
    expect(classifyError({ source: 'frame', event: 'error', message: 'provider 500' }, first)).toMatchObject({
      kind: 'server',
      on: 'assistant',
    });
    expect(classifyError({ source: 'empty' }, first)).toMatchObject({ kind: 'empty', on: 'assistant' });
  });

  it('keeps the SSE error text for the owner only', () => {
    const f = classifyError({ source: 'frame', event: 'error', message: 'provider 500' }, first);
    expect(f.ownerReason).toContain('provider 500');
  });
});

describe('classifyError: HTTP', () => {
  it('429 is rate_limited with a 30s default cooldown', () => {
    expect(classifyError(http(429, 'Rate limit exceeded'), later)).toMatchObject({
      kind: 'rate_limited',
      scope: 'turn',
      on: 'user',
      retryAfterMs: 30_000,
    });
  });

  it('honours a readable Retry-After, clamped to 5–60s', () => {
    expect(classifyError(http(429, null, '12'), later).retryAfterMs).toBe(12_000);
    expect(cooldownMs('1')).toBe(5_000);
    expect(cooldownMs('600')).toBe(60_000);
    expect(cooldownMs('Wed, 21 Oct 2026 07:28:00 GMT')).toBe(30_000);
    expect(cooldownMs(null)).toBe(30_000);
  });

  it('400 message_rejected removes the turn (on none)', () => {
    expect(classifyError(http(400, 'message_rejected'), later)).toMatchObject({ kind: 'rejected', on: 'none' });
  });

  it.each([
    [403, 'concierge_quota_exceeded', true],
    [409, 'widget has no concierge agent', true],
    [409, 'concierge_pocket_has_connectors', true],
    [409, 'concierge_connector_check_failed', true],
    [404, 'Widget not found', false],
    [401, 'invalid_site_key', false],
    [403, 'concierge_disabled', false],
    [403, 'concierge_not_entitled', false],
    [403, 'origin_not_allowed', false],
    [403, 'widget_workspace_mismatch', false],
    [403, 'widget_pocket_mismatch', false],
  ])('%i %s is bar-level unavailable, contactable=%s', (status, detail, contactable) => {
    expect(classifyError(http(status, detail), first)).toMatchObject({
      kind: 'unavailable',
      scope: 'bar',
      contactable,
    });
  });

  it('never strands a thread: quota after the first turn is a per-turn unreachable', () => {
    expect(classifyError(http(403, 'concierge_quota_exceeded'), later)).toMatchObject({
      kind: 'unreachable',
      scope: 'turn',
      on: 'user',
    });
  });

  it('5xx and unknown 4xx are unreachable', () => {
    expect(classifyError(http(502, null), first).kind).toBe('unreachable');
    expect(classifyError(http(418, 'teapot'), first).kind).toBe('unreachable');
    expect(classifyError(http(403, 'something_new'), first).kind).toBe('unreachable');
  });
});

describe('FAILURE_COPY', () => {
  it('has screen-reader copy for every kind, and never a code or status', () => {
    const kinds: FailureKind[] = ['offline', 'unreachable', 'rate_limited', 'rejected', 'unavailable', 'interrupted', 'server', 'empty'];
    for (const k of kinds) {
      const copy = FAILURE_COPY[k];
      expect(copy.sr.length).toBeGreaterThan(0);
      for (const text of [copy.turn, copy.line, copy.sr]) {
        if (text) expect(text).not.toMatch(/\d{3}|failed \(|fetch|_/);
      }
    }
  });

  it('fills the cooldown seconds', () => {
    expect(formatCopy(FAILURE_COPY.rate_limited.line!, 23.2)).toBe(
      "You're sending messages quickly. You can send again in 24s.",
    );
  });
});

describe('reportFailure', () => {
  it('warns once per kind per page view, and never for offline', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen = new Set<FailureKind>();
    const f = classifyError(http(429, 'Rate limit exceeded'), later);
    reportFailure(f, seen);
    reportFailure(f, seen);
    reportFailure(classifyError({ source: 'network', online: false, afterResponse: false }, first), seen);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe('[paw-bar] chat refused:');
    expect(String(warn.mock.calls[0][1])).toContain('429');
  });
});
