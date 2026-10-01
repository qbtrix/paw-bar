// tests/voice.spec.svelte.ts — dictation into the bar's field. lib/voice.ts
// against a fake SpeechRecognition on window (results, errors, end, abort),
// then PawBar's mic: shown only where speech recognition exists and `voice` is
// on, words land after the existing draft, a second press stops, a blocked mic
// resets quietly with an announcement, and unmounting releases the recognizer.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

import { mount, unmount, flushSync } from 'svelte';
import PawBar from '../src/components/bar/PawBar.svelte';
import {
  createDictation,
  errorKind,
  voiceSupported,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionResultEventLike,
} from '../src/lib/voice';

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((e: SpeechRecognitionResultEventLike) => void) | null = null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  stopped = false;
  aborted = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
  abort() {
    this.aborted = true;
  }
  /** Speak: each entry is one result, `final` marks it settled. */
  say(parts: { text: string; final?: boolean }[]) {
    const results = parts.map((p) => Object.assign([{ transcript: p.text }], { isFinal: !!p.final }));
    this.onresult?.({ results } as unknown as SpeechRecognitionResultEventLike);
  }
  fail(error: string) {
    this.onerror?.({ error });
    this.onend?.();
  }
  end() {
    this.onend?.();
  }
}

type SpeechWin = { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
const win = window as unknown as SpeechWin;
const last = () => FakeRecognition.instances[FakeRecognition.instances.length - 1]!;

let live: ReturnType<typeof mount> | null = null;
beforeEach(() => {
  FakeRecognition.instances = [];
  win.SpeechRecognition = FakeRecognition;
});
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  delete win.SpeechRecognition;
  delete win.webkitSpeechRecognition;
});

describe('lib/voice', () => {
  it('detects support, prefixed or not', () => {
    expect(voiceSupported()).toBe(true);
    delete win.SpeechRecognition;
    expect(voiceSupported()).toBe(false);
    win.webkitSpeechRecognition = FakeRecognition;
    expect(voiceSupported()).toBe(true);
  });

  it('listens for one utterance with interim results and reports the text so far', () => {
    const onText = vi.fn();
    const onEnd = vi.fn();
    createDictation({ lang: 'en-GB', onText, onEnd }).start();
    const rec = last();
    expect(rec.started).toBe(true);
    expect(rec.continuous).toBe(false);
    expect(rec.interimResults).toBe(true);
    expect(rec.lang).toBe('en-GB');
    rec.say([{ text: 'hello' }]);
    expect(onText).toHaveBeenLastCalledWith('hello', false);
    rec.say([{ text: 'hello', final: true }, { text: ' there', final: true }]);
    expect(onText).toHaveBeenLastCalledWith('hello there', true);
    rec.end();
    rec.end();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('falls back to the document, then the browser, language', () => {
    document.documentElement.lang = 'fr';
    createDictation({ onText() {}, onEnd() {} }).start();
    expect(last().lang).toBe('fr');
    document.documentElement.lang = '';
    createDictation({ onText() {}, onEnd() {} }).start();
    expect(last().lang).toBe(navigator.language || 'en-US');
  });

  it('maps errors to four kinds and still ends once', () => {
    expect(errorKind('not-allowed')).toBe('denied');
    expect(errorKind('service-not-allowed')).toBe('denied');
    expect(errorKind('no-speech')).toBe('no-speech');
    expect(errorKind('network')).toBe('network');
    expect(errorKind('aborted')).toBe('other');
    const onError = vi.fn();
    const onEnd = vi.fn();
    createDictation({ onText() {}, onEnd, onError }).start();
    last().fail('not-allowed');
    expect(onError).toHaveBeenCalledWith('denied');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('a recognizer that throws on start is an error, not a throw', () => {
    win.SpeechRecognition = class extends FakeRecognition {
      override start() {
        throw new Error('InvalidStateError');
      }
    };
    const onError = vi.fn();
    const onEnd = vi.fn();
    expect(() => createDictation({ onText() {}, onEnd, onError }).start()).not.toThrow();
    expect(onError).toHaveBeenCalledWith('other');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('abort releases the recognizer and silences every callback', () => {
    const onText = vi.fn();
    const onEnd = vi.fn();
    const d = createDictation({ onText, onEnd });
    d.start();
    const rec = last();
    d.abort();
    expect(rec.aborted).toBe(true);
    rec.say([{ text: 'late', final: true }]);
    rec.end();
    expect(onText).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe('PawBar mic', () => {
  function bar(extra: Record<string, unknown> = {}) {
    const target = document.createElement('div');
    document.body.append(target);
    const props = $state({ expanded: true, value: '', onsend: vi.fn(), ...extra });
    live = mount(PawBar, { target, props });
    flushSync();
    return { target, props };
  }
  const mic = (t: HTMLElement) => t.querySelector<HTMLButtonElement>('button.mic');
  const field = (t: HTMLElement) => t.querySelector('textarea')!;
  const press = (b: HTMLButtonElement) => {
    b.click();
    flushSync();
  };

  it('is shown on the open card where speech recognition exists', () => {
    const { target } = bar();
    const b = mic(target)!;
    expect(b).not.toBeNull();
    expect(b.getAttribute('aria-label')).toBe('Dictate');
    expect(b.getAttribute('aria-pressed')).toBe('false');
    // Immediately left of Send.
    expect(b.nextElementSibling?.classList.contains('send')).toBe(true);
  });

  it('is hidden when the browser has no speech recognition', () => {
    delete win.SpeechRecognition;
    expect(mic(bar().target)).toBeNull();
  });

  it('is hidden when the owner turns voice off', () => {
    expect(mic(bar({ voice: false }).target)).toBeNull();
  });

  it('is not on the resting pill', () => {
    expect(mic(bar({ expanded: false }).target)).toBeNull();
  });

  it('is disabled while the chat is read-only', () => {
    expect(mic(bar({ readonly: true }).target)!.disabled).toBe(true);
  });

  it('writes interim and final words after the existing draft, and never sends', () => {
    const { target, props } = bar({ value: 'Do you ship ' });
    const b = mic(target)!;
    press(b);
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(b.getAttribute('aria-label')).toBe('Stop dictation');
    expect(b.classList.contains('listening')).toBe(true);
    const rec = last();
    rec.say([{ text: 'to' }]);
    flushSync();
    expect(props.value).toBe('Do you ship to');
    expect(field(target).value).toBe('Do you ship to');
    rec.say([{ text: 'to Canada', final: true }]);
    flushSync();
    expect(props.value).toBe('Do you ship to Canada');
    rec.end();
    flushSync();
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(field(target));
    expect(props.onsend).not.toHaveBeenCalled();
  });

  it('a second press stops listening and keeps what was heard', () => {
    const { target, props } = bar();
    const b = mic(target)!;
    press(b);
    const rec = last();
    rec.say([{ text: 'hello' }]);
    press(b);
    expect(rec.stopped).toBe(true);
    expect(b.getAttribute('aria-pressed')).toBe('false');
    rec.say([{ text: 'hello world', final: true }]);
    rec.end();
    flushSync();
    expect(props.value).toBe('hello world');
  });

  it('Escape stops listening before it closes anything', () => {
    const { target, props } = bar();
    press(mic(target)!);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(last().stopped).toBe(true);
    expect(props.expanded).toBe(true);
  });

  it('sending drops the recognizer, so a late result cannot refill the field', () => {
    const { target, props } = bar();
    press(mic(target)!);
    const rec = last();
    rec.say([{ text: 'hi there' }]);
    flushSync();
    field(target).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    flushSync();
    expect(props.onsend).toHaveBeenCalledWith('hi there');
    expect(rec.aborted).toBe(true);
    rec.say([{ text: 'hi there', final: true }]);
    flushSync();
    expect(props.value).toBe('');
  });

  it('a blocked mic does not throw: it resets, announces, and says so in the title', () => {
    const { target } = bar();
    const b = mic(target)!;
    press(b);
    expect(() => {
      last().fail('not-allowed');
      flushSync();
    }).not.toThrow();
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.title).toBe('Microphone blocked');
    expect(target.querySelector('[role="status"]')!.textContent).toMatch(/Microphone blocked/);
  });

  it('reads "Listening…" in the empty field while listening, and goes back after', () => {
    const { target } = bar({ placeholder: 'Ask anything…' });
    press(mic(target)!);
    expect(field(target).placeholder).toBe('Listening…');
    last().end();
    flushSync();
    expect(field(target).placeholder).toBe('Ask anything…');
  });

  it('a blocked mic shows the mic-off glyph and a visible fix, cleared by typing', () => {
    const { target } = bar();
    const b = mic(target)!;
    press(b);
    last().fail('not-allowed');
    flushSync();
    expect(b.classList.contains('blocked')).toBe(true);
    const note = target.querySelector('.voice-note')!;
    expect(note.textContent).toMatch(/Allow it in your browser/);
    // Heard via the status line, so the visible copy is hidden from AT.
    expect(note.getAttribute('aria-hidden')).toBe('true');
    const f = field(target);
    f.value = 'x';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(target.querySelector('.voice-note')).toBeNull();
    // Still blocked until a retry succeeds.
    expect(b.classList.contains('blocked')).toBe(true);
  });

  it('a retry after a block clears the blocked look while listening', () => {
    const { target } = bar();
    const b = mic(target)!;
    press(b);
    last().fail('not-allowed');
    flushSync();
    press(b);
    expect(b.classList.contains('blocked')).toBe(false);
    expect(b.classList.contains('listening')).toBe(true);
  });

  it('closing the card releases the recognizer', () => {
    const { target, props } = bar();
    press(mic(target)!);
    props.expanded = false;
    flushSync();
    expect(last().aborted).toBe(true);
  });

  it('unmounting releases the recognizer', () => {
    const { target } = bar();
    press(mic(target)!);
    const rec = last();
    unmount(live!);
    live = null;
    expect(rec.aborted).toBe(true);
  });
});
