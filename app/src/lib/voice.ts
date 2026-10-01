// voice.ts — dictation for the bar's field: a thin wrapper over the browser's
// Web Speech API (SpeechRecognition, or webkitSpeechRecognition in Chrome and
// Safari). Firefox has neither, so voiceSupported() is false there and the bar
// shows no mic.
//
// One utterance per start(): continuous off, interim results on, so the text
// streams into the field while the visitor speaks and the recognizer stops by
// itself on silence. Errors collapse to four kinds the UI can word: 'denied'
// (mic or service blocked), 'no-speech', 'network', 'other'. Invariants:
// onEnd fires exactly once per start(), nothing here throws, and abort()
// detaches every callback, so a destroyed component is never called back.
//
// Privacy: the browser sends the audio to its vendor (Google, Microsoft, Apple)
// to transcribe.
// The owner's `voice: false` boot flag turns the mic off (config.ts).
//
// TypeScript's DOM lib has no SpeechRecognition types; the minimal shapes
// below are local, not global, so nothing else in the app can lean on them.

export type DictationError = 'denied' | 'no-speech' | 'network' | 'other';

export interface DictationOptions {
  /** BCP 47 tag; defaults to the document's language, then the browser's. */
  lang?: string;
  /** The whole utterance so far. `isFinal` once the recognizer settles it. */
  onText: (text: string, isFinal: boolean) => void;
  /** Listening is over, for any reason. Fires once per start(). */
  onEnd: () => void;
  onError?: (kind: DictationError) => void;
}

export interface Dictation {
  start(): void;
  /** Stop listening; whatever was heard still arrives as a final result. */
  stop(): void;
  /** Stop and drop everything: no more callbacks of any kind. */
  abort(): void;
}

// ── Minimal Web Speech shapes ───────────────────────────────────────────────
interface SpeechAlternative {
  readonly transcript: string;
}
interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  readonly [index: number]: SpeechResult;
}
export interface SpeechRecognitionResultEventLike {
  readonly results: SpeechResultList;
}
export interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type SpeechWindow = {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};

function recognizerCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function voiceSupported(): boolean {
  return typeof recognizerCtor() === 'function';
}

export function errorKind(code: string): DictationError {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'denied';
  if (code === 'no-speech') return 'no-speech';
  if (code === 'network') return 'network';
  return 'other';
}

function defaultLang(): string {
  return (typeof document !== 'undefined' && document.documentElement.lang) || navigator.language || 'en-US';
}

export function createDictation(opts: DictationOptions): Dictation {
  const Ctor = recognizerCtor();
  let rec: SpeechRecognitionLike | null = null;
  let ended = false;

  function finish() {
    if (ended) return;
    ended = true;
    detach();
    opts.onEnd();
  }
  function detach() {
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
  }
  function fail(kind: DictationError) {
    if (ended) return;
    opts.onError?.(kind);
    finish();
  }

  return {
    start() {
      if (rec) return;
      if (!Ctor) return fail('other');
      try {
        rec = new Ctor();
        rec.lang = opts.lang || defaultLang();
        rec.continuous = false;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.onresult = (e) => {
          let text = '';
          let isFinal = e.results.length > 0;
          for (let i = 0; i < e.results.length; i++) {
            const r = e.results[i];
            text += r?.[0]?.transcript ?? '';
            if (!r?.isFinal) isFinal = false;
          }
          opts.onText(text, isFinal);
        };
        rec.onerror = (e) => fail(errorKind(e.error));
        rec.onend = finish;
        rec.start();
      } catch {
        fail('other');
      }
    },
    stop() {
      try {
        rec?.stop();
      } catch {
        finish();
      }
      if (!rec) finish();
    },
    abort() {
      ended = true; // no onEnd: the caller is the one tearing down
      detach();
      try {
        rec?.abort();
      } catch {
        /* already stopped */
      }
    },
  };
}
