// tests/resume-view.spec.svelte.ts — opening the bar shows the thread you left.
// Created 2026-08-21, second half of the "i had a chat but i don't see my chat
// history" report. The first half (tests/resume.spec.ts) was storage: the turns
// were filed under a key the reload did not look at. This half is the view.
//
// Even with the turns correctly restored into the store, the panel mounted with
// inConversation=false and messengerTab='home', so a returning visitor was shown
// the greeting and the starter questions — the new-visitor screen — with their
// conversation one unmarked tap away inside Messages. Nothing was lost; it was
// unreachable, which reads exactly the same from the outside.
//
// The shell already holds this position elsewhere: handleBarSend lands the
// visitor IN the conversation "because the reply they just asked for is about to
// stream somewhere they can see it". A thread they already have is the same
// claim with the tense changed.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import GlassShell from '../src/components/GlassShell.svelte';
import { ChatStore } from '../src/store/chat.svelte';
import { CartStore } from '../src/store/cart.svelte';
import { ContactStore } from '../src/store/contact.svelte';
import { OperatorStore } from '../src/store/operator.svelte';
import { ConversationsStore } from '../src/store/conversations.svelte';
import { createPoster } from '../src/lib/postmessage';
import { saveTranscript } from '../src/lib/transcript';

const config = { endpoint: 'http://test.local/api/v1', widgetId: 'w1', siteKey: 'k1' };

let live: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  window.localStorage.clear();
  // Every network read this shell makes degrades to a safe empty value; the
  // thread under test comes from storage, which is the point.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  // Ask for reduced motion. lib/motion then returns a 0ms duration and Svelte
  // swaps the layers instantly, which is what makes these assertions readable:
  // mid-transition the shell holds the view being LEFT and the one arriving in
  // the DOM at once (they are stacked .layer siblings), so textContent shows
  // both and "is the conversation on screen" has no answer. Reduced motion is a
  // real supported mode, not a test-only shortcut — these tests assert which
  // view is shown, never how it travelled.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function render() {
  const store = new ChatStore(config);
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(GlassShell, {
    target,
    props: {
      store,
      cart: new CartStore(config),
      contact: new ContactStore(config),
      operator: new OperatorStore(store, config),
      conversations: new ConversationsStore(config),
      chatConfig: config,
      poster: createPoster(''),
      greeting: 'Hi there 👋',
      starters: ['What are your hours?'],
    },
  });
  flushSync();
  return { store, target };
}

/** Click the docked bar the way a visitor does. */
function openPanel(target: HTMLElement) {
  const launcher = target.querySelector<HTMLButtonElement>('button.mascot');
  expect(launcher, 'the docked bar should offer a way in').toBeTruthy();
  launcher!.click();
  flushSync();
}

/** Leave the panel. Escape peels one layer at a time and the conversation has
 *  already been left, so a single press closes the panel itself. */
function closePanel() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  flushSync();
}

/** Let an out-transition actually leave. Svelte keeps the outgoing layer in the
 *  DOM until its animation resolves, and the two layers are stacked, so reading
 *  textContent mid-flight sees BOTH the view being left and the one arriving. */
async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
}

describe('a returning visitor with a thread on this device', () => {
  it('opens into the conversation, not the new-visitor greeting', () => {
    saveTranscript(
      'w1',
      [
        { id: 'a', role: 'user', content: 'Hey', status: 'done' },
        { id: 'b', role: 'assistant', content: 'Welcome to Darpan.', status: 'done' },
      ],
      '',
    );

    const { store, target } = render();
    expect(store.messages, 'precondition: the store restored the thread').toHaveLength(2);

    openPanel(target);

    expect(target.textContent).toContain('Welcome to Darpan.');
  });

  it('takes no for an answer once the visitor backs out', async () => {
    saveTranscript(
      'w1',
      [{ id: 'a', role: 'user', content: 'Hey', status: 'done' }],
      '',
    );
    const { target } = render();
    openPanel(target);

    const back = target.querySelector<HTMLButtonElement>('button[aria-label="Back to messages"]');
    expect(back, 'the conversation should offer a way out').toBeTruthy();
    back!.click();
    await settle();

    // Close, then reopen. Resuming AGAIN here would make the Messages list
    // unreachable: every attempt to leave the thread would put them back in it.
    closePanel();
    await settle();
    openPanel(target);
    await settle();

    expect(target.querySelector('button[aria-label="Back to messages"]')).toBeNull();
  });

  it('still greets a visitor who has never said anything', () => {
    const { target } = render();

    openPanel(target);

    expect(target.textContent).toContain('Hi there');
    expect(target.textContent).toContain('What are your hours?');
  });
});
