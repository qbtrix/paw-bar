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
