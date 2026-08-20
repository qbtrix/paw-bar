// tests/setup.ts — the browser APIs jsdom does not implement.
// Created 2026-08-19.
//
// jsdom has no ResizeObserver, and the widget's two size-sensitive behaviours
// both depend on one: the shell reports its docked box, and the tab bar decides
// whether its labels fit. A no-op stub would let those components mount, but it
// would also make every test of them silently vacuous — the callback never
// fires, so the behaviour under test never runs.
//
// So this stub is DRIVABLE. Tests reach for `resizeObservers` and invoke the
// callbacks themselves, which is the only way to exercise size-driven logic in
// an environment with no layout. Sizes still have to be stubbed per test
// (jsdom reports 0 for every box); this just supplies the trigger.

interface FakeObserver {
  callback: ResizeObserverCallback;
  targets: Element[];
  /** Fire this observer as the browser would, with a minimal entry per target. */
  fire(): void;
}

export const resizeObservers: FakeObserver[] = [];

class TestResizeObserver implements ResizeObserver {
  #record: FakeObserver;

  constructor(callback: ResizeObserverCallback) {
    this.#record = {
      callback,
      targets: [],
      fire: () => {
        const entries = this.#record.targets.map(
          (target) =>
            ({
              target,
              contentRect: target.getBoundingClientRect(),
            }) as unknown as ResizeObserverEntry,
        );
        callback(entries, this);
      },
    };
    resizeObservers.push(this.#record);
  }

  observe(target: Element): void {
    this.#record.targets.push(target);
  }

  unobserve(target: Element): void {
    const i = this.#record.targets.indexOf(target);
    if (i >= 0) this.#record.targets.splice(i, 1);
  }

  disconnect(): void {
    this.#record.targets.length = 0;
    const i = resizeObservers.indexOf(this.#record);
    if (i >= 0) resizeObservers.splice(i, 1);
  }
}

globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

// ── Web Animations ──────────────────────────────────────────────────────────
// 2026-08-21. jsdom implements no part of the Web Animations API, and Svelte's
// own transitions drive every one of them through `element.animate()`. Any test
// that mounts a component with a `transition:`/`in:`/`out:` directive therefore
// died at first paint with "element.animate is not a function" — which is why
// the shell, the single most transition-heavy component in the app, had no test
// that mounted it.
//
// This one is deliberately NOT drivable, unlike the ResizeObserver above. There
// is no behaviour here worth exercising: the transitions are decoration, the
// tests care about what is on screen once things settle, and a stub that
// resolves immediately is the honest model of "the animation finished". Anything
// that asserted on animation TIMING would need the real thing, not a better
// fake, so it is better that such a test cannot accidentally pass.
class TestAnimation implements Partial<Animation> {
  currentTime = 0;
  startTime = 0;
  playState = 'finished' as AnimationPlayState;
  pending = false;
  finished: Promise<Animation>;
  onfinish: ((this: Animation, ev: AnimationPlaybackEvent) => unknown) | null = null;
  oncancel: ((this: Animation, ev: AnimationPlaybackEvent) => unknown) | null = null;

  constructor() {
    this.finished = Promise.resolve(this as unknown as Animation);
  }

  play(): void {}
  pause(): void {}
  cancel(): void {}
  finish(): void {}
  reverse(): void {}
  updatePlaybackRate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = function animate(): Animation {
    return new TestAnimation() as unknown as Animation;
  };
}

if (typeof Element !== 'undefined' && !Element.prototype.getAnimations) {
  Element.prototype.getAnimations = function getAnimations(): Animation[] {
    return [];
  };
}
