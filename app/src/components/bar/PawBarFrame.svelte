<!--
  PawBarFrame.svelte — the parent surface around the PawBar input.
  Created 2026-09-27.

  At rest, and while the bar is only open as its own card, the frame paints
  nothing: no padding, fill, border or blur, so it is exactly the bar. The
  glass surface fades in only when something sits above the input (the thread,
  the history list, the consent line or a notice). Once a conversation exists and
  the bar is open, a thread grows ABOVE the input inside the same frame: the
  visitor's turns as right-aligned bubbles, replies as plain text, a pending
  reply as three dots.

  The frame never states its own size. Its width is the input's width plus
  padding, and the input already springs its own size, so the frame follows it
  frame by frame. The thread's height springs toward the measured height of its
  contents (capped, then it scrolls), so a new turn or a streaming reply grows
  the frame instead of snapping it.

  LAYOUT TOKENS. The frame uses PawBar's spacing scale and reads the same
  public tokens: --pawbar-space (the unit: 3.5 / 4 / 4.5px for sm / md / lg;
  every gap, padding and margin is ½, 1, 2, 3, 4 or 6 units) and --pawbar-gap
  (2 units). The rule: frame pad = section gap = bar gap by default. The
  frame's padding is --pawbar-frame-pad, falling back to --pawbar-gap, and the
  same gap separates the header, thread, consent line, notice, bar and the
  credit below. Size tokens shared with the bar: --pawbar-height (its half is
  the default radius), --pawbar-launcher-size, --pawbar-pill-width,
  --pawbar-card-width, --pawbar-font-size(-sm), --pawbar-logo-size. The
  thread's own type: --pawbar-message-size and --pawbar-meta-size.

  2026-09-27 (old shell removed): comments below that mention the old shell,
  glass.css or GlassShell describe where things came from. That code is gone;
  this thread's own markdown and form-card styles are the only ones left.

  2026-09-27 (scrollbar flicker): the thread only scrolls once its content is
  past the cap, and always reserves the gutter. It used to be `overflow-y:
  auto` throughout, so a streaming reply briefly overflowing the still-growing
  spring flipped the scrollbar on and off and reflowed the text each time.

  2026-09-27 (branding): passes the site's `logoSrc` to the pill, and shows a
  "Powered by Paw Sites" line whenever the bar is open (hover, focus, a draft,
  or a conversation). The credit sits OUTSIDE the frame, below it on the host
  page, not inside the chat surface. Frame and credit share an unstyled
  wrapper, which is the hover/click boundary, so the pointer can travel from
  the card down onto the credit without the bar folding. `poweredBy={false}` turns it off; `poweredByHref` makes
  it a link.

  2026-09-27 (sizes + launchers): passes `launcher` ('bar' | 'icon'), `side`,
  `size`, `resizable` and `voice` (the dictation mic) through to PawBar. The frame follows the bar's
  EFFECTIVE size (the visitor's pick wins over the site's), scaling the thread
  cap, message type and corner radius with it, and aligns the surface and the
  credit to the icon launcher's corner.

  2026-09-27 (full screen + bigger sizes): binds PawBar's `fullscreen`. On,
  the wrapper covers the viewport over a blurred scrim (--pawbar-scrim), the
  frame fills it, the thread takes every row above the input and scrolls, and
  its text sits in the same reading column as the card. The thread's spring
  height is dropped while full screen, because the layout, not the content,
  decides its height there. Thread caps and message type grew with the sizes.

  2026-09-27 (themes): `theme` picks a preset from lib/bar-themes (Default,
  Midnight, Geist, Indigo, Paper, Glass) and `tokens` overrides any --pawbar-*
  value on top of it; `tokensDark` goes over `tokens` while `scheme` is dark
  and is removed again when it turns light. Both land on the wrapper through the typed CSSOM
  (setProperty), never a concatenated style string, and a theme switch clears
  the keys the previous one set so nothing leaks between them.

  2026-09-27 (credit pill): the credit has its own small surface in the
  frame's colours. It sits on the host page, whose colour no theme can know,
  so bare text vanished on one kind of page or the other (dark ink on a dark
  site under the light themes).

  2026-09-27 (owner radius): `radius` (px, 0–40) is the owner's corner
  setting. It becomes --pawbar-radius and wins over the theme's own radius
  and over `tokens`. Every corner follows it: the surfaces directly, the
  bubbles and the credit pill capped at their own natural size (so 40px does
  not turn a one-line bubble into a lozenge). Circles stay circles. It is an
  OWNER setting only; visitors never see it.

  2026-09-27 (states groundwork): `BarMessage` IS the chat store's Message
  (role user|assistant|owner|system, content, status streaming|done|error,
  optional sources). It used to be a parallel shape with a `pending` flag, so
  wiring the real store in would have been a rewrite; now it is a hand-off.
  A done reply with a page `action` shows its line underneath ("Taking you to
  …", "Showing …", "Here's the page", "I couldn't find that on this page"), or,
  when the site has no actions script, a link that opens the page in a tab.
  A site tool waiting on the visitor (state 'confirm') shows its label with
  Confirm / Cancel, which call `ontoolanswer(id, yes)`; after that its line is
  the host's result message, or "Done" / "That didn't work" / "Cancelled".
  A reload shows an unanswered one as "<label> · Not done" with no buttons.

  2026-09-27 (conversation states, spec docs/design/drafts/2026-09-27-paw-bar-
  states-ux-conversation.md + -bar-and-flows.md):
  • C1 empty: pinned with no turns shows the owner's `greeting` (or ours) as
    the bot's first line. C2 `restoring`: a delayed "Loading your
    conversation…" instead, and turns that arrive several at once do not fly
    in (a restore mints fresh ids, which would replay every row's entrance).
  • C3 thinking: calm dots, "Still thinking…" after 8s; words, not dots, under
    reduced motion. C4 streaming: derived from `messages` and passed down, so
    the bar swaps Send for Stop (`onstop`). C5: a reply stopped part-way says
    "Stopped". C6: a done reply has Copy and, when it has any, Sources.
  • C8 `botPaused`: a notice above the input and "Reply to the team…" as the
    placeholder. C9: team (owner) turns are left bubbles under a `teamLabel`
    line. C10: system turns are quiet centred chips. C12: a row that fails to
    render costs that row only ("This message couldn't be displayed.").
  • B8 activity: derived from `messages` and a seen-marker (`seenId`,
    bindable; `onseenchange` lets the host persist it). It advances only while
    the thread is showing and the bar is PINNED, so hovering (which shows the
    history too) never marks news as read. `activity` overrides it
    (owner preview).
  • Failures (spec -ux-failures.md), all fed straight from ChatStore:
    a failed turn carries `failure`, and its note sits under the turn that
    failed: the visitor's ("Not sent", "Waiting for connection" while queued
    offline) or the reply ("The reply was cut off", "No answer came back").
    Only the newest failure offers Try again, inert during a cooldown.
    `notice` is the store's ONE near-input line (unavailable > rejected >
    offline > cooldown > takeover > waiting); the cooldown one counts down
    from `cooldownUntil`. `unavailable` makes the input read-only with its own
    placeholder; `cooldownUntil` and `queueFull` hold Send. The notice's
    "Leave your email" action opens the bar's Talk-to-a-person panel
    (`onrequesthuman`, `handoff`). A reply the server could not answer
    (`unavailable` reason): 'temporary' notes "I couldn't answer that just
    now." with Try again; 'limit' is said by the near-input line instead.
  • `scheme` ('light' | 'dark') is the host's scheme, resolved by the mount
    point (lib/scheme.ts); themes with overlays (Default) follow it, branded
    ones ignore it. It is on the wrapper as data-pawbar-scheme.
  • Narrow screens (under 600 × 620, the loader's sheet threshold): pinning
    the bar with a conversation opens it full screen, where it has room.
  • The thread is the ONE live region: role="log", additions only; each
    reply re-mounts when it finishes, so it is announced whole, once.

  2026-09-27 (section E, spec -ux-bar-and-flows.md): rich replies and the
  side flows.
  • Assistant replies render through Markdown.svelte (lib/markdown: since
    2026-09-27 a parsed tree drawn with text bindings, no HTML string; every
    link forced to a new tab with noopener), still
    inside `{#key m.status}` with the sr-only prefix. Owner and system turns
    stay TEXT. The old shell's `.pawbar-md` styles are global in glass.css and
    keyed to its own token scale, which this bar does not load, so the thread
    styles markdown, code blocks, the stream shimmer and the form card itself
    (`.frame :global(…)`), all from --pawbar-frame-fg.
  • E2/E3: optional `cart` and `contact` stores are provided to the cards in
    context, and provideBarThread() tells them they sit in this thread (no
    live-region roles inside the log, compact copy, product cards through
    BarCatalog). Without a cart a card renders "Card unavailable".
  • E1: the contact prompt is the thread's tail item, driven by `contact`
    (copy word for word from GlassShell), and a reply that settles as done
    asks it to `maybeOffer()` once. A "Cart · N · Checkout ↗" row joins the
    tail while the cart holds anything.
  • E4: the conversation list now IS in this bar (see Sessions below).

  2026-09-27 (sessions + compliance, PRD V4/V5/V8/V12/V13):
  • `conversations` (the ConversationsStore's rows, as is) and
    `conversationId`. The clock icon in the card's top row (once there is a
    conversation to list) swaps the thread for a list in the same surface:
    Back, the title, and one row per conversation (preview,
    age, "Waiting on team" for needs_human, "Current" on the active one); a
    row calls `onopenconversation`. While the list shows, the bar's card is
    replaced by one "New conversation" button (PawBar `footer`), since a
    field there would type into a conversation the visitor is not looking
    at. `onnewconversation` runs only when the current thread has turns (an
    empty one is already new; the button just goes back to it). Leaving the
    list brings the field back with focus in it and the draft intact. Next
    to the clock, a "+" (New chat) starts a fresh conversation straight from
    the thread, shown only while `onnewconversation` is set and the thread
    has turns. The header's right side is a ✕ that closes the bar outright
    (PawBar closeChat).
  • `hostViewport` ({w, h} of the HOST page): set by the widget's shell,
    which lives in an iframe sized from this content. The thread cap, the
    narrow-screen check and every width clamp read it instead of the
    window, which inside that iframe is the content's own size and would
    shrink it a step per layout (see PawBar's header). It lands on the
    wrapper as --pb-host-w / --pb-host-h. Absent (the demo, a standalone
    mount), the window is the viewport and is used as before.
    `onopenchange` reports the card opening and closing, and
    `outsidePress()` / `closeChat()` are exported, all for the shell.
  • No suggestion chips (captain, 2026-09-27): the `suggestions` prop is gone
    along with PawBar's; the agent's starters are not shown anywhere.
  • Header (captain, 2026-09-27: the ✕ belongs at the top, not in the
    input). Whenever the thread shows, a slim row sits at the top of the
    frame: the conversations clock on the left, full screen (`expandable`)
    and ✕ on the right. The bar's card keeps only the field, the chips and
    Send (PawBar `chrome={false}`). The list's own header (Back, title, ✕)
    takes its place while the list is open. A card opened by hover alone,
    with nothing to show, has no header; it closes when the pointer leaves. None of it is in a ⋯ menu any
    more (captain, 2026-09-27), and `resizable` (the visitor size menu) is
    off by default. The list is a plain region, never inside the
    live log, and Escape inside it goes back to the thread. A conversation
    switch is a bulk replace: no row flies in, and following resets.
  • "↓ New message": when the reader has scrolled up and a turn arrives or
    grows, a jump pill floats over the bottom of the thread. Sending always
    follows again.
  • `persistKey` (the widget id) keeps the bar's own state per tab in
    sessionStorage (lib/bar-session): pinned, full screen, the draft, the
    scroll position. It is written on every state change and again on
    `pagehide`, because scrolling changes no state and the position that
    matters is the one at the moment of the click that left the page. On the next page a bar that was open comes back CLOSED,
    as a continue pill with the last answer's first line (activity
    'resume'); opening it restores full screen and the scroll position. The
    draft is handed back on the first pin, never on load, because a draft
    holds the card open and that would be an auto-open. Nothing is written
    before the bar has opened once, or while consent is required.
  • AI disclosure (EU AI Act Art. 50): a line under the open bar, always.
    `disclosure` rewords it and cannot remove it (blank falls back to ours).
    It rides with "Powered by Paw Sites" but not on `poweredBy`, adds
    `privacyHref` as a Privacy link, and describes the field for screen
    readers.
  • `consent` 'required' (the host's CMP said so): a one-line step under the
    thread while the bar is open. Sending holds the message (the draft stays)
    and highlights the step; Accept calls `onconsent(true)` and the held
    message goes as soon as `consent` turns 'granted'. "Not now" hides the
    step until the next send. This is a UI gate only: the mount point must
    not build the chat store before consent for it to mean anything.

  Messages are data in, events out: the frame renders `messages` and reports
  `onsend`. It holds no transcript of its own.

  Theming: `--pawbar-frame-*` for the parent surface and the thread text,
  `--pawbar-bubble-*` for the visitor's bubbles. Same rule as PawBar: fallbacks
  only, never declarations on our own element, so a site's values always win.
  No elevation shadow, same as PawBar (the team dropped them 2026-08-19).
-->
<script lang="ts" module>
  import type { Message } from '../../store/chat.svelte';
  /** The chat store's own turn shape, so ChatStore.messages passes straight in. */
  export type BarMessage = Message;
  /** The ConversationsStore's own row, so its `items` pass straight in. */
  export type BarConversation = VisitorConversation;
  export type BarConsent = 'granted' | 'required';
  export const DEFAULT_DISCLOSURE = 'AI assistant. Answers can be wrong.';
</script>

<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import { fade, fly, slide } from 'svelte/transition';
  import { Spring, prefersReducedMotion } from 'svelte/motion';
  import PawBar, {
    previewLine,
    type BarActivity,
    type BarContactRequest,
    type BarContactResult,
    type BarLauncher,
    type BarSendResult,
    type BarSide,
    type BarSize,
  } from './PawBar.svelte';
  import { resolveTheme, type BarScheme } from '../../lib/bar-themes';
  import { FAILURE_COPY, formatCopy, UNAVAILABLE_COPY } from '../../lib/chat-errors';
  import { actionLine } from '../../lib/page-actions';
  import type { Notice } from '../../store/chat.svelte';
  import Markdown from '../Markdown.svelte';
  import { provideCart, type CartStore } from '../../store/cart.svelte';
  import { provideContact, type ContactStore } from '../../store/contact.svelte';
  import { provideBarThread } from '../cards/thread';
  import type { VisitorConversation } from '../../lib/conversations-client';
  import { ago } from '../../lib/relative-time';
  import { readBarSession, writeBarSession } from '../../lib/bar-session';

  let {
    messages = [],
    placeholder,
    expanded = $bindable(false),
    logo,
    logoSrc = '',
    poweredBy = true,
    poweredByHref = '',
    launcher = 'bar',
    side = 'right',
    size = 'sm',
    resizable = false,
    expandable = true,
    voice = true,
    fullscreen = $bindable(false),
    theme = 'default',
    tokens = {},
    tokensDark = {},
    radius,
    scheme,
    greeting = '',
    restoring = false,
    botPaused = false,
    teamLabel = 'Team',
    seenId = $bindable(''),
    activity: activityOverride,
    onseenchange,
    onsend,
    onstop,
    onretry,
    notice = null,
    unavailable = null,
    cooldownUntil = null,
    queueFull = false,
    handoff = 'none',
    onrequesthuman,
    cart,
    contact,
    conversations = [],
    conversationId = '',
    onnewconversation,
    onopenconversation,
    persistKey = '',
    hostViewport = null,
    onopenchange,
    disclosure = '',
    privacyHref = '',
    consent = 'granted',
    onconsent,
    ontoolanswer,
  }: {
    messages?: BarMessage[];
    placeholder?: string;
    expanded?: boolean;
    logo?: Snippet;
    /** The site's brand logo, shown in the resting pill. */
    logoSrc?: string;
    /** The "Powered by Paw Sites" line under the open bar. */
    poweredBy?: boolean;
    poweredByHref?: string;
    launcher?: BarLauncher;
    side?: BarSide;
    /** The site's default size; the visitor can change it from ⋯. */
    size?: BarSize;
    resizable?: boolean;
    /** The full screen toggle in the header. */
    expandable?: boolean;
    /** PawBar's dictation mic (shown only where the browser supports it). */
    voice?: boolean;
    fullscreen?: boolean;
    /** A preset from lib/bar-themes. Unknown ids fall back to the default. */
    theme?: string;
    /** --pawbar-* overrides applied on top of the theme. */
    tokens?: Record<string, string>;
    /** --pawbar-* overrides applied over `tokens` while `scheme` is dark. */
    tokensDark?: Record<string, string>;
    /** Owner's corner radius in px (0–40). Overrides the theme's radius. */
    radius?: number;
    /** The host page's scheme; themes with light/dark overlays follow it. */
    scheme?: BarScheme;
    /** The owner's first line for an empty conversation. */
    greeting?: string;
    /** The thread is being fetched and nothing is cached yet. */
    restoring?: boolean;
    /** A person from the team has taken over; the bot is muted. */
    botPaused?: boolean;
    teamLabel?: string;
    /** The newest turn the visitor has seen. */
    seenId?: string;
    /** Forces the closed-bar activity (owner preview). */
    activity?: BarActivity;
    onseenchange?: (id: string) => void;
    onsend: (text: string) => void | BarSendResult | Promise<void | BarSendResult>;
    onstop?: () => void;
    /** Retry the failed turn with this id. */
    onretry?: (id: string) => void;
    /** The store's one near-input line. Without it, `botPaused` alone still
     *  shows the takeover notice. */
    notice?: Notice | null;
    /** The chat cannot take messages (store.unavailable). */
    unavailable?: { contactable: boolean } | null;
    /** Sending is paused until this time (ms since epoch). */
    cooldownUntil?: number | null;
    /** Offline with the queue full. */
    queueFull?: boolean;
    handoff?: 'none' | 'pending';
    /** Enables "Talk to a person". */
    onrequesthuman?: (req: BarContactRequest) => Promise<BarContactResult>;
    /** The visitor cart the reply cards act through. Without it cards read
     *  "Card unavailable". */
    cart?: CartStore;
    /** Drives the E1 "Leaving? We can email you…" tail. */
    contact?: ContactStore;
    /** The visitor's conversations (ConversationsStore.items). */
    conversations?: BarConversation[];
    /** The conversation `messages` belong to. A change is a switch. */
    conversationId?: string;
    /** Adds "New conversation" to ⋯. */
    onnewconversation?: () => void | Promise<void>;
    /** A row in the conversation list was picked. */
    onopenconversation?: (id: string) => void;
    /** Keeps the bar's own state across page loads in this tab (widget id). */
    persistKey?: string;
    /** The host page's viewport, when the bar lives in a content-sized iframe. */
    hostViewport?: { w: number; h: number } | null;
    /** The card opened or closed, for any reason (hover included). */
    onopenchange?: (open: boolean) => void;
    /** The owner's wording for the AI disclosure. It cannot be blank. */
    disclosure?: string;
    /** The owner's privacy policy, linked beside the disclosure. */
    privacyHref?: string;
    /** 'required' holds every send behind a one-line consent step. */
    consent?: BarConsent;
    onconsent?: (granted: boolean) => void;
    /** The visitor confirmed (true) or declined a site tool on reply `id`. */
    ontoolanswer?: (id: string, confirm: boolean) => void;
  } = $props();

  // The cards below the thread reach the stores through context, set once.
  provideBarThread();
  untrack(() => {
    if (cart) provideCart(cart);
    if (contact) provideContact(contact);
  });

  // Array.prototype.findLast is newer than the browsers the widget supports.
  function lastOf<T>(list: T[], pred: (x: T) => boolean): T | undefined {
    for (let i = list.length - 1; i >= 0; i--) if (pred(list[i])) return list[i];
    return undefined;
  }

  const DEFAULT_GREETING = 'Hi! Ask me anything about this site. Someone from the team can join if you need a person.';

  // ── Failures ──────────────────────────────────────────────────────────────
  // A clock that only ticks while a cooldown runs, for the countdown and for
  // releasing Send when it ends.
  let now = $state(Date.now());
  $effect(() => {
    if (!cooldownUntil) return;
    now = Date.now();
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const cooling = $derived(!!cooldownUntil && now < cooldownUntil);
  const secondsLeft = $derived(cooldownUntil ? Math.max(0, (cooldownUntil - now) / 1000) : 0);

  // The line above the input. The store derives it; the countdown text is
  // recomputed here each second. With no store notice, a takeover still shows.
  const line = $derived.by((): Notice | null => {
    if (notice?.kind === 'cooldown') {
      if (!cooling) return null;
      return { ...notice, text: formatCopy(FAILURE_COPY.rate_limited.line ?? '', secondsLeft) };
    }
    if (notice) return notice;
    return botPaused ? { kind: 'takeover', text: "You're chatting with the team" } : null;
  });
  const tone = $derived(
    !line ? '' : line.kind === 'unavailable' || line.kind === 'rejected' ? 'danger'
    : line.kind === 'offline' || line.kind === 'cooldown' ? 'warn'
    : line.kind === 'takeover' ? 'presence'
    : 'neutral',
  );
  // The notice is split so the contact offer can be a button, not a sentence.
  const CONTACT_TAIL = 'Leave your email and the team will get back to you.';
  const lineText = $derived(line?.action === 'contact' ? line.text.replace(CONTACT_TAIL, '').trim() : line?.text ?? '');

  // The note under a failed turn. A queued turn is waiting, not failed.
  function noteFor(m: BarMessage): string {
    if (m.status === 'queued') return FAILURE_COPY.offline.turn ?? 'Waiting for connection';
    if (m.role === 'assistant' && m.unavailable) return UNAVAILABLE_COPY[m.unavailable];
    if (m.role === 'assistant') return (m.failure && FAILURE_COPY[m.failure].turn) || 'Something went wrong with this reply.';
    return (m.failure && FAILURE_COPY[m.failure].turn) || 'Not sent';
  }
  // Retry is offered where a retry can work: never for an unavailable chat,
  // but yes for a reply the server could only not answer this time.
  const canRetry = (m: BarMessage) =>
    m.unavailable === 'temporary' || (m.failure !== 'unavailable' && m.failure !== 'rejected');

  // ── Theme ─────────────────────────────────────────────────────────────────
  let applied: string[] = [];
  $effect(() => {
    const el = frameEl;
    if (!el) return;
    const vars = resolveTheme(theme, tokens, scheme, tokensDark);
    if (typeof radius === 'number' && Number.isFinite(radius)) {
      vars['--pawbar-radius'] = `${Math.min(40, Math.max(0, Math.round(radius)))}px`;
    }
    for (const k of applied) if (!(k in vars)) el.style.removeProperty(k);
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
    applied = Object.keys(vars);
  });

  // What the bar is actually drawn at, reported by the bar itself.
  let barSize = $state<BarSize>('sm');
  const anchor = $derived(launcher === 'icon' ? side : 'center');

  // The thread shows while the bar is pinned open and there is something to
  // show. Escape or an outside click unpins the bar, which folds the thread
  // away with it and leaves the frame hugging the pill again.
  let frameEl: HTMLDivElement | null = $state(null);
  // Whether the bar is open for ANY reason, including hover, which `expanded`
  // (the pin) does not cover. Reported by the bar itself.
  let barOpen = $state(false);
  const pinned = $derived(expanded || fullscreen);
  const streaming = $derived(messages.some((m) => m.status === 'streaming'));

  // ── Activity on the closed bar (B8) ───────────────────────────────────────
  // The marker only ever points at a SETTLED turn: while a reply streams, the
  // marker stays on the turn before it, so a reply that finishes after the
  // bar folds still counts as new.
  const lastSettled = $derived(lastOf(messages, (m) => m.status !== 'streaming'));
  // No marker yet (first visit, or ids minted fresh by a restore): everything
  // already there counts as seen. A returning visitor gets no dot for a
  // conversation they have read.
  $effect(() => {
    if (seenId && messages.some((m) => m.id === seenId)) return;
    const id = untrack(() => lastSettled?.id ?? '');
    if (id !== seenId) seenId = id;
  });
  const unseen = $derived.by(() => {
    const i = messages.findIndex((m) => m.id === seenId);
    return messages.slice(i + 1).filter((m) => m.status !== 'streaming' && m.content);
  });
  const newestTeam = $derived(lastOf(unseen, (m) => m.role === 'owner'));
  const newestReply = $derived(lastOf(unseen, (m) => m.role === 'assistant'));
  const derivedActivity = $derived<BarActivity>(
    newestTeam ? 'team' : newestReply ? 'unread' : streaming ? 'thinking' : 'none',
  );

  // Hover shows the conversation so far, so a returning visitor can read the
  // history without sending anything (captain, 2026-09-27). The pin shows it
  // always, including the greeting or the loading line of an empty one; an
  // empty thread never grows the frame on a passing mouse.
  const showThread = $derived(pinned || (barOpen && messages.length > 0));


  // Seen advances only while the thread is on screen AND pinned.
  $effect(() => {
    if (!pinned || !lastSettled || lastSettled.id === seenId) return;
    seenId = lastSettled.id;
    untrack(() => onseenchange?.(lastSettled.id));
  });

  // ── E1: after a reply settles as done, one pending-decision check ────────
  // (the store guards itself: stored flag, session dismissal, in flight).
  let wasStreaming = false;
  $effect(() => {
    const now = streaming;
    if (wasStreaming && !now) {
      const last = untrack(() => messages[messages.length - 1]);
      if (last?.role === 'assistant' && last.status === 'done') void untrack(() => contact)?.maybeOffer();
    }
    wasStreaming = now;
  });
  let contactEmail = $state('');
  const contactErrId = `pbf-cerr-${Math.random().toString(36).slice(2, 8)}`;
  function submitContact(e: SubmitEvent) {
    e.preventDefault();
    void contact?.submit(contactEmail);
  }

  // ── Consent (V13) ─────────────────────────────────────────────────────────
  // A send while consent is required is held, not dropped: the draft goes back
  // in the field, and the message goes out the moment consent is granted.
  const needsConsent = $derived(consent === 'required');
  let held = $state('');
  let consentHidden = $state(false);
  const consentId = `pbf-consent-${Math.random().toString(36).slice(2, 8)}`;
  const showConsent = $derived(needsConsent && !unavailable && barOpen && (!consentHidden || !!held));
  const showLine = $derived(
    !!line && (showThread || line.kind === 'unavailable' || line.kind === 'rejected'),
  );
  // The glass surface only paints when something sits above the input. With
  // nothing there the frame collapses onto the bar (no padding, fill, border
  // or blur), so the pill and its hover card read as themselves.
  const surface = $derived(showThread || showConsent || showLine);
  function acceptConsent() {
    consentHidden = true;
    onconsent?.(true);
  }
  function declineConsent() {
    held = '';
    consentHidden = true;
    onconsent?.(false);
    bar?.focus();
  }
  $effect(() => {
    if (needsConsent || !held) return;
    const text = untrack(() => held);
    held = '';
    if (untrack(() => draft.trim()) === text) draft = '';
    void untrack(() => send(text));
  });

  function send(text: string): ReturnType<typeof onsend> {
    if (needsConsent) {
      held = text;
      consentHidden = false;
      return { ok: false, restoreDraft: text };
    }
    expanded = true;
    // Whoever sends wants to see the answer.
    following = true;
    missed = false;
    return onsend(text);
  }

  // ── AI disclosure (Art. 50) ───────────────────────────────────────────────
  const disclosureText = $derived(disclosure.trim() || DEFAULT_DISCLOSURE);
  const disclosureId = `pbf-ai-${Math.random().toString(36).slice(2, 8)}`;

  // ── Sessions: the list, new conversation ──────────────────────────────────
  let view = $state<'thread' | 'history'>('thread');
  const history = $derived(view === 'history');
  let historyEl: HTMLElement | null = $state(null);
  async function showConversations() {
    expanded = true;
    view = 'history';
    await tick();
    historyEl?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }
  // The field only exists again once the list is gone, so focus waits a tick.
  async function focusField() {
    await tick();
    bar?.focus();
  }
  function backToThread() {
    view = 'thread';
    void focusField();
  }
  function openConversation(id: string) {
    view = 'thread';
    if (id !== conversationId) onopenconversation?.(id);
    void focusField();
  }
  async function newConversation() {
    view = 'thread';
    if (messages.length > 0) await onnewconversation?.();
    void focusField();
  }
  /** For the widget shell: a click on the host page, and the loader's close. */
  export function outsidePress() {
    bar?.outsidePress();
  }
  export function closeChat() {
    void bar?.closeChat();
  }

  async function toggleFull() {
    fullscreen = !fullscreen;
    await focusField();
  }
  const canList = $derived(
    !!(onopenconversation || onnewconversation) && (conversations.length > 0 || messages.length > 0),
  );
  // The header's quick "+": only when there is a conversation to leave.
  const canNew = $derived(!!onnewconversation && messages.length > 0);
  // The list is a pinned view: folding the bar puts the thread back.
  $effect(() => {
    if (!pinned) view = 'thread';
  });
  const WAITING_STATES = new Set(['needs_human', 'waiting']);
  let listNow = $state(Date.now());
  $effect(() => {
    if (!history) return;
    listNow = Date.now();
    const t = setInterval(() => (listNow = Date.now()), 60_000);
    return () => clearInterval(t);
  });

  // ── Across page loads (V12) ───────────────────────────────────────────────
  // Read once. The bar comes back closed; the continue pill offers the rest.
  const restored = untrack(() => readBarSession(persistKey));
  let heldDraft = restored?.draft ?? '';
  let draft = $state('');
  let resume = $state(!!restored?.open);
  let everOpened = !!restored;
  const lastAnswer = $derived(lastOf(messages, (m) => m.role === 'assistant' && m.status === 'done' && !!m.content));
  $effect(() => {
    if (barOpen) everOpened = true;
  });
  // The first pin hands the draft back, and a resumed bar gets its full
  // screen and scroll position back.
  $effect(() => {
    if (!pinned) return;
    untrack(() => {
      if (heldDraft && !draft) draft = heldDraft;
      heldDraft = '';
      if (!resume) return;
      resume = false;
      if (restored?.full) fullscreen = true;
      const top = restored?.scroll;
      if (typeof top === 'number') {
        following = false;
        void tick().then(() => tick()).then(() => {
          if (threadEl) threadEl.scrollTop = top;
        });
      }
    });
  });
  function snapshot() {
    if (!persistKey || !everOpened || needsConsent) return;
    writeBarSession(persistKey, {
      open: pinned || (resume && messages.length > 0),
      full: fullscreen || (resume && !!restored?.full),
      draft: draft || heldDraft,
      scroll: following || !threadEl ? null : threadEl.scrollTop,
      at: Date.now(),
    });
  }
  $effect(() => {
    void pinned;
    void fullscreen;
    void draft;
    void barOpen;
    untrack(snapshot);
  });


  // Resuming is the quietest thing the pill can say: any news wins over it.
  const resuming = $derived(resume && !!lastAnswer && derivedActivity === 'none');
  const activity = $derived<BarActivity>(activityOverride ?? (resuming ? 'resume' : derivedActivity));
  const unreadPreview = $derived(
    previewLine((newestTeam ?? newestReply ?? (resuming ? lastAnswer : undefined))?.content ?? ''),
  );

  // ── Thread content ────────────────────────────────────────────────────────
  // Restoring: nothing for 300ms (a fast restore never flashes a line), then
  // one quiet line. With nothing cached and nothing coming, the greeting.
  let restoreLine = $state(false);
  $effect(() => {
    if (!restoring) {
      restoreLine = false;
      return;
    }
    const t = setTimeout(() => (restoreLine = true), 300);
    return () => clearTimeout(t);
  });
  const empty = $derived(messages.length === 0);

  // Several rows at once is a restore or a replace, not a conversation: no row
  // flies in, the whole thread just appears.
  // A conversation switch is a replace too, whatever the lengths, and starts
  // at the bottom with nothing opened.
  let prevLen = 0;
  let prevConversation = untrack(() => conversationId);
  let bulk = $state(false);
  $effect.pre(() => {
    const n = messages.length;
    const c = conversationId;
    const switched = c !== prevConversation;
    bulk = n - prevLen > 1 || switched;
    if (switched) {
      following = true;
      missed = false;
      untrack(() => {
        openSources = {};
        copiedId = '';
      });
    }
    prevLen = n;
    prevConversation = c;
  });

  // "Still thinking…" once a reply has been silent for 8s.
  const thinkingId = $derived(messages.find((m) => m.status === 'streaming' && !m.content)?.id ?? '');
  let slowId = $state('');
  $effect(() => {
    const id = thinkingId;
    if (!id) return;
    const t = setTimeout(() => (slowId = id), 8000);
    return () => clearTimeout(t);
  });

  // Only the newest failed reply offers Retry: re-asking an older question
  // out of order would scramble the thread.
  const lastFailedId = $derived(lastOf(messages, (m) => m.status === 'error')?.id ?? '');
  const retryInert = $derived(cooling || !!unavailable);
  const latestDoneId = $derived(
    lastOf(messages, (m) => m.role === 'assistant' && m.status === 'done')?.id ?? '',
  );

  // A team run is labelled once, above its first turn.
  function startsTeamRun(i: number) {
    return messages[i].role === 'owner' && messages[i - 1]?.role !== 'owner';
  }

  let bar: ReturnType<typeof PawBar> | undefined = $state();
  function retry(id: string) {
    if (retryInert) return;
    onretry?.(id);
    bar?.focus();
  }

  // ── Copy and sources ──────────────────────────────────────────────────────
  // The sandboxed frame only gets the clipboard if the loader grants it; with
  // no API there is no button, rather than one that silently does nothing.
  const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard?.writeText;
  let copiedId = $state('');
  let openSources = $state<Record<string, boolean>>({});
  async function copy(m: BarMessage) {
    try {
      await navigator.clipboard.writeText(m.content);
      copiedId = m.id;
      setTimeout(() => {
        if (copiedId === m.id) copiedId = '';
      }, 1400);
    } catch {
      /* blocked: nothing changes */
    }
  }

  const noticeId = `pbf-notice-${Math.random().toString(36).slice(2, 8)}`;
  const describedBy = $derived(
    [line ? noticeId : '', showConsent ? consentId : '', barOpen ? disclosureId : ''].filter(Boolean).join(' ') || undefined,
  );

  // ── Thread height ─────────────────────────────────────────────────────────
  // The tallest the thread may grow before it scrolls, per size, and the share
  // of the viewport it may take.
  const THREAD_CAP: Record<BarSize, [number, number]> = { sm: [440, 0.58], md: [560, 0.64], lg: [720, 0.72] };
  let innerH = $state(0);
  let windowH = $state(typeof window === 'undefined' ? 800 : window.innerHeight);
  const viewportH = $derived(hostViewport?.h || windowH);
  const cap = $derived(Math.min(THREAD_CAP[barSize][0], Math.round(viewportH * THREAD_CAP[barSize][1])));

  // ── Narrow screens ────────────────────────────────────────────────────────
  // A thread in a phone-sized card is a keyhole. Pinning the bar there with a
  // conversation to show opens it full screen instead (once per pin, so
  // leaving full screen with Escape is respected).
  let windowW = $state(typeof window === 'undefined' ? 1200 : window.innerWidth);
  const viewportW = $derived(hostViewport?.w || windowW);
  const narrow = $derived(viewportW < 600 || viewportH < 620);
  let wasPinned = false;
  $effect(() => {
    const p = expanded;
    if (p && !wasPinned && narrow && messages.length > 0) fullscreen = true;
    wasPinned = p;
  });

  // Scrolling is allowed only once the content is genuinely taller than the
  // cap. While the spring is still catching up to a streaming reply, the
  // content is briefly taller than the box too, and with `overflow-y: auto`
  // that showed the scrollbar, the spring caught up and hid it, the next words
  // showed it again: ten show/hide flips in one reply, each one stealing width
  // and reflowing the text. Clipped (and pinned to the bottom, below) during
  // growth, scrollable past the cap, with the gutter reserved either way.
  const scrollable = $derived(fullscreen || innerH > cap);

  const threadH = new Spring(0, { stiffness: 0.16, damping: 0.8 });
  $effect(() => {
    const target = showThread ? Math.min(innerH, cap) : 0;
    void threadH.set(target, { instant: prefersReducedMotion.current });
  });

  // ── Follow the newest turn ────────────────────────────────────────────────
  // Stick to the bottom while the reader is already there; once they scroll up
  // to reread something, a streaming reply must not yank them back down.
  let threadEl: HTMLDivElement | null = $state(null);
  let following = true;

  // Escape in a card or contact field with something typed only leaves the
  // field. Folding the bar would unmount the thread and throw the typing away
  // (the bar's own Escape peels layers from a window listener, so stopping it
  // here keeps it from reaching that).
  $effect(() => {
    const el = threadEl;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (e.key !== 'Escape' || !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) || !t.value) return;
      e.stopPropagation();
      t.blur();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

  // Escape anywhere in the frame while the list shows (a row, Back, or the
  // New conversation button, which lives in the bar) goes back to the thread
  // rather than folding the bar.
  $effect(() => {
    const el = frameEl;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || view !== 'history') return;
      e.stopPropagation();
      backToThread();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

  // The header is fixed above the scrolling thread; once the thread is
  // scrolled it shows a hairline so text visibly passes under it.
  let scrolled = $state(false);
  function onScroll() {
    if (!threadEl) return;
    scrolled = threadEl.scrollTop > 2;
    following = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 40;
    if (following) missed = false;
  }

  // "↓ New message": a turn arrived or grew while the reader was scrolled up.
  // Only growth counts (a new turn, or the last one getting longer), and only
  // in a thread that actually scrolls. An emptied thread starts over.
  let missed = $state(false);
  let lastLen = 0;
  let lastTail = '';
  let lastChars = 0;
  $effect(() => {
    const n = messages.length;
    const last = messages[n - 1];
    const tail = last?.id ?? '';
    const chars = last?.content.length ?? 0;
    if (n === 0) {
      following = true;
      missed = false;
    } else {
      const grew = n > lastLen || (tail === lastTail && chars > lastChars);
      if (grew && !following && untrack(() => view === 'thread' && scrollable)) missed = true;
    }
    lastLen = n;
    lastTail = tail;
    lastChars = chars;
  });
  function jump() {
    following = true;
    missed = false;
    threadEl?.scrollTo({ top: threadEl.scrollHeight, behavior: prefersReducedMotion.current ? 'auto' : 'smooth' });
  }

  $effect(() => {
    void innerH;
    void messages.length;
    if (!following || !threadEl) return;
    void tick().then(() => {
      if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
    });
  });

  const enter = $derived(prefersReducedMotion.current || bulk ? { duration: 0 } : { y: 8, duration: 220 });
  const soft = $derived({ duration: prefersReducedMotion.current ? 0 : 160 });
  const credit = $derived(prefersReducedMotion.current ? { duration: 0 } : { duration: 200 });
  const leave = $derived({ duration: prefersReducedMotion.current ? 0 : 120 });
</script>

<svelte:window bind:innerHeight={windowH} bind:innerWidth={windowW} onpagehide={snapshot} />

{#snippet listFooter()}
  <button type="button" class="new-conversation" onclick={newConversation}>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
    New conversation
  </button>
{/snippet}

{#snippet turnNote(m: BarMessage)}
  <p class="meta turn-note" class:error={m.status === 'error'} data-side={m.role === 'user' ? 'user' : 'bot'} in:fade={soft}>
    {#if m.status === 'error'}<span class="err-dot" aria-hidden="true"></span>{/if}
    <span>{noteFor(m)}</span>
    {#if m.status === 'error' && m.id === lastFailedId && !streaming && onretry && canRetry(m)}
      <button type="button" class="retry" aria-disabled={retryInert || undefined} onclick={() => retry(m.id)}>Try again</button>
    {/if}
  </p>
{/snippet}

<div
  class="frame-wrap"
  data-size={barSize}
  data-anchor={anchor}
  data-launcher={launcher}
  data-full={fullscreen ? 'true' : undefined}
  data-pawbar-scheme={scheme}
  style:--pb-host-w={hostViewport?.w ? `${hostViewport.w}px` : undefined}
  style:--pb-host-h={hostViewport?.h ? `${hostViewport.h}px` : undefined}
  bind:this={frameEl}
>
<div class="frame" class:open={showThread} class:surface>
  {#if showThread && !history}
    <div class="frame-head" class:scrolled transition:slide={soft}>
      {#if canList}
        <button type="button" class="head-btn" aria-label="Your conversations" title="Your conversations" onclick={showConversations}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
            <path d="M3.5 4v4h4M12 8v4.5l3 2" />
          </svg>
        </button>
      {/if}
      {#if canNew}
        <button type="button" class="head-btn" aria-label="New chat" title="New chat" onclick={newConversation}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      {/if}
      <span class="head-gap"></span>
      {#if expandable || fullscreen}
        <button
          type="button"
          class="head-btn"
          aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
          title={fullscreen ? 'Exit full screen' : 'Full screen'}
          onclick={toggleFull}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            {#if fullscreen}
              <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
            {:else}
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            {/if}
          </svg>
        </button>
      {/if}
      <button type="button" class="head-btn" aria-label="Close chat" title="Close" onclick={() => bar?.closeChat()}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  {/if}
  <div class="thread-box">
  <div
    class="thread"
    bind:this={threadEl}
    onscroll={onScroll}
    style:height={fullscreen ? undefined : `${threadH.current}px`}
    style:overflow-y={scrollable ? 'auto' : 'hidden'}
    role={history ? 'region' : 'log'}
    aria-live={history ? 'off' : 'polite'}
    aria-relevant={history ? undefined : 'additions'}
    aria-label={history ? 'Your conversations' : 'Conversation'}
    aria-hidden={!showThread}
  >
    {#if showThread && history}
      <div class="thread-inner history" bind:offsetHeight={innerH} bind:this={historyEl} in:fade={soft}>
        <div class="history-head">
          <button type="button" class="foot-btn" onclick={backToThread}>
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M10 4L6 8l4 4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
            Back
          </button>
          <h2 class="history-title">Conversations</h2>
          <button type="button" class="list-close" aria-label="Close chat" title="Close" onclick={() => bar?.closeChat()}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <ul class="history-list">
          {#each conversations as c (c.id)}
            {@const current = c.id === conversationId || (!conversationId && c.active)}
            <li>
              <button type="button" class="history-row" aria-current={current || undefined} onclick={() => openConversation(c.id)}>
                <span class="history-preview">{c.preview || 'New conversation'}</span>
                <span class="history-meta">
                  {#if current}<span>Current</span>{/if}
                  {#if WAITING_STATES.has(c.state)}<span>Waiting on team</span>{/if}
                  {#if ago(c.lastMessageAt, listNow)}<span>{ago(c.lastMessageAt, listNow)}</span>{/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {:else if showThread}
      <div class="thread-inner" class:blank={restoring && !restoreLine && empty} bind:offsetHeight={innerH} out:fade={leave}>
        {#if empty && restoring}
          {#if restoreLine}<p class="meta loading" in:fade={soft}>Loading your conversation…</p>{/if}
        {:else if empty}
          <p class="msg assistant greeting" in:fade={soft}>{greeting || DEFAULT_GREETING}</p>
        {/if}
        {#each messages as m, i (m.id)}
          <svelte:boundary>
            {#if m.role === 'system'}
              <p class="chip-note" in:fade={soft}>{m.content}</p>
            {:else if m.role === 'owner'}
              <div class="row owner" in:fly={enter}>
                {#if startsTeamRun(i)}
                  <span class="team-label">
                    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
                      <circle cx="8" cy="8" r="8" fill="currentColor" opacity="0.18" />
                      <circle cx="8" cy="6.4" r="2.3" fill="currentColor" />
                      <path d="M4 12.6c.6-1.9 2.2-3 4-3s3.4 1.1 4 3" fill="currentColor" />
                    </svg>
                    {teamLabel}
                  </span>
                {:else}
                  <span class="sr-only">{teamLabel}:</span>
                {/if}
                <div class="msg owner">{m.content}</div>
              </div>
            {:else if m.role === 'user'}
              <div class="row user" in:fly={enter}>
                <div class="msg user" class:unsent={m.status === 'queued' || m.status === 'error'}><span class="sr-only">You:</span>{m.content}</div>
                {#if m.status === 'queued' || m.status === 'error'}
                  {@render turnNote(m)}
                {/if}
              </div>
            {:else if m.role === 'assistant'}
              <div class="row assistant" in:fly={enter}>
                {#if m.status === 'streaming' && !m.content}
                  <span class="thinking">
                    <span class="sr-only">Thinking</span>
                    <span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>
                    <span class="think-word" aria-hidden="true">Thinking…</span>
                    {#if slowId === m.id}<span class="meta" in:fade={soft}>Still thinking…</span>{/if}
                  </span>
                {:else if m.content}
                  <!-- Re-mounted when the status changes, so the log announces
                       the finished reply once, whole, not its first words. -->
                  {#key m.status}
                    <div class="msg assistant rich"><span class="sr-only">Assistant:</span><Markdown content={m.content} streaming={m.status === 'streaming'} /></div>
                  {/key}
                {/if}
                {#if m.status === 'done' && m.stopped}
                  <p class="meta" in:fade={soft}>Stopped</p>
                {:else if m.status === 'error' && !(m.unavailable === 'limit' && unavailable)}
                  <!-- A limit turn is said once, by the near-input line, while it shows. -->
                  {@render turnNote(m)}
                {:else if m.status === 'done' && m.content}
                  {@const sources = m.sources ?? []}
                  <div class="foot" class:latest={m.id === latestDoneId}>
                    {#if sources.length}
                      <button
                        type="button"
                        class="foot-btn"
                        aria-expanded={!!openSources[m.id]}
                        aria-controls={`src-${m.id}`}
                        onclick={() => (openSources[m.id] = !openSources[m.id])}
                      >
                        Sources ({sources.length})
                        <svg class="chev" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
                      </button>
                    {/if}
                    {#if canCopy}
                      <button type="button" class="foot-btn icon-btn" aria-label={copiedId === m.id ? 'Copied' : 'Copy reply'} onclick={() => copy(m)}>
                        {#if copiedId === m.id}
                          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
                        {:else}
                          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8" stroke="currentColor" stroke-width="1.5" fill="none" /><path d="M10.5 3.5v-.3A1.7 1.7 0 0 0 8.8 1.5H4.2A1.7 1.7 0 0 0 2.5 3.2v4.6a1.7 1.7 0 0 0 1.7 1.7h.3" stroke="currentColor" stroke-width="1.5" fill="none" /></svg>
                        {/if}
                      </button>
                    {/if}
                  </div>
                  {#if sources.length && openSources[m.id]}
                    <div class="sources" id={`src-${m.id}`} transition:slide={soft}>
                      {#each sources as src, k (k)}
                        <a class="source" href={src.url} target="_blank" rel="noopener noreferrer" title={src.title}>{src.title}</a>
                      {/each}
                    </div>
                  {/if}
                {/if}
                <!-- One note under a reply: an unavailable turn never shows an act line. -->
                {#if m.status === 'done' && m.action && !m.unavailable}
                  {@const act = m.action}
                  {#if act.state === 'fallback' && act.to}
                    <a class="source" href={act.to} target="_blank" rel="noopener noreferrer">{actionLine(act, act.state)} ↗</a>
                  {:else if act.do === 'tool' && act.state === 'confirm' && ontoolanswer}
                    <div class="meta turn-note tool-confirm" role="group" aria-label={act.label} in:fade={soft}>
                      <span>{actionLine(act, act.state)}</span>
                      <button type="button" class="retry" onclick={() => ontoolanswer?.(m.id, true)}>Confirm</button>
                      <button type="button" class="retry quiet" onclick={() => ontoolanswer?.(m.id, false)}>Cancel</button>
                    </div>
                  {:else}
                    <p class="meta" in:fade={soft}>{actionLine(act, act.state)}</p>
                  {/if}
                {/if}
              </div>
            {:else}
              <p class="meta unrenderable">This message couldn't be displayed.</p>
            {/if}
            {#snippet failed()}
              <p class="meta unrenderable">This message couldn't be displayed.</p>
            {/snippet}
          </svelte:boundary>
        {/each}
        {#if cart && cart.count > 0}
          <p class="cart-row" in:fade={soft}>
            <span>Cart · {cart.count}</span>
            {#if cart.checkoutUrl}
              <button type="button" class="retry" aria-label="Checkout, opens in a new tab" onclick={() => cart.openCheckout()}>Checkout ↗</button>
            {/if}
          </p>
        {/if}
        {#if contact?.status === 'offer'}
          <div class="contact" role="group" aria-label="Email notification offer" in:fade={soft}>
            <button type="button" class="contact-dismiss" onclick={() => contact.dismiss()} aria-label="Dismiss">
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" /></svg>
            </button>
            <p class="contact-copy">Leaving? We can email you when the team confirms.</p>
            <form class="contact-form" onsubmit={submitContact} novalidate>
              <input
                class="contact-input"
                type="email"
                bind:value={contactEmail}
                placeholder="you@example.com"
                autocomplete="email"
                aria-label="Your email"
                aria-invalid={contact.emailError}
                aria-describedby={contact.emailError ? contactErrId : undefined}
              />
              <button type="submit" class="contact-send" disabled={contact.isSubmitting}>Notify me</button>
            </form>
            {#if contact.emailError}
              <p class="contact-err" id={contactErrId}>That email doesn't look right.</p>
            {/if}
          </div>
        {:else if contact?.status === 'sent'}
          <p class="meta contact-sent" in:fade={soft}>Got it — we'll email you when the team confirms.</p>
        {/if}
      </div>
    {/if}
  </div>
  {#if missed && showThread && !history}
    <button type="button" class="jump" onclick={jump} transition:fade={soft}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
      New message
    </button>
  {/if}
  </div>

  {#if showConsent}
    <p class="notice consent" class:held={!!held} id={consentId} role="status" transition:slide={soft}>
      <span>{held ? 'To send this, we need to store a conversation ID on this device.' : 'To chat, we store a conversation ID on this device.'}</span>
      <button type="button" class="retry" onclick={acceptConsent}>Accept</button>
      <button type="button" class="retry quiet" onclick={declineConsent}>Not now</button>
    </p>
  {/if}

  {#if line && showLine}
    <!-- Its own polite status, outside the log: it is about the input, not a
         turn. `rejected` is the one alert, because the visitor's words just
         came back into the field and they need to know why. -->
    <p
      class="notice"
      data-tone={tone}
      id={noticeId}
      role={line.kind === 'rejected' ? 'alert' : 'status'}
      transition:slide={soft}
    >
      {#if tone === 'presence'}<span class="presence" aria-hidden="true"></span>{/if}
      <span>{lineText}</span>
      {#if line.action === 'contact' && onrequesthuman}
        <button type="button" class="retry" onclick={() => bar?.openContact()}>Leave your email</button>
      {/if}
    </p>
  {/if}

  <PawBar
    bind:this={bar}
    bind:expanded
    bind:fullscreen
    boundary={frameEl}
    placeholder={unavailable ? "Chat isn't available right now" : botPaused ? 'Reply to the team…' : placeholder}
    {streaming}
    {activity}
    {unreadPreview}
    describedby={describedBy}
    bind:value={draft}
    readonly={!!unavailable}
    sendBlocked={cooling || queueFull}
    handoffPending={handoff === 'pending'}
    onrequesthuman={unavailable && !unavailable.contactable ? undefined : onrequesthuman}
    {onstop}
    chrome={false}
    narrow={viewportW < 360}
    {expandable}
    footer={history ? listFooter : undefined}
    {logo}
    {logoSrc}
    {launcher}
    {side}
    {size}
    {resizable}
    {voice}
    onsend={send}
    onopenchange={(o) => {
      barOpen = o;
      onopenchange?.(o);
    }}
    onsizechange={(sz) => (barSize = sz)}
  />
</div>

  {#if barOpen}
    <!-- The disclosure is not the credit: `poweredBy={false}` removes the
         credit and leaves this line. -->
    <div class="credit" transition:slide={credit}>
      <span>
        <span id={disclosureId}>{disclosureText}</span>
        {#if privacyHref}
          <span aria-hidden="true">·</span>
          <a href={privacyHref} target="_blank" rel="noopener noreferrer">Privacy</a>
        {/if}
        {#if poweredBy}
          <span aria-hidden="true">·</span>
          {#if poweredByHref}
            <a href={poweredByHref} target="_blank" rel="noopener noreferrer">Powered by <strong>Paw Sites</strong></a>
          {:else}
            <span>Powered by <strong>Paw Sites</strong></span>
          {/if}
        {/if}
      </span>
    </div>
  {/if}
</div>

<style>
  /* Unstyled: only groups the surface with the credit below it, and is the
     boundary for hover and click-outside. */
  .frame-wrap {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    /* Per-size values, internal (see PawBar's size presets for why --pbf-* may
       be declared here when --pawbar-* may not). They mirror PawBar's --pb-*
       and read the same public tokens, so the frame's curve stays concentric
       with the bar's and both use one spacing scale: --pbf-u is the unit
       (--pawbar-space, else the size's --pbf-space), steps xs 0.5u, s1 1u,
       s2 2u, s3 3u, s4 4u, s6 6u, and --pbf-gap (--pawbar-gap, else 2u) is the
       frame's padding and the gap between the thread, notices and the bar. */
    --pbf-space: 4px;
    --pbf-rest: 52px;
    --pbf-launch: 60px;
    --pbf-msg: 15px;
    --pbf-meta: 12.5px;
    --pbf-radius: calc(var(--pawbar-height, var(--pbf-rest)) / 2);
    --pbf-u: var(--pawbar-space, var(--pbf-space));
    --pbf-xs: calc(var(--pbf-u) * 0.5);
    --pbf-s1: var(--pbf-u);
    --pbf-s2: calc(var(--pbf-u) * 2);
    --pbf-s3: calc(var(--pbf-u) * 3);
    --pbf-s4: calc(var(--pbf-u) * 4);
    --pbf-s6: calc(var(--pbf-u) * 6);
    --pbf-gap: var(--pawbar-gap, var(--pbf-s2));
  }
  .frame-wrap[data-size='sm'] {
    --pbf-space: 3.5px;
    --pbf-rest: 46px;
    --pbf-launch: 52px;
    --pbf-msg: 14px;
    --pbf-meta: 12px;
  }
  .frame-wrap[data-size='lg'] {
    --pbf-space: 4.5px;
    --pbf-rest: 60px;
    --pbf-launch: 68px;
    --pbf-msg: 16px;
    --pbf-meta: 13.5px;
  }
  /* Mirrors PawBar: the icon launcher's radius is half its own diameter. */
  .frame-wrap[data-launcher='icon'] {
    --pbf-radius: calc(var(--pawbar-launcher-size, var(--pbf-launch)) / 2);
  }

  /* ── Full screen ───────────────────────────────────────────────────────── */
  .frame-wrap[data-full] {
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    align-items: center;
    padding: 24px;
    box-sizing: border-box;
    background: var(--pawbar-scrim, rgb(12 12 16 / 0.35));
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    animation: pbf-full-in 200ms ease-out;
  }
  @keyframes pbf-full-in {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .frame-wrap[data-full] {
      animation: none;
    }
  }
  @media (max-width: 480px) {
    .frame-wrap[data-full] {
      padding: 12px;
    }
  }
  .frame-wrap[data-full] .frame {
    flex: 1;
    min-height: 0;
    width: min(1100px, 100%);
    box-sizing: border-box;
  }
  .frame-wrap[data-full] .thread-box {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .frame-wrap[data-full] .thread {
    flex: 1;
    min-height: 0;
  }
  .frame-wrap[data-full] .thread-inner {
    max-width: var(--pawbar-full-width, 760px);
    margin-inline: auto;
    padding-top: 20px;
  }
  /* The icon launcher lives in a corner, so the surface and the credit hug
     that corner instead of centring on it. */
  .frame-wrap[data-anchor='left'] {
    align-items: flex-start;
  }
  .frame-wrap[data-anchor='right'] {
    align-items: flex-end;
  }

  /* The parent surface. Its radius is the input's radius plus the padding, so
     the two curves stay concentric at every size. */
  .frame {
    --pad: var(--pawbar-frame-pad, var(--pbf-gap));
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    padding: var(--pad);
    border-radius: calc(var(--pawbar-radius, var(--pbf-radius)) + var(--pad));
    background: var(--pawbar-frame-bg, rgb(38 38 44 / 0.55));
    border: 1px solid var(--pawbar-frame-border, rgb(255 255 255 / 0.14));
    color: var(--pawbar-frame-fg, #f2f2f5);
    font-family: var(--pawbar-font, inherit);
    -webkit-backdrop-filter: blur(var(--pawbar-blur, 18px)) saturate(1.3);
    backdrop-filter: blur(var(--pawbar-blur, 18px)) saturate(1.3);
    transition:
      padding 200ms ease-out,
      background-color 200ms ease-out,
      border-color 200ms ease-out;
  }
  /* Nothing above the input: no surface, so the frame is exactly the bar.
     The border stays (transparent) so the box does not shift by 1px. */
  .frame:not(.surface) {
    --pad: 0px;
    background: transparent;
    border-color: transparent;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .frame {
      transition: none;
    }
  }

  /* Width 100% of the frame, which is the input's width. `contain:
     inline-size` is load-bearing: the frame is shrink-to-fit, so without it a
     long reply's text would set the frame's width and stretch it across the
     page. With it the thread has no say, and only the input sizes the frame. */
  .thread {
    width: 100%;
    contain: inline-size;
    overflow-x: hidden;
    overscroll-behavior: contain;
    /* Reserve the scrollbar's width on BOTH sides whether or not it is
       showing, so crossing the cap does not narrow the text by a scrollbar and
       the column stays centred under the input. */
    scrollbar-gutter: stable both-edges;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in oklab, currentColor 25%, transparent) transparent;
  }
  /* ── Header ──────────────────────────────────────────────────────────── */
  /* Never scrolls: it sits OUTSIDE the thread, which is the only scroller.
     The bottom border is always there (transparent) so the hairline that
     appears once the thread is scrolled never shifts the layout. */
  .frame-head {
    display: flex;
    align-items: center;
    gap: var(--pbf-gap);
    align-self: stretch;
    padding: 0 var(--pbf-xs) var(--pbf-xs);
    border-bottom: 1px solid transparent;
    transition: border-color 150ms ease-out;
  }
  .frame-head.scrolled {
    border-bottom-color: var(--pawbar-frame-border, rgb(255 255 255 / 0.14));
  }
  .frame-wrap[data-full] .frame-head {
    width: 100%;
    max-width: var(--pawbar-full-width, 760px);
    margin-inline: auto;
  }
  .head-gap {
    flex: 1;
  }
  .head-btn {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
    cursor: pointer;
  }
  .head-btn:hover {
    background: color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 9%, transparent);
    color: var(--pawbar-frame-fg, #f2f2f5);
  }
  .head-btn:focus-visible {
    outline: 2px solid var(--pawbar-ring, currentColor);
    outline-offset: 1px;
  }
  @media (pointer: coarse) {
    .head-btn {
      width: 40px;
      height: 40px;
    }
  }

  /* Only anchors the jump pill over the bottom of the thread. */
  .thread-box {
    position: relative;
    width: 100%;
  }
  .jump {
    position: absolute;
    left: 50%;
    bottom: var(--pbf-s2);
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: var(--pbf-s1);
    padding: var(--pbf-s1) var(--pbf-s3);
    border: none;
    border-radius: min(var(--pawbar-radius, 999px), 999px);
    /* The visitor bubble's colours: solid enough that the reply scrolling
       under it never shows through. */
    background: var(--pawbar-bubble-bg, rgb(255 255 255 / 0.86));
    color: var(--pawbar-bubble-fg, #1c1c21);
    font: inherit;
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
    font-weight: 600;
    cursor: pointer;
  }
  .jump:focus-visible {
    outline: 2px solid var(--pawbar-ring, currentColor);
    outline-offset: 2px;
  }

  /* ── Conversation list ─────────────────────────────────────────────────── */
  .history-head {
    display: flex;
    align-items: center;
    gap: var(--pbf-s2);
  }
  /* As wide as Back, so the title stays in the middle; the glyph sits at
     the far end. */
  .list-close {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    width: 64px;
    height: 28px;
    padding: 0 var(--pbf-s2);
    border: none;
    border-radius: min(var(--pawbar-radius, 8px), 8px);
    background: none;
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
    cursor: pointer;
  }
  .list-close:hover {
    color: var(--pawbar-frame-fg, #f2f2f5);
  }
  .list-close:focus-visible {
    outline: 2px solid var(--pawbar-ring, currentColor);
    outline-offset: 2px;
  }
  .new-conversation {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--pbf-s2);
    width: 100%;
    min-height: 44px;
    border: none;
    border-radius: var(--pawbar-radius-pill, var(--pawbar-radius, 999px));
    /* The theme's accent, as on Send. Without one, the card's own pair
       inverted, so it stands out on a light card and a dark one alike. */
    background: var(--pawbar-accent, var(--pawbar-fg, #1c1c21));
    color: var(--pawbar-accent-fg, var(--pawbar-bg, #fafafa));
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .new-conversation:focus-visible {
    outline: 2px solid var(--pawbar-ring, currentColor);
    outline-offset: 2px;
  }
  .history-title {
    flex: 1;
    margin: 0;
    font-size: var(--pawbar-message-size, var(--pbf-msg));
    font-weight: 600;
    text-align: center;
  }
  .history-list {
    display: flex;
    flex-direction: column;
    gap: var(--pbf-xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .history-row {
    display: flex;
    flex-direction: column;
    gap: var(--pbf-s1);
    width: 100%;
    padding: var(--pbf-s3);
    border: none;
    border-radius: min(var(--pawbar-radius, 12px), 12px);
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .history-row:hover,
  .history-row[aria-current='true'] {
    background: color-mix(in oklab, currentColor 8%, transparent);
  }
  .history-row:focus-visible {
    outline: 2px solid var(--pawbar-ring, currentColor);
    outline-offset: -2px;
  }
  .history-preview {
    overflow: hidden;
    font-size: var(--pawbar-message-size, var(--pbf-msg));
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .history-meta {
    display: flex;
    gap: var(--pbf-s2);
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }

  .thread-inner {
    display: flex;
    flex-direction: column;
    gap: var(--pbf-s4);
    width: 100%;
    box-sizing: border-box;
    /* Breathing room at the top of the frame and above the input (the shared
       gap). Inside the measured box on purpose, so it is part of what the
       spring grows to. */
    padding: var(--pbf-gap) var(--pbf-s1);
  }

  .msg {
    max-width: 88%;
    font-size: var(--pawbar-message-size, var(--pbf-msg));
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .msg.user {
    align-self: flex-end;
    padding: var(--pbf-s3) var(--pbf-s4);
    border-radius: var(--pawbar-radius-bubble, min(var(--pawbar-radius, 16px), 16px));
    border-bottom-right-radius: min(var(--pawbar-radius, 6px), 6px);
    background: var(--pawbar-bubble-bg, rgb(255 255 255 / 0.86));
    color: var(--pawbar-bubble-fg, #1c1c21);
  }
  .msg.assistant {
    max-width: 100%;
    padding: 0 var(--pbf-xs);
  }
  .greeting {
    align-self: flex-start;
  }
  /* A restore that has not shown its line yet takes no room, so the spring's
     target stays 0 and the frame does not grow a blank strip. */
  .thread-inner.blank {
    padding: 0;
  }

  /* ── Rows ────────────────────────────────────────────────────────────────
     Everything drawn in the thread derives from --pawbar-frame-fg (the thread
     sits on the frame), never from the accent, whose fallback vanishes on the
     default dark frame. Status hues mix a fixed hue with that ink, so they
     read on light and dark frames with no theme having to set them. */
  .row {
    display: flex;
    flex-direction: column;
    gap: var(--pbf-s1);
    min-width: 0;
  }
  .row.assistant {
    align-self: stretch;
    align-items: flex-start;
  }
  /* People speak in bubbles, the bot in plain text: the team's bubbles sit
     on the left, softer than the visitor's, with the tail mirrored. */
  .row.owner {
    align-self: flex-start;
    align-items: flex-start;
    max-width: 88%;
  }
  .msg.owner {
    max-width: 100%;
    padding: var(--pbf-s3) var(--pbf-s4);
    background: var(--pawbar-owner-bubble-bg, var(--pawbar-thread-wash, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 9%, transparent)));
    border: 1px solid var(--pawbar-thread-line, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent));
    border-radius: var(--pawbar-radius-bubble, min(var(--pawbar-radius, 16px), 16px));
    border-bottom-left-radius: min(var(--pawbar-radius, 6px), 6px);
  }
  .team-label {
    display: inline-flex;
    align-items: center;
    gap: var(--pbf-s2);
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
    font-weight: 600;
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }
  .chip-note {
    align-self: center;
    max-width: min(92%, 420px);
    margin: 0;
    padding: var(--pbf-s1) var(--pbf-s3);
    font-size: calc(var(--pawbar-meta-size, var(--pbf-meta)) - 0.5px);
    line-height: 1.45;
    text-align: center;
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
    border: 1px solid var(--pawbar-thread-line, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent));
    border-radius: var(--pawbar-radius-pill, var(--pawbar-radius, 999px));
  }
  .meta {
    margin: 0;
    padding: 0 var(--pbf-xs);
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
    line-height: 1.4;
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }
  .loading {
    align-self: flex-start;
  }
  .unrenderable {
    align-self: flex-start;
    font-style: italic;
  }
  .meta.error {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pbf-s2);
    color: var(--pawbar-danger, color-mix(in oklab, #d93036 72%, var(--pawbar-frame-fg, #f2f2f5)));
  }
  .err-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
  .retry {
    padding: var(--pbf-s1) var(--pbf-s3);
    border: none;
    border-radius: min(var(--pawbar-radius, 8px), 8px);
    background: var(--pawbar-thread-wash, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 9%, transparent));
    color: var(--pawbar-frame-fg, #f2f2f5);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .retry[aria-disabled='true'] {
    opacity: 0.55;
    cursor: not-allowed;
  }

  /* ── C3 thinking ──────────────────────────────────────────────────────── */
  .thinking {
    display: inline-flex;
    align-items: center;
    gap: var(--pbf-s2);
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }
  .think-word {
    display: none;
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
  }

  /* ── C6 footer ────────────────────────────────────────────────────────────
     Always visible on the newest reply; on older ones it appears on hover or
     focus, and always on touch, where there is no hover. */
  .foot {
    display: flex;
    align-items: center;
    gap: var(--pbf-xs);
    margin-left: calc(var(--pbf-s2) * -1);
    opacity: 0;
    transition: opacity 150ms ease;
  }
  .foot.latest,
  .row:hover .foot,
  .row:focus-within .foot {
    opacity: 1;
  }
  @media (hover: none) {
    .foot {
      opacity: 1;
    }
    .foot-btn,
    .retry {
      min-height: 32px;
    }
  }
  .foot-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--pbf-s1);
    min-height: 28px;
    padding: var(--pbf-xs) var(--pbf-s2);
    border: none;
    border-radius: min(var(--pawbar-radius, 8px), 8px);
    background: none;
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
    font: inherit;
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
    cursor: pointer;
  }
  .foot-btn.icon-btn {
    min-width: 28px;
    justify-content: center;
  }
  .foot-btn:hover,
  .foot-btn[aria-expanded='true'] {
    color: var(--pawbar-frame-fg, #f2f2f5);
    background: var(--pawbar-thread-wash, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 9%, transparent));
  }
  .chev {
    transition: transform 150ms ease;
  }
  [aria-expanded='true'] .chev {
    transform: rotate(90deg);
  }
  .foot-btn:focus-visible,
  .retry:focus-visible,
  .source:focus-visible {
    outline: 2px solid var(--pawbar-ring, var(--pawbar-frame-fg, #f2f2f5));
    outline-offset: 2px;
  }
  .sources {
    display: flex;
    flex-wrap: wrap;
    gap: var(--pbf-s2);
    max-width: 100%;
  }
  .source {
    max-width: 100%;
    padding: var(--pbf-s1) var(--pbf-s3);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
    text-decoration: none;
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
    border: 1px solid var(--pawbar-thread-line, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent));
    border-radius: var(--pawbar-radius-pill, var(--pawbar-radius, 999px));
  }
  .source:hover {
    color: var(--pawbar-frame-fg, #f2f2f5);
    border-color: color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 28%, transparent);
  }

  /* ── C8 the team has taken over ──────────────────────────────────────── */
  .notice {
    display: flex;
    align-items: center;
    gap: var(--pbf-s2);
    align-self: stretch;
    margin: 0;
    padding: 0 var(--pbf-s2) var(--pbf-gap);
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }
  [data-anchor='right'] .notice {
    justify-content: flex-end;
  }
  .frame-wrap[data-full] .notice {
    width: 100%;
    max-width: var(--pawbar-full-width, 760px);
    margin-inline: auto;
  }
  .row.user {
    align-self: flex-end;
    align-items: flex-end;
    max-width: 88%;
  }
  .row.user .msg.user {
    max-width: 100%;
  }
  /* Not sent, or waiting to be: the words are the visitor's, still legible,
     but visibly not delivered. */
  .msg.user.unsent {
    opacity: 0.6;
  }
  .turn-note {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--pbf-s2);
  }
  .turn-note.error {
    color: var(--pawbar-danger, color-mix(in oklab, #d93036 72%, var(--pawbar-frame-fg, #f2f2f5)));
  }
  .notice[data-tone='danger'] {
    color: var(--pawbar-danger, color-mix(in oklab, #d93036 72%, var(--pawbar-frame-fg, #f2f2f5)));
  }
  .notice[data-tone='warn'] {
    color: var(--pawbar-warn, color-mix(in oklab, #c98a12 70%, var(--pawbar-frame-fg, #f2f2f5)));
  }
  .notice .retry {
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
  }
  .presence {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--pawbar-presence, color-mix(in oklab, #2f9e64 72%, var(--pawbar-frame-fg, #f2f2f5)));
  }

  /* ── Rich replies (section E) ─────────────────────────────────────────────
     Markdown.svelte's output. The old shell styles `.pawbar-md` globally in
     glass.css against its own token scale, which this bar does not load, so
     the thread styles it here, from the thread's inks. Block tags carry their
     own spacing, so the reply drops the plain-text pre-wrap. */
  /* Stretched, not shrink-wrapped: a card or catalog inside takes the
     thread's width rather than its own content's. */
  .msg.rich {
    align-self: stretch;
    white-space: normal;
  }
  .frame :global(.pawbar-md > :first-child) {
    margin-top: 0;
  }
  .frame :global(.pawbar-md > :last-child) {
    margin-bottom: 0;
  }
  .frame :global(.pawbar-md p) {
    margin: 0 0 0.6em;
  }
  /* Prose lists only. The catalog is a list too, inside a card inside the
     reply; this padding pushed its first tile 20px in and the strip snapped
     past it, so the "Previous" arrow showed at the start. */
  .frame :global(.pawbar-md :is(ul, ol):not(.catalog *)) {
    margin: 0 0 0.6em;
    padding-left: 1.3em;
  }
  .frame :global(.pawbar-md li:not(.catalog *)) {
    margin-bottom: 0.2em;
  }
  .frame :global(.pawbar-md li:not(.catalog *)::marker) {
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }
  .frame :global(.pawbar-md strong) {
    font-weight: 650;
  }
  .frame :global(.pawbar-md :is(h1, h2, h3, h4, h5, h6)) {
    margin: 0.8em 0 0.3em;
    font-size: 1em;
    font-weight: 650;
    line-height: 1.3;
  }
  .frame :global(.pawbar-md h1) {
    font-size: 1.15em;
  }
  .frame :global(.pawbar-md h2) {
    font-size: 1.07em;
  }
  .frame :global(.pawbar-md a) {
    color: inherit;
    text-decoration: underline;
    text-decoration-color: color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 45%, transparent);
    text-underline-offset: 2px;
  }
  .frame :global(.pawbar-md a:hover) {
    text-decoration-color: currentColor;
  }
  .frame :global(.pawbar-md :not(pre) > code) {
    padding: 0.1em 0.35em;
    border-radius: min(var(--pawbar-radius, 5px), 5px);
    background: var(--pawbar-thread-wash, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 9%, transparent));
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.88em;
  }
  .frame :global(.pawbar-md blockquote) {
    margin: 0.6em 0;
    padding-left: 0.8em;
    border-left: 3px solid var(--pawbar-thread-line, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent));
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }
  .frame :global(.pawbar-md hr) {
    margin: 0.8em 0;
    border: none;
    border-top: 1px solid var(--pawbar-thread-line, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent));
  }
  /* Unreachable today (the markdown renderer has no image node; images render
     as their alt text), and kept so a future change cannot overflow the thread. */
  .frame :global(.pawbar-md img) {
    max-width: 100%;
    border-radius: min(var(--pawbar-radius, 8px), 8px);
  }
  .frame :global(.pawbar-table-wrapper) {
    margin: 0.6em 0;
    overflow-x: auto;
  }
  .frame :global(.pawbar-md table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
  }
  .frame :global(.pawbar-md :is(th, td)) {
    padding: 0.4em 0.65em;
    border: 1px solid var(--pawbar-thread-line, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent));
    text-align: left;
  }
  .frame :global(.pawbar-md th) {
    font-weight: 600;
    background: var(--pawbar-thread-wash, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 9%, transparent));
  }
  .frame :global(.pawbar-md a:focus-visible),
  .frame :global(.pawbar-md .code .copy:focus-visible) {
    outline: 2px solid var(--pawbar-ring, var(--pawbar-frame-fg, #f2f2f5));
    outline-offset: 2px;
  }

  /* CodeBlock.svelte */
  .frame :global(.pawbar-md .code) {
    margin: 0.6em 0;
    border: 1px solid var(--pawbar-card-border, var(--pawbar-frame-border, rgb(255 255 255 / 0.14)));
    border-radius: min(var(--pawbar-radius, 10px), 10px);
    background: var(--pawbar-card-bg, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 6%, transparent));
  }
  .frame :global(.pawbar-md .code .bar) {
    padding: var(--pbf-s1) var(--pbf-s2) var(--pbf-s1) var(--pbf-s3);
    border-bottom: 1px solid var(--pawbar-thread-line, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent));
  }
  .frame :global(.pawbar-md .code :is(.lang, .copy)) {
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }
  .frame :global(.pawbar-md .code .copy) {
    border-radius: min(var(--pawbar-radius, 6px), 6px);
  }
  .frame :global(.pawbar-md .code .copy:hover) {
    color: var(--pawbar-frame-fg, #f2f2f5);
    background: var(--pawbar-thread-wash, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 9%, transparent));
  }

  /* The masked, still-open code fence while a reply streams. */
  .frame :global(.pawbar-shimmer) {
    display: flex;
    flex-direction: column;
    gap: var(--pbf-s2);
    margin: 0.6em 0;
    padding: var(--pbf-s3);
    border: 1px solid var(--pawbar-card-border, var(--pawbar-frame-border, rgb(255 255 255 / 0.14)));
    border-radius: min(var(--pawbar-radius, 10px), 10px);
    background: var(--pawbar-card-bg, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 6%, transparent));
  }
  .frame :global(.pawbar-shimmer-bar) {
    height: 10px;
    border-radius: min(var(--pawbar-radius, 4px), 4px);
    background: linear-gradient(
      90deg,
      color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 7%, transparent) 0%,
      color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent) 50%,
      color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 7%, transparent) 100%
    );
    background-size: 200% 100%;
    animation: pbf-shimmer 1.5s ease-in-out infinite;
  }
  .frame :global(.pawbar-shimmer-bar.medium) {
    width: 70%;
  }
  .frame :global(.pawbar-shimmer-bar.short) {
    width: 40%;
  }
  /* -global-: the rule using it is a :global() one. */
  @keyframes -global-pbf-shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  /* ── E2 form card (FormCard.svelte) ─────────────────────────────────────
     The card's own styles read a token scale this bar does not declare (the
     old shell's, removed 2026-09-27); inside this thread they are replaced. */
  .frame :global(.pawbar-md .form-card) {
    max-width: 420px;
    gap: var(--pbf-s3);
    margin: var(--pbf-s2) 0;
    padding: var(--pbf-s3);
    border: 1px solid var(--pawbar-card-border, var(--pawbar-frame-border, rgb(255 255 255 / 0.14)));
    border-radius: min(var(--pawbar-radius, 12px), 12px);
    background: var(--pawbar-card-bg, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 6%, transparent));
    color: var(--pawbar-frame-fg, #f2f2f5);
  }
  .frame :global(.pawbar-md .form-card .title) {
    font-size: calc(var(--pawbar-message-size, var(--pbf-msg)) - 1px);
  }
  .frame :global(.pawbar-md .form-card .label) {
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }
  .frame :global(.pawbar-md .form-card :is(input, textarea)) {
    padding: var(--pbf-s2) var(--pbf-s3);
    border: 1px solid var(--pawbar-thread-line, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent));
    border-radius: min(var(--pawbar-radius, 8px), 8px);
    background: color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 5%, transparent);
    color: var(--pawbar-frame-fg, #f2f2f5);
    font-size: calc(var(--pawbar-message-size, var(--pbf-msg)) - 1.5px);
  }
  .frame :global(.pawbar-md .form-card :is(input, textarea):focus) {
    outline: 2px solid var(--pawbar-ring, var(--pawbar-frame-fg, #f2f2f5));
    outline-offset: 1px;
    border-color: transparent;
  }
  .frame :global(.pawbar-md .form-card :is(input, textarea)[readonly]) {
    opacity: 0.7;
  }
  .frame :global(.pawbar-md .form-card .error) {
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
    color: var(--pawbar-danger, color-mix(in oklab, #d93036 72%, var(--pawbar-frame-fg, #f2f2f5)));
  }
  /* The site's accent when it has one; otherwise the visitor-bubble pair,
     which contrasts the frame in every theme (the accent's own fallback is
     near-black and vanishes on the default dark frame). */
  .frame :global(.pawbar-md .form-card .submit),
  .contact-send {
    padding: var(--pbf-s2) var(--pbf-s4);
    border: none;
    border-radius: min(var(--pawbar-radius, 8px), 8px);
    background: var(--pawbar-accent, var(--pawbar-bubble-bg, rgb(255 255 255 / 0.86)));
    color: var(--pawbar-accent-fg, var(--pawbar-bubble-fg, #1c1c21));
    font: inherit;
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
    font-weight: 600;
    cursor: pointer;
  }
  .frame :global(.pawbar-md .form-card .submit:hover:not(:disabled)),
  .contact-send:hover:not(:disabled) {
    background: color-mix(in oklab, var(--pawbar-accent, var(--pawbar-bubble-bg, rgb(255 255 255 / 0.86))) 88%, var(--pawbar-frame-fg, #f2f2f5));
  }
  .frame :global(.pawbar-md .form-card .submit:focus-visible),
  .contact-send:focus-visible,
  .contact-dismiss:focus-visible {
    outline: 2px solid var(--pawbar-ring, var(--pawbar-frame-fg, #f2f2f5));
    outline-offset: 2px;
  }
  .frame :global(.pawbar-md .form-card .submit:disabled),
  .contact-send:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .frame :global(.pawbar-md .sent),
  .frame :global(.pawbar-md .card-fallback) {
    margin: var(--pbf-s2) 0;
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }
  .frame :global(.pawbar-md .sent) {
    font-style: normal;
  }

  /* ── Thread tail: the cart row and the E1 contact prompt ────────────────
     Plain rows, no box, left-aligned like a reply. */
  .cart-row {
    display: inline-flex;
    align-items: center;
    gap: var(--pbf-s3);
    align-self: flex-start;
    margin: 0;
    padding: var(--pbf-s1) var(--pbf-s1) var(--pbf-s1) var(--pbf-s3);
    border: 1px solid var(--pawbar-thread-line, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent));
    border-radius: var(--pawbar-radius-pill, var(--pawbar-radius, 999px));
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
    font-variant-numeric: tabular-nums;
  }
  .cart-row .retry {
    border-radius: var(--pawbar-radius-pill, var(--pawbar-radius, 999px));
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
  }
  .contact {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--pbf-s2);
    align-self: stretch;
    max-width: 440px;
  }
  .contact-dismiss {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
    cursor: pointer;
  }
  .contact-dismiss:hover {
    color: var(--pawbar-frame-fg, #f2f2f5);
    background: var(--pawbar-thread-wash, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 9%, transparent));
  }
  .contact-copy {
    margin: 0;
    font-size: calc(var(--pawbar-message-size, var(--pbf-msg)) - 1.5px);
    line-height: 1.4;
  }
  .contact-form,
  .contact-err {
    grid-column: 2;
  }
  .contact-form {
    display: flex;
    gap: var(--pbf-s2);
  }
  .contact-input {
    flex: 1;
    min-width: 0;
    padding: var(--pbf-s2) var(--pbf-s3);
    border: 1px solid var(--pawbar-thread-line, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 16%, transparent));
    border-radius: var(--pawbar-radius-pill, var(--pawbar-radius, 999px));
    background: color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 5%, transparent);
    color: var(--pawbar-frame-fg, #f2f2f5);
    font: inherit;
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
  }
  .contact-input::placeholder {
    color: var(--pawbar-thread-muted, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 62%, transparent));
  }
  .contact-input:focus {
    outline: 2px solid var(--pawbar-ring, var(--pawbar-frame-fg, #f2f2f5));
    outline-offset: 1px;
    border-color: transparent;
  }
  .contact-input[aria-invalid='true'] {
    border-color: var(--pawbar-danger, color-mix(in oklab, #d93036 72%, var(--pawbar-frame-fg, #f2f2f5)));
  }
  .contact-send {
    flex: none;
    border-radius: var(--pawbar-radius-pill, var(--pawbar-radius, 999px));
    white-space: nowrap;
  }
  .contact-err {
    margin: 0;
    font-size: var(--pawbar-meta-size, var(--pbf-meta));
    color: var(--pawbar-danger, color-mix(in oklab, #d93036 72%, var(--pawbar-frame-fg, #f2f2f5)));
  }
  .contact-sent {
    align-self: flex-start;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  /* With fills dropped, the three speakers stay apart by their edges. */
  @media (forced-colors: active) {
    .msg.user,
    .msg.owner {
      border: 1px solid CanvasText;
    }
    .msg.owner {
      border-left-width: 3px;
    }
  }

  /* The credit sits on the host page under the frame. Its own small pill in
     the frame's colours makes it legible on any page, since no theme can know
     what the site behind it looks like. The gap above it is PADDING on the
     wrapper row, not margin, so the pointer never crosses a dead strip that
     would count as leaving the bar. */
  .credit {
    max-width: 100%;
    padding-top: var(--pbf-gap);
    text-align: center;
    font-family: var(--pawbar-font, inherit);
    font-size: 11.5px;
    line-height: 1.35;
    color: var(--pawbar-credit-fg, color-mix(in oklab, var(--pawbar-frame-fg, #f2f2f5) 70%, transparent));
  }
  .credit > * {
    display: inline-block;
    padding: var(--pbf-s1) var(--pbf-s3);
    border-radius: var(--pawbar-radius-pill, var(--pawbar-radius, 999px));
    border: 1px solid var(--pawbar-frame-border, rgb(255 255 255 / 0.14));
    background: var(--pawbar-frame-bg, rgb(38 38 44 / 0.55));
    -webkit-backdrop-filter: blur(var(--pawbar-blur, 18px));
    backdrop-filter: blur(var(--pawbar-blur, 18px));
  }
  .credit strong {
    font-weight: 600;
    color: var(--pawbar-credit-strong, var(--pawbar-frame-fg, #f2f2f5));
  }
  .credit a {
    color: inherit;
    text-decoration: none;
  }
  .credit a:hover,
  .credit a:hover strong {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .dots {
    display: inline-flex;
    gap: var(--pbf-s1);
    padding: var(--pbf-s2) 0;
  }
  .dots span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.3;
    animation: pawbar-dot 1.2s ease-in-out infinite;
  }
  .dots span:nth-child(2) {
    animation-delay: 0.15s;
  }
  .dots span:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes pawbar-dot {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 0.85;
    }
  }
  /* Static dots say nothing about whether the bar is alive; under reduced
     motion the word replaces them. */
  @media (prefers-reduced-motion: reduce) {
    .dots {
      display: none;
    }
    .think-word {
      display: inline;
    }
    .foot,
    .chev,
    .frame :global(.pawbar-md .form-card .submit) {
      transition: none;
    }
    .frame :global(.pawbar-shimmer-bar) {
      animation: none;
    }
  }
</style>
