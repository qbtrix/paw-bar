<!--
  PawBar.svelte — the input, as ONE component that morphs between faces.
  Created 2026-09-27 (fresh start, independent of GlassShell).

  Two launchers, chosen by the site (`launcher`):

    'bar'   (default) a pill at bottom centre: logo · "Ask anything…" · ⋯.
            Opens on HOVER (mouse only), and on click/tap or keyboard focus,
            because touch and keyboard visitors cannot hover.
    'icon'  the traditional corner launcher: one round logo button, bottom
            left or right (`side`). No hover; a click opens the card, which
            grows out of that corner, and ✕ or Escape puts it back.

  Opened, both become the same card: textarea + ⋯ on top, suggestion chips +
  send below. The card stays open while the pointer is over it, focus is in
  it, the size menu is up, or it holds a draft, so nothing half-typed is lost.
  `expanded` is a bindable pin for opening it programmatically.

  THE MORPH. One background element (.pawbar) is the surface for every face.
  Its width and height follow the MEASURED size of the face that should be
  showing, through a Spring; the faces swap with svelte/transition `fade`,
  layered on one anchor (bottom centre, or the launcher's corner), so the
  surface stretches while one face fades out and the next fades in. Its radius
  is min(--pawbar-radius, height / 2): fully round as a pill or icon, the
  token radius as a card, no second value to animate. Reduced motion jumps.

  SIZES. The site picks a default (`size`: sm | md | lg); the visitor can pick
  another from the ⋯ menu (Compact / Default / Large), which is remembered in
  this browser and wins over the site's default. `resizable={false}` removes
  the menu. A size is a set of internal --pb-* values (pill height and width,
  card width, type, logo); a site's own --pawbar-card-width / -pill-width still
  override them. `onsizechange` reports the effective size to a parent.

  THEMING. Every colour, radius, blur and font is a `--pawbar-*` custom
  property read through `var(--x, default)`. Defaults are fallbacks, never
  declarations on our own element, so a site setting them on any ancestor wins.
  The ⋯ / ✕ / send glyphs and washes derive from --pawbar-fg (overridable as
  --pawbar-icon, -icon-hover, -icon-disabled, -control, -control-hover), so they
  contrast in any theme. No elevation shadow: the team dropped those on
  2026-08-19 because on a bordered glass surface they read as a second border.

  FULL SCREEN (2026-09-27). A ⋯ menu item, and a visible exit button while
  it is on. `fullscreen` is bindable: PawBarFrame owns the full-viewport
  layout, PawBar owns the control and widens the card to a reading column.
  The layout switches at once and the card springs to its new width like any
  other size change. (It first ran inside a View Transition; the browser holds
  rendering while that callback runs, the spring runs on animation frames, and
  the card froze half-grown and clipped. One animation system, not two.)
  Escape peels: menu, then full screen, then the card.

  2026-09-27 (bigger sizes): every size grew one step (Default is now 52px
  tall, 540px wide open), and the icon launcher has its own larger diameter
  (--pb-launch) with a radius of half that, so it stays a circle.

  Corners: every corner derives from --pawbar-radius (PawBarFrame's owner
  `radius` setting), chips included; only true circles (send, ⋯, the plain
  mark) stay at 50%.

  STATES (2026-09-27, specs in docs/design/drafts/2026-09-27-paw-bar-states-ux-*):
  • `streaming`: send becomes Stop (`onstop`), Enter is swallowed (the draft
    is kept, never queued), and a click outside does not fold the card mid-
    reply. Focus returns to the textarea when Stop goes away under it.
  • `activity` ('none' | 'thinking' | 'unread' | 'team') + `unreadPreview`:
    what happened while the bar was CLOSED. The pill swaps its placeholder for
    the preview line and shows a dot; the icon launcher shows the dot alone,
    inside its own box so the loader never resizes. The trigger's name says
    it, and one visually hidden status on the always-mounted host announces
    unread/team once (never thinking), and only while the thread is hidden.
  • `readonly` (the chat cannot take messages) and `sendBlocked` (a cooldown
    or a full offline queue): the field or Send stays focusable but inert.
  • `value` is bindable, and `onsend` may resolve to `{ ok: false,
    restoreDraft }`, which puts a refused message back in the field.
  • `describedby` forwards to the textarea (the team-takeover notice).
  • `onrequesthuman` adds "Talk to a person" to the ⋯ menu. It opens a panel
    in place of the chips row: an optional email, the draft goes along as the
    note, "Asking…" while it sends, errors inline with the values kept.
    `handoffPending` turns the item into an inert "Waiting for the team".
    Escape peels: menu, panel, full screen, card. `openContact()` is exported
    for the frame's "Leave your email" notice action.
  • `onready` fires once the logo has loaded, failed, or 800ms passed, so the
    mount point can hold the first paint until the pill is final.
  • Under 360px the pill takes the screen's width instead of overflowing it.
  • `focus()` is exported: the frame lands focus in the field after Retry.
  • Activity 'resume' is the continue pill after a page navigation: the pill
    reads the last answer's first line, with no dot and no announcement,
    because nothing new happened.
  • With no logo (or one that fails to load) the mark is the Lucide
    paw-print on the accent circle, not a blank circle (captain, 2026-09-27).
  • No visitor menu (captain, 2026-09-27: a ⋯ holding seven items confused
    people). Each action sits where it is used instead:
      – `onshowconversations`: a clock icon in the card's top row.
      – `expandable` (default on): a full screen toggle icon beside it, which
        becomes the exit icon. Full screen always has its exit, even when the
        frame opened it on a narrow screen with `expandable` off.
      – `onrequesthuman`: a "Talk to a person" chip in the bottom row, first
        in line ("Waiting for the team", inert, once asked).
    `footer` (a snippet) stands in for the card's contents while it is set:
    the frame's conversation list uses it for one "New conversation" button,
    because a field there would type into a conversation the visitor is not
    looking at.
    A ✕ (Close chat) sits at the end of the top row on every card, both
    launchers and full screen alike (captain, 2026-09-27: closing on an
    outside click is not discoverable enough). It is a real close: it leaves
    full screen and the Talk-to-a-person panel, and folds the card even with
    a draft typed, which would otherwise hold it open. The draft is kept for
    the next open. `outsidePress()` is exported too: the widget shell calls
    it for a click on the host page. Hover cannot reopen it until the pointer has left the
    bar, because the surface reshaping under a still pointer fires a fresh
    pointerenter. `closeChat()` is exported for the frame's list header.
    Escape still peels one layer at a time and keeps a drafted card open.
    A press anywhere inside a hover-opened card pins it, as a click on the
    pill does.
    Host viewport (2026-09-27, iframe wiring): inside the widget's iframe,
    `100vw` and width media queries measure the IFRAME, which is sized from
    this very content, so any clamp against them is a feedback loop that
    shrinks the bar a step at a time. Clamps read `--pb-host-w` instead
    (set by the frame from the host page's viewport, 100vw when absent), and
    the phone-width pill is the `narrow` prop, not a media query.
    `chrome={false}` takes the clock, full screen and ✕ out of the card:
    PawBarFrame draws them in a header at the top of the chat instead
    (captain, 2026-09-27: window controls belong at the top, not in the
    input). They stay in the card for a bar used on its own.
    ⋯ is left for the sizes, and only when the owner turns on `resizable`
    (now off by default). Low-frequency items (privacy, delete my data)
    belong there when they arrive.

  `boundary` widens click-outside and hover to a parent element (PawBarFrame,
  whose thread and credit sit outside the bar). `logoSrc` is the site's logo,
  fitted not cropped, falling back to a plain mark if it fails to load.
  `onopenchange` reports the card opening and closing.
-->
<script lang="ts" module>
  export type BarSize = 'sm' | 'md' | 'lg';
  export type BarLauncher = 'bar' | 'icon';
  export type BarSide = 'left' | 'right';

  export const SIZE_KEY = '__pawbar_size_v1';
  const SIZES: BarSize[] = ['sm', 'md', 'lg'];
  export const SIZE_LABELS: Record<BarSize, string> = { sm: 'Compact', md: 'Default', lg: 'Large' };

  /** 'resume' is not news: the visitor had the bar open on the previous page,
   *  and the pill offers to carry on where they were. */
  export type BarActivity = 'none' | 'thinking' | 'unread' | 'team' | 'resume';
  /** What a send can resolve to. A refused message comes back as `restoreDraft`. */
  export type BarSendResult = { ok: true } | { ok: false; restoreDraft?: string };
  export type BarContactRequest = { message: string; contact: string };
  /** `error` 'invalid_email' keeps the panel open on the field; 'already_asked'
   *  and 'unavailable' close it; anything else shows `text` inline. */
  export type BarContactResult = { ok: true } | { ok: false; error?: string; text: string };

  /** One line of a reply for the closed pill: whitespace collapsed, capped. */
  export function previewLine(text: string, max = 80): string {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  function readChosenSize(): BarSize | null {
    try {
      const v = localStorage.getItem(SIZE_KEY);
      return SIZES.includes(v as BarSize) ? (v as BarSize) : null;
    } catch {
      return null; // storage blocked: the site default stands
    }
  }
  function writeChosenSize(v: BarSize) {
    try {
      localStorage.setItem(SIZE_KEY, v);
    } catch {
      /* storage blocked: the choice lasts for this page view only */
    }
  }
</script>

<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { fade } from 'svelte/transition';
  import { Spring, prefersReducedMotion } from 'svelte/motion';
  import { autosize } from '../../lib/composer/autosize';
  import { MAX_MESSAGE_CHARS } from '../../lib/composer/limits';

  let {
    placeholder = 'Ask anything…',
    suggestions = [],
    expanded = $bindable(false),
    logo,
    logoSrc = '',
    launcher = 'bar',
    side = 'right',
    size = 'md',
    resizable = false,
    expandable = true,
    fullscreen = $bindable(false),
    value = $bindable(''),
    streaming = false,
    readonly = false,
    sendBlocked = false,
    activity = 'none',
    unreadPreview = '',
    describedby,
    onsend,
    onstop,
    onrequesthuman,
    handoffPending = false,
    onshowconversations,
    chrome = true,
    narrow = false,
    footer,
    onsuggestion,
    boundary = null,
    onopenchange,
    onsizechange,
    onready,
  }: {
    placeholder?: string;
    /** Chips on the expanded card. The first reads as primary. */
    suggestions?: string[];
    expanded?: boolean;
    /** Replaces the default round mark. */
    logo?: Snippet;
    /** The site's brand logo. A `logo` snippet wins over it. */
    logoSrc?: string;
    launcher?: BarLauncher;
    /** Which corner the icon launcher sits in. Ignored by the bar. */
    side?: BarSide;
    /** The site's default size. A visitor's own pick from ⋯ wins over it. */
    size?: BarSize;
    /** Whether the visitor gets the ⋯ size menu (owner opt-in). */
    resizable?: boolean;
    /** The full screen toggle in the card's top row. */
    expandable?: boolean;
    fullscreen?: boolean;
    /** The draft. Bindable so a refused message can be put back. */
    value?: string;
    /** A reply is being written: send becomes Stop. */
    streaming?: boolean;
    /** The chat cannot take messages at all. */
    readonly?: boolean;
    /** Sending is paused for a moment (cooldown, full offline queue). */
    sendBlocked?: boolean;
    /** What happened while the bar was closed. */
    activity?: BarActivity;
    /** The newest unseen turn, as one line of plain text. */
    unreadPreview?: string;
    /** id of an element describing the field (the team notice). */
    describedby?: string;
    onsend: (text: string) => void | BarSendResult | Promise<void | BarSendResult>;
    onstop?: () => void;
    /** Adds "Talk to a person" to the ⋯ menu and its panel. */
    onrequesthuman?: (req: BarContactRequest) => Promise<BarContactResult>;
    /** A person has been asked for and not arrived yet. */
    handoffPending?: boolean;
    /** Adds the conversations icon to the card's top row. */
    onshowconversations?: () => void;
    /** The clock, full screen and ✕ in the card's top row. */
    chrome?: boolean;
    /** The host screen is narrower than the pill: it takes the width it has. */
    narrow?: boolean;
    /** Replaces the whole card (field, icons, chips, Send) while it is set.
     *  The draft is kept and comes back with the field. */
    footer?: Snippet;
    /** Defaults to sending the chip's text. */
    onsuggestion?: (text: string) => void;
    boundary?: HTMLElement | null;
    onopenchange?: (open: boolean) => void;
    onsizechange?: (size: BarSize) => void;
    /** The resting face is final (logo loaded, failed, or 800ms). */
    onready?: () => void;
  } = $props();

  const isIcon = $derived(launcher === 'icon');
  const anchor = $derived(isIcon ? side : 'center');

  // ── Size ──────────────────────────────────────────────────────────────────
  let chosen = $state<BarSize | null>(readChosenSize());
  const effectiveSize = $derived<BarSize>(chosen ?? (SIZES.includes(size) ? size : 'md'));
  $effect(() => {
    onsizechange?.(effectiveSize);
  });

  function chooseSize(v: BarSize) {
    chosen = v;
    writeChosenSize(v);
    void closeMenu();
  }

  // ── Logo ──────────────────────────────────────────────────────────────────
  let logoFailed = $state(false);
  $effect(() => {
    void logoSrc;
    logoFailed = false;
  });

  // ── Ready ─────────────────────────────────────────────────────────────────
  // Once: the logo settled one way or the other, or 800ms, whichever is first.
  // A snippet logo or no logo at all is ready at once.
  let readySent = false;
  function ready() {
    if (readySent) return;
    readySent = true;
    onready?.();
  }
  $effect(() => {
    if (logo || !logoSrc) {
      ready();
      return;
    }
    const t = setTimeout(ready, 800);
    return () => clearTimeout(t);
  });

  // ── Open state ────────────────────────────────────────────────────────────
  const canSend = $derived(
    !readonly && !sendBlocked && value.trim().length > 0 && value.trim().length <= MAX_MESSAGE_CHARS,
  );

  let hovering = $state(false);
  let focusInside = $state(false);
  let menuOpen = $state(false);
  let contactOpen = $state(false);
  // Set by ✕: nothing but a new open (a pin, a fresh hover, focus back in the
  // card) brings the card back, not even the draft it is holding.
  let dismissed = $state(false);
  const open = $derived(
    expanded ||
      fullscreen ||
      (!dismissed && (hovering || focusInside || menuOpen || contactOpen || value.trim().length > 0)),
  );
  $effect(() => {
    if (expanded || fullscreen) dismissed = false;
  });
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    onopenchange?.(open);
  });

  let hostEl: HTMLDivElement | null = $state(null);
  let triggerEl: HTMLButtonElement | null = $state(null);
  let fieldEl: HTMLTextAreaElement | null = $state(null);
  let menuBtnEl: HTMLButtonElement | null = $state(null);
  // The menu holds the sizes, when the owner turns them on. Its items are read
  // from the DOM, so the keyboard walk counts whatever is there.
  let menuEl: HTMLDivElement | null = $state(null);
  const menuItems = () => [...(menuEl?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? [])];
  const hasMenu = $derived(resizable);

  // Hover is tracked on the boundary when there is one, else on our own host.
  $effect(() => {
    const el = boundary ?? hostEl;
    if (!el) return;
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
    };
  });

  // ── The morph ─────────────────────────────────────────────────────────────
  // Each face reports its natural size; the surface springs toward the size of
  // the face that should be showing. The first measurement lands instantly, so
  // the bar does not grow in from 0×0 on page load.
  // One pair per face. Faces cross-fade, so the outgoing one is still in the
  // DOM (and still measured) while the incoming one mounts; sharing one pair
  // let the pill's late measurement overwrite the launcher's and left the
  // icon sitting in a pill-wide surface.
  let pillW = $state(0);
  let pillH = $state(0);
  let launchW = $state(0);
  let launchH = $state(0);
  const restW = $derived(isIcon ? launchW : pillW);
  const restH = $derived(isIcon ? launchH : pillH);
  let cardW = $state(0);
  let cardH = $state(0);

  const box = new Spring({ w: 0, h: 0 }, { stiffness: 0.16, damping: 0.78 });
  let placed = false;

  $effect(() => {
    const w = open ? cardW : restW;
    const h = open ? cardH : restH;
    if (!w || !h) return;
    void box.set({ w, h }, { instant: !placed || prefersReducedMotion.current });
    placed = true;
  });

  // ── Full screen ───────────────────────────────────────────────────────────
  function setFullscreen(v: boolean) {
    fullscreen = v;
  }

  async function toggleFullscreen() {
    menuOpen = false;
    setFullscreen(!fullscreen);
    await tick();
    fieldEl?.focus();
  }

  const fadeIn = $derived({ duration: prefersReducedMotion.current ? 0 : 180, delay: prefersReducedMotion.current ? 0 : 90 });
  const fadeOut = $derived({ duration: prefersReducedMotion.current ? 0 : 110 });
  const swap = $derived({ duration: prefersReducedMotion.current ? 0 : 120 });

  // ── Open / close ──────────────────────────────────────────────────────────
  // Hover opens the BAR only, and without taking focus: moving a mouse across
  // a page must never pull the caret out of whatever the visitor was typing
  // into. The icon launcher is click-only by design — that is its whole point.
  function onEnter(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || isIcon) return;
    clearTimeout(leaveTimer);
    if (hoverLocked) return;
    hovering = true;
    dismissed = false;
  }
  // After ✕ the pointer is usually still over the bar, and the surface
  // reshaping under it fires a fresh pointerenter, which reopened the card on
  // the spot. Hover stays off until the pointer is seen outside the boundary.
  let hoverLocked = false;
  function onWindowPointermove(e: PointerEvent) {
    if (!hoverLocked) return;
    const inside = boundary ?? hostEl;
    if (inside && !inside.contains(e.target as Node)) hoverLocked = false;
  }
  // A short grace period so skimming the edge does not flicker it shut.
  function onLeave(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || isIcon) return;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => (hovering = false), 140);
  }
  // Only focus INSIDE THE CARD holds it open. Focus on the resting face's
  // trigger must not: Escape hands focus back to it, and if that counted the
  // card would reopen the moment it closed.
  function onFocusIn(e: FocusEvent) {
    focusInside = !!(e.target as Element | null)?.closest?.('.card, .menu');
    if (focusInside) dismissed = false;
  }
  function onFocusOut(e: FocusEvent) {
    if (!hostEl?.contains(e.relatedTarget as Node | null)) focusInside = false;
  }

  // Click / tap on the resting face: open AND focus, the visitor asked to type.
  async function openAndFocus() {
    expanded = true;
    await tick();
    fieldEl?.focus();
  }

  // A press inside a card that hover opened pins it: the visitor chose it, so
  // it gets the full view (thread or greeting, and the header with ✕).
  function pinOnPress() {
    if (!expanded) expanded = true;
  }

  /** ✕: close for real, from any layer, whatever is typed. */
  export async function closeChat() {
    contactOpen = false;
    setFullscreen(false);
    dismissed = true;
    hoverLocked = true;
    await close();
  }

  async function close() {
    expanded = false;
    hovering = false;
    focusInside = false;
    menuOpen = false;
    if (hostEl?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    await tick();
    if (!open) triggerEl?.focus({ preventScroll: true });
  }

  function send(text: string) {
    const t = text.trim();
    if (!t || t.length > MAX_MESSAGE_CHARS || streaming || readonly || sendBlocked) return;
    const result = onsend(t);
    value = '';
    if (fieldEl) fieldEl.style.height = 'auto';
    // A refused message comes back; it only lands if nothing new was typed.
    void Promise.resolve(result).then((res) => {
      if (res && !res.ok && res.restoreDraft && !value) value = res.restoreDraft;
    });
  }

  function stop() {
    onstop?.();
    fieldEl?.focus();
  }

  // ── Talk to a person ──────────────────────────────────────────────────────
  let email = $state('');
  let asking = $state(false);
  let contactError = $state('');
  let emailInvalid = $state(false);
  let emailEl: HTMLInputElement | null = $state(null);
  // A loose x@y.z check; the server's answer is the real one.
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** Open the panel (⋯ item, or the frame's "Leave your email" action). */
  export async function openContact() {
    if (!onrequesthuman || handoffPending) return;
    menuOpen = false;
    expanded = true;
    contactOpen = true;
    contactError = '';
    emailInvalid = false;
    await tick();
    emailEl?.focus({ preventScroll: true });
  }
  function closeContact() {
    contactOpen = false;
    contactError = '';
    emailInvalid = false;
    fieldEl?.focus({ preventScroll: true });
  }
  async function askForPerson() {
    if (!onrequesthuman || asking) return;
    const contact = email.trim();
    if (contact && !EMAIL.test(contact)) {
      emailInvalid = true;
      contactError = "That email doesn't look right.";
      emailEl?.focus();
      return;
    }
    asking = true;
    contactError = '';
    emailInvalid = false;
    try {
      const res = await onrequesthuman({ message: value.trim(), contact });
      if (res.ok) {
        value = '';
        email = '';
        closeContact();
      } else if (res.error === 'already_asked' || res.error === 'unavailable') {
        closeContact();
      } else {
        contactError = res.text;
        emailInvalid = res.error === 'invalid_email';
        if (emailInvalid) emailEl?.focus();
      }
    } finally {
      asking = false;
    }
  }

  /** Focus the field (the frame calls this after Retry). */
  export function focus() {
    fieldEl?.focus({ preventScroll: true });
  }

  // Stop is removed from under the focus when the reply ends; hand focus to
  // the field rather than letting it fall to <body>.
  let stopEl: HTMLButtonElement | null = $state(null);
  let stopHadFocus = false;
  $effect.pre(() => {
    if (!streaming) stopHadFocus = !!stopEl && document.activeElement === stopEl;
  });
  $effect(() => {
    if (!streaming && stopHadFocus) {
      stopHadFocus = false;
      fieldEl?.focus();
    }
  });

  // ── Activity on the closed bar ────────────────────────────────────────────
  const preview = $derived(previewLine(unreadPreview));
  const triggerText = $derived(
    activity === 'thinking' ? 'Replying…'
    : activity === 'team' ? `Team: ${preview || 'New message'}`
    : activity === 'unread' ? preview || 'New reply'
    : activity === 'resume' ? preview || 'Continue the conversation'
    : placeholder,
  );
  const activityName = $derived(
    activity === 'thinking' ? 'reply in progress'
    : activity === 'team' ? `new message from the team: ${preview || 'New message'}`
    : activity === 'unread' ? `1 new reply: ${preview || 'New reply'}`
    : activity === 'resume' ? `continue the conversation${preview ? `: ${preview}` : ''}`
    : '',
  );
  // The dot means news. Resuming is not news, so it gets none.
  const dotted = $derived(activity !== 'none' && activity !== 'resume');
  const launchLabel = $derived(activityName ? `Open chat, ${activityName}` : 'Open chat');
  // The one announcement: only while closed, only for unread/team, once per
  // change. It empties as soon as the card opens, where the thread speaks.
  const announce = $derived(!open && (activity === 'unread' || activity === 'team') ? activityName : '');

  function pick(text: string) {
    if (onsuggestion) onsuggestion(text);
    else send(text);
  }

  function onFieldKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      // Swallowed mid-reply: no send, no newline, the draft stays.
      e.preventDefault();
      if (!streaming) send(value);
    }
  }

  // Escape peels one layer at a time: the menu, full screen, then the card.
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (menuOpen) void closeMenu();
    else if (contactOpen) closeContact();
    else if (fullscreen) setFullscreen(false);
    else if (open) void close();
  }

  // A click elsewhere closes the menu, and folds the card back when nothing is
  // typed, so a stray click never throws away a half-written question.
  function onWindowPointerdown(e: PointerEvent) {
    const inside = boundary ?? hostEl;
    if (!inside || inside.contains(e.target as Node)) return;
    outsidePress();
  }
  /** A press outside the bar. Also called by the widget shell for a click on
   *  the HOST page, which a frame's own listeners cannot see. */
  export function outsidePress() {
    menuOpen = false;
    // Never fold a reply that is still being written.
    if (open && !value.trim() && !streaming) expanded = false;
  }

  // ── Size menu ─────────────────────────────────────────────────────────────
  // role="menu" is a promise: arrow keys move between items and exactly one of
  // them is in the tab order. Opening lands focus on the checked item.
  async function toggleMenu() {
    if (menuOpen) return closeMenu();
    menuOpen = true;
    await tick();
    const items = menuItems();
    (items.find((b) => b.tabIndex === 0) ?? items[0])?.focus();
  }
  async function closeMenu() {
    menuOpen = false;
    await tick();
    menuBtnEl?.focus();
  }
  function onMenuKeydown(e: KeyboardEvent) {
    const items = menuItems();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const n = items.length;
    const to =
      e.key === 'ArrowDown' ? (i + 1) % n
      : e.key === 'ArrowUp' ? (i - 1 + n) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    items[to]?.focus();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerdown} onpointermove={onWindowPointermove} />

{#snippet dots()}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <circle cx="5" cy="12" r="1.6" fill="currentColor" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" />
  </svg>
{/snippet}

{#snippet activityDot()}
  <span class="activity" data-activity={activity} aria-hidden="true">
    {#if activity === 'team'}
      <svg viewBox="0 0 16 16" width="100%" height="100%">
        <circle cx="8" cy="5.8" r="2.4" fill="currentColor" />
        <path d="M3.6 12.6c.6-2.1 2.4-3.3 4.4-3.3s3.8 1.2 4.4 3.3" fill="currentColor" />
      </svg>
    {/if}
  </span>
{/snippet}

{#snippet brand()}
  <span class="logo" aria-hidden="true">
    {#if logo}
      {@render logo()}
    {:else if logoSrc && !logoFailed}
      <img class="brand" src={logoSrc} alt="" decoding="async" onerror={() => (logoFailed = true)} />
    {:else}
      <!-- Lucide "paw-print" (ISC licence), the default when the site has no logo. -->
      <span class="mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="4" r="2" />
          <circle cx="18" cy="8" r="2" />
          <circle cx="20" cy="16" r="2" />
          <path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z" />
        </svg>
      </span>
    {/if}
  </span>
{/snippet}

{#snippet menuButton()}
  {#if hasMenu}
    <button
      type="button"
      class="icon"
      bind:this={menuBtnEl}
      aria-label="Chat options"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onclick={toggleMenu}
    >
      {@render dots()}
    </button>
  {/if}
{/snippet}

<!-- The host is unstyled: it carries the size and anchor, holds the menu
     OUTSIDE the surface (which clips), and is our own hover/click boundary. -->
<div
  class="pawbar-host"
  data-narrow={narrow ? 'true' : undefined}
  data-size={effectiveSize}
  data-anchor={anchor}
  data-launcher={launcher}
  data-full={fullscreen ? 'true' : undefined}
  bind:this={hostEl}
  onfocusin={onFocusIn}
  onfocusout={onFocusOut}
  role="group"
  aria-label="Concierge"
>
  <span class="sr-only" role="status" aria-live="polite">{announce}</span>
  <div
    class="pawbar"
    class:expanded={open}
    style:width={box.current.w ? `${box.current.w}px` : undefined}
    style:height={box.current.h ? `${box.current.h}px` : undefined}
    style:--h={`${box.current.h}px`}
  >
    {#if open}
      <div
        class="face card"
        role="group"
        aria-label={footer ? undefined : 'Ask a question'}
        bind:offsetWidth={cardW}
        bind:offsetHeight={cardH}
        in:fade={fadeIn}
        out:fade={fadeOut}
        onpointerdown={pinOnPress}
      >
        {#if footer}
          {@render footer()}
        {:else}
        <div class="row top">
          <textarea
            bind:this={fieldEl}
            bind:value
            use:autosize
            rows="1"
            {placeholder}
            {readonly}
            aria-readonly={readonly || undefined}
            maxlength={MAX_MESSAGE_CHARS}
            aria-label="Message"
            aria-keyshortcuts="Enter"
            aria-describedby={describedby}
            onkeydown={onFieldKeydown}
          ></textarea>
          {#if chrome && onshowconversations}
            <button type="button" class="icon" aria-label="Your conversations" title="Your conversations" onclick={onshowconversations}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
                <path d="M3.5 4v4h4M12 8v4.5l3 2" />
              </svg>
            </button>
          {/if}
          {#if chrome && (expandable || fullscreen)}
            <button
              type="button"
              class="icon"
              aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
              title={fullscreen ? 'Exit full screen' : 'Full screen'}
              onclick={toggleFullscreen}
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
          {@render menuButton()}
          {#if chrome}
            <button type="button" class="icon" aria-label="Close chat" title="Close" onclick={closeChat}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
              </svg>
            </button>
          {/if}
        </div>
        {#if contactOpen}
          <div class="contact" role="group" aria-labelledby="pb-contact-title" transition:fade={swap}>
            <div class="contact-head">
              <strong id="pb-contact-title">Talk to a person</strong>
              <button type="button" class="icon" aria-label="Close" onclick={closeContact}>
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
                </svg>
              </button>
            </div>
            <p class="contact-line">Someone from the team will pick this up.{value.trim() ? ' Your message above goes with it.' : ''}</p>
            <input
              bind:this={emailEl}
              bind:value={email}
              class="contact-email"
              type="email"
              inputmode="email"
              autocomplete="email"
              placeholder="Email (optional)"
              aria-label="Email (optional)"
              aria-describedby="pb-contact-help"
              aria-invalid={emailInvalid || undefined}
              readonly={asking}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void askForPerson();
                }
              }}
            />
            <p class="contact-line" id="pb-contact-help">So they can reply if you've left.</p>
            <div class="contact-foot">
              <p class="contact-error" role="status">{contactError}</p>
              <button type="button" class="ask" aria-busy={asking || undefined} onclick={askForPerson}>
                {asking ? 'Asking…' : 'Ask for a person'}
              </button>
            </div>
          </div>
        {/if}
        <div class="row bottom">
          <div class="chips" hidden={contactOpen}>
            {#if onrequesthuman}
              <button
                type="button"
                class="chip person"
                aria-disabled={handoffPending || undefined}
                onclick={() => void openContact()}
              >
                {handoffPending ? 'Waiting for the team' : 'Talk to a person'}
              </button>
            {/if}
            {#each suggestions as s, i (s)}
              <button type="button" class="chip" class:primary={i === 0} onclick={() => pick(s)}>{s}</button>
            {/each}
          </div>
          {#if streaming}
            <button type="button" class="send stop" bind:this={stopEl} aria-label="Stop reply" onclick={stop} in:fade={swap}>
              <span class="stop-glyph" aria-hidden="true"></span>
            </button>
          {:else}
            <!-- Blocked for a moment (cooldown) it stays focusable, so a
                 keyboard visitor can still find it and hear why. -->
            <button
              type="button"
              class="send"
              class:ready={canSend}
              disabled={!canSend && !sendBlocked}
              aria-disabled={sendBlocked || undefined}
              aria-label="Send"
              onclick={() => send(value)}
              in:fade={swap}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m5 12 7-7 7 7" />
                <path d="M12 19V5" />
              </svg>
            </button>
          {/if}
        </div>
        {/if}
      </div>
    {:else if isIcon}
      <div class="face launcher" bind:offsetWidth={launchW} bind:offsetHeight={launchH} in:fade={fadeIn} out:fade={fadeOut}>
        <button type="button" class="launch" bind:this={triggerEl} aria-expanded="false" aria-label={launchLabel} onclick={openAndFocus}>
          {@render brand()}
        </button>
        {#if dotted}{@render activityDot()}{/if}
      </div>
    {:else}
      <div class="face pill" class:busy={activity !== 'none'} bind:offsetWidth={pillW} bind:offsetHeight={pillH} in:fade={fadeIn} out:fade={fadeOut}>
        {@render brand()}
        <button
          type="button"
          class="trigger"
          class:news={activity === 'unread' || activity === 'team'}
          class:resume={activity === 'resume'}
          bind:this={triggerEl}
          aria-expanded="false"
          aria-label={activityName ? launchLabel : undefined}
          onclick={openAndFocus}
        >
          {triggerText}
        </button>
        {#if dotted}{@render activityDot()}{/if}
        {@render menuButton()}
      </div>
    {/if}
  </div>

  {#if menuOpen}
    <div class="menu" role="menu" aria-label="Chat options" tabindex="-1" bind:this={menuEl} onkeydown={onMenuKeydown} transition:fade={fadeOut}>
      {#if resizable}
      <span class="menu-label" aria-hidden="true">Size</span>
      {#each SIZES as s (s)}
        <button
          type="button"
          class="menu-item"
          role="menuitemradio"
          aria-checked={effectiveSize === s}
          tabindex={effectiveSize === s ? 0 : -1}
          onclick={() => chooseSize(s)}
        >
          <span>{SIZE_LABELS[s]}</span>
          {#if effectiveSize === s}
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          {/if}
        </button>
      {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  /* ── Size presets ─────────────────────────────────────────────────────────
     Internal --pb-* values, set here on our own host. That is safe where a
     --pawbar-* declaration would not be: no site sets --pb-*, and every rule
     below reads the site's --pawbar-* override FIRST, these second. --pb-rest
     is the resting height, shared by the pill and the icon launcher so both
     sit at the same height and radius; --pb-radius is half of it, so the
     default pill is fully round at every size (a fixed 22px would leave the
     52px Large pill a rounded rectangle). */
  .pawbar-host {
    position: relative;
    display: inline-block;
    --pb-rest: 52px;
    --pb-radius: 26px;
    --pb-launch: 60px;
    --pb-pill-w: 300px;
    --pb-card-w: 540px;
    --pb-font: 16px;
    --pb-font-sm: 15px;
    --pb-logo: 30px;
  }
  .pawbar-host[data-size='sm'] {
    --pb-rest: 46px;
    --pb-radius: 23px;
    --pb-launch: 52px;
    --pb-pill-w: 250px;
    --pb-card-w: 440px;
    --pb-font: 15px;
    --pb-font-sm: 14px;
    --pb-logo: 26px;
  }
  .pawbar-host[data-size='lg'] {
    --pb-rest: 60px;
    --pb-radius: 30px;
    --pb-launch: 68px;
    --pb-pill-w: 360px;
    --pb-card-w: 680px;
    --pb-font: 17px;
    --pb-font-sm: 16px;
    --pb-logo: 34px;
  }
  /* The icon launcher is a circle at its own, larger diameter, so its default
     radius is half THAT. */
  .pawbar-host[data-launcher='icon'] {
    --pb-radius: calc(var(--pb-launch) / 2);
  }
  /* Full screen: the card becomes a reading column. The frame, not this
     component, lays out the viewport around it. */
  .pawbar-host[data-full] {
    --pb-card-w: 760px;
  }

  /* The one surface. Its size comes from the spring; everything visual comes
     from the site's tokens. */
  .pawbar {
    position: relative;
    box-sizing: border-box;
    overflow: hidden;
    font-family: var(--pawbar-font, inherit);
    color: var(--pawbar-fg, #1c1c21);
    background: var(--pawbar-bg, rgb(255 255 255 / 0.78));
    border: 1px solid var(--pawbar-border, rgb(255 255 255 / 0.65));
    border-radius: min(var(--pawbar-radius, var(--pb-radius)), calc(var(--h) / 2));
    -webkit-backdrop-filter: blur(var(--pawbar-blur, 18px)) saturate(1.4);
    backdrop-filter: blur(var(--pawbar-blur, 18px)) saturate(1.4);
  }

  /* Every face sits on the same anchor, so during a swap the outgoing and
     incoming faces overlap in place and the surface grows out of the resting
     spot: from bottom centre for the bar, from its corner for the icon. */
  .face {
    position: absolute;
    bottom: 0;
    box-sizing: border-box;
  }
  [data-anchor='center'] .face {
    left: 50%;
    transform: translateX(-50%);
  }
  [data-anchor='left'] .face {
    left: 0;
  }
  [data-anchor='right'] .face {
    right: 0;
  }

  /* ── Resting faces ────────────────────────────────────────────────────── */
  .pill {
    display: flex;
    align-items: center;
    gap: 8px;
    width: max-content;
    min-width: var(--pawbar-pill-width, var(--pb-pill-w));
    height: var(--pb-rest);
    padding: 0 7px;
  }
  /* With news on it the pill keeps its resting width and the preview line
     ellipsizes: the pill never grows, so the loader never resizes. */
  .pill.busy {
    width: var(--pawbar-pill-width, var(--pb-pill-w));
  }
  /* A phone narrower than the pill: it takes the width it has, and the
     placeholder or preview ellipsises. A prop, not a media query: in the
     widget's iframe a width query measures the iframe, not the phone. */
  [data-narrow] .pill,
  [data-narrow] .pill.busy {
    min-width: 0;
    width: calc(var(--pb-host-w, 100vw) - 32px);
  }
  .launcher {
    width: var(--pb-launch);
    height: var(--pb-launch);
  }
  .launcher .logo {
    width: calc(var(--pb-logo) + 4px);
    height: calc(var(--pb-logo) + 4px);
  }
  .launch {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    border-radius: inherit;
    background: none;
    cursor: pointer;
  }
  .logo {
    flex: none;
    display: inline-flex;
    width: var(--pb-logo);
    height: var(--pb-logo);
  }
  /* Brand logos come in every shape. Fitted into the slot, never cropped to a
     circle, so a wordmark or a wide monogram still reads as the brand. */
  .brand {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: var(--pawbar-accent, #111114);
    color: var(--pawbar-accent-fg, #fff);
  }
  .mark svg {
    width: 62%;
    height: 62%;
  }
  .trigger {
    flex: 1;
    min-width: 0;
    padding: 6px 4px;
    border: none;
    background: none;
    color: var(--pawbar-muted, color-mix(in oklab, currentColor 55%, transparent));
    font: inherit;
    font-size: var(--pb-font-sm);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: text;
  }

  /* A preview of something new reads as content, not as a placeholder. */
  .trigger.news,
  .trigger.resume {
    color: var(--pawbar-preview-fg, var(--pawbar-fg, #1c1c21));
  }

  /* ── Activity on the closed bar ───────────────────────────────────────────
     A circle (never the owner radius). On the pill it sits between the text
     and ⋯; on the icon launcher it sits on the circle's edge at 45°, INSIDE
     the launcher box, cut out by a ring in the bar's own colour. `team` is
     told apart by the person glyph (and the "Team:" prefix), never by colour. */
  .activity {
    flex: none;
    box-sizing: border-box;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--pawbar-activity, var(--pawbar-accent, #111114));
    color: var(--pawbar-activity-fg, var(--pawbar-accent-fg, #fff));
    animation: pb-dot-in 160ms ease-out;
  }
  .activity[data-activity='team'] {
    width: 16px;
    height: 16px;
    padding: 2px;
  }
  .activity[data-activity='thinking'] {
    opacity: 0.7;
    animation: pb-think 1.4s ease-in-out infinite;
  }
  .launcher .activity {
    position: absolute;
    /* On the circle's edge at 45°: r − r/√2 from the corner, less half the dot. */
    top: calc(var(--pb-launch) * 0.146 - 5px);
    width: 12px;
    height: 12px;
    border: 2px solid var(--pawbar-activity-ring, var(--pawbar-bg, rgb(255 255 255 / 0.78)));
  }
  .launcher .activity[data-activity='team'] {
    top: calc(var(--pb-launch) * 0.146 - 9px);
    width: 18px;
    height: 18px;
  }
  [data-anchor='right'] .launcher .activity {
    right: calc(var(--pb-launch) * 0.146 - 5px);
  }
  [data-anchor='left'] .launcher .activity {
    left: calc(var(--pb-launch) * 0.146 - 5px);
  }
  @keyframes pb-dot-in {
    from {
      transform: scale(0.6);
    }
  }
  @keyframes pb-think {
    0%,
    100% {
      opacity: 0.45;
    }
    50% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .activity,
    .activity[data-activity='thinking'] {
      animation: none;
    }
  }

  /* ── Talk to a person ─────────────────────────────────────────────────── */
  .contact {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 4px 0 2px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in oklab, var(--pawbar-fg, #1c1c21) 10%, transparent);
    font-size: var(--pb-font-sm);
  }
  .contact-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .contact-line {
    margin: 0;
    font-size: 0.9em;
    color: var(--pawbar-muted, color-mix(in oklab, var(--pawbar-fg, #1c1c21) 60%, transparent));
  }
  .contact-email {
    box-sizing: border-box;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--pawbar-border, color-mix(in oklab, var(--pawbar-fg, #1c1c21) 16%, transparent));
    border-radius: min(var(--pawbar-radius, 10px), 10px);
    background: none;
    color: inherit;
    font: inherit;
  }
  .contact-email:focus-visible {
    outline: 2px solid var(--pawbar-ring, var(--pawbar-accent, #111114));
    outline-offset: 1px;
  }
  .contact-email[aria-invalid='true'] {
    border-color: var(--pawbar-danger, color-mix(in oklab, #d93036 72%, var(--pawbar-fg, #1c1c21)));
  }
  .contact-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .contact-error {
    margin: 0;
    font-size: 0.9em;
    color: var(--pawbar-danger, color-mix(in oklab, #d93036 72%, var(--pawbar-fg, #1c1c21)));
  }
  .ask {
    flex: none;
    padding: 7px 14px;
    border: none;
    border-radius: var(--pawbar-radius-pill, var(--pawbar-radius, 999px));
    background: var(--pawbar-accent, #111114);
    color: var(--pawbar-accent-fg, #fff);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .ask[aria-busy='true'] {
    opacity: 0.7;
    cursor: progress;
  }
  .ask:focus-visible {
    outline: 2px solid var(--pawbar-ring, var(--pawbar-accent, #111114));
    outline-offset: 2px;
  }
  .chip[aria-disabled='true'] {
    opacity: 0.6;
    cursor: default;
  }
  textarea[readonly] {
    cursor: not-allowed;
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

  /* ── Card ─────────────────────────────────────────────────────────────── */
  .card {
    display: flex;
    flex-direction: column;
    gap: 18px;
    width: min(var(--pawbar-card-width, var(--pb-card-w)), calc(var(--pb-host-w, 100vw) - 48px));
    padding: 14px 14px 12px 16px;
  }
  .row {
    display: flex;
    gap: 4px;
  }
  .top {
    align-items: flex-start;
  }
  .bottom {
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  textarea {
    flex: 1;
    min-width: 0;
    margin-right: 4px;
    resize: none;
    border: none;
    outline: none;
    background: none;
    padding: 4px 0;
    color: inherit;
    font: inherit;
    font-size: var(--pb-font);
    line-height: 1.5;
  }
  textarea::placeholder {
    color: var(--pawbar-muted, color-mix(in oklab, currentColor 55%, transparent));
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
  }
  .chip {
    padding: 7px 14px;
    border: 1px solid var(--pawbar-chip-border, color-mix(in oklab, currentColor 30%, transparent));
    border-radius: var(--pawbar-radius-pill, var(--pawbar-radius, 999px));
    background: none;
    color: inherit;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      box-shadow 0.15s ease,
      transform 0.1s ease;
  }
  .chip:hover {
    background: color-mix(in oklab, currentColor 7%, transparent);
  }
  .chip.primary {
    border-color: transparent;
    background: var(--pawbar-accent, #111114);
    color: var(--pawbar-accent-fg, #fff);
  }
  /* Hover on filled controls is a halo, not a lighter or darker fill: the
     accent is the site's, and "mix with white" does nothing to a white accent
     and too much to a pale one. A ring of the accent itself reads on both. */
  .chip.primary:hover,
  .send.ready:hover {
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--pawbar-accent, #111114) 22%, transparent);
  }

  /* ── Icon controls (⋯, ✕, send) ───────────────────────────────────────────
     Glyph and wash both derive from --pawbar-fg, never from the accent's
     foreground, so they contrast in whatever theme a site hands us. */
  .icon,
  .send {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 50%;
    color: var(--pawbar-icon, color-mix(in oklab, var(--pawbar-fg, #1c1c21) 62%, transparent));
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      box-shadow 0.15s ease,
      transform 0.1s ease;
  }
  .icon {
    width: 30px;
    height: 30px;
    background: transparent;
    cursor: pointer;
  }
  .icon:hover,
  .icon[aria-expanded='true'] {
    color: var(--pawbar-icon-hover, var(--pawbar-fg, #1c1c21));
    background: var(--pawbar-control-hover, color-mix(in oklab, var(--pawbar-fg, #1c1c21) 10%, transparent));
  }
  .send {
    width: 34px;
    height: 34px;
    background: var(--pawbar-control, color-mix(in oklab, var(--pawbar-fg, #1c1c21) 9%, transparent));
    cursor: default;
  }
  /* Idle is quiet but legible: the arrow keeps the icon colour at reduced
     strength rather than fading the whole button with opacity. */
  .send:disabled {
    color: var(--pawbar-icon-disabled, color-mix(in oklab, var(--pawbar-fg, #1c1c21) 38%, transparent));
  }
  /* Stop: a strong neutral control from the card's own ink, never the accent,
     so it reads as "halt" rather than "go" in every theme. */
  .send.stop {
    background: var(--pawbar-control-strong, color-mix(in oklab, var(--pawbar-fg, #1c1c21) 14%, transparent));
    color: var(--pawbar-fg, #1c1c21);
    cursor: pointer;
  }
  .send.stop:hover {
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--pawbar-fg, #1c1c21) 16%, transparent);
  }
  .stop-glyph {
    width: 10px;
    height: 10px;
    border-radius: min(var(--pawbar-radius, 2.5px), 2.5px);
    background: currentColor;
  }
  .send[aria-disabled='true'] {
    color: var(--pawbar-icon-disabled, color-mix(in oklab, var(--pawbar-fg, #1c1c21) 38%, transparent));
    cursor: not-allowed;
  }
  .send.ready {
    background: var(--pawbar-accent, #111114);
    color: var(--pawbar-accent-fg, #fff);
    cursor: pointer;
  }
  .icon:active,
  .launch:active,
  .send.ready:active,
  .chip:active {
    transform: scale(0.94);
  }
  .trigger:focus-visible,
  .launch:focus-visible,
  .icon:focus-visible,
  .chip:focus-visible,
  .send:focus-visible,
  .menu-item:focus-visible {
    outline: 2px solid var(--pawbar-ring, var(--pawbar-accent, #111114));
    outline-offset: 2px;
  }

  /* ── Size menu ────────────────────────────────────────────────────────────
     Opens ABOVE the surface (the bar lives at the bottom of the page), on the
     same side as the ⋯ that opened it. Outside .pawbar, which clips. */
  .menu {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    min-width: 150px;
    padding: 5px;
    box-sizing: border-box;
    font-family: var(--pawbar-font, inherit);
    color: var(--pawbar-fg, #1c1c21);
    background: var(--pawbar-menu-bg, var(--pawbar-bg, rgb(255 255 255 / 0.9)));
    border: 1px solid var(--pawbar-border, rgb(255 255 255 / 0.65));
    border-radius: min(var(--pawbar-radius, 22px), 14px);
    -webkit-backdrop-filter: blur(var(--pawbar-blur, 18px)) saturate(1.4);
    backdrop-filter: blur(var(--pawbar-blur, 18px)) saturate(1.4);
  }
  [data-anchor='left'] .menu {
    right: auto;
    left: 0;
  }
  .menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    border: none;
    border-radius: min(var(--pawbar-radius, 22px), 9px);
    background: none;
    color: inherit;
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .menu-item:hover {
    background: var(--pawbar-control-hover, color-mix(in oklab, var(--pawbar-fg, #1c1c21) 10%, transparent));
  }
  .menu-item[aria-checked='true'] {
    font-weight: 600;
  }
  .menu-label {
    padding: 6px 10px 2px;
    font-size: 11px;
    letter-spacing: 0.02em;
    color: var(--pawbar-muted, color-mix(in oklab, currentColor 55%, transparent));
  }

  @media (prefers-reduced-motion: reduce) {
    .icon,
    .send,
    .chip {
      transition: none;
    }
    .icon:active,
    .launch:active,
    .send.ready:active,
    .chip:active {
      transform: none;
    }
  }
</style>
