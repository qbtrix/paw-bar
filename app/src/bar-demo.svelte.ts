// bar-demo.svelte.ts — dev harness for bar.html (2026-09-27). Mounts one
// PawBarFrame and drives its launcher / side / size / theme from the control
// strip, plus the owner's corner radius slider.
// Messages use the chat store's shape (content + status), same as production.
// A fake reply streams in word by word so the thread's growth can be watched.
// DEMO_LOGO stands in for a site's brand logo; it is inlined rather than put in
// public/, which Vite would copy into the production bundle. Suggestions are
// off for now (captain, 2026-09-27); pass `suggestions` to bring the chips back.
// 2026-09-27 (states): the fake reply honours "Next reply" (sources, slow,
// fails midway, fails empty), Stop cancels it and marks it stopped, Retry
// replays the question, and buttons drive a team takeover, a reply that
// lands while the bar is closed, a restore, and a reset.
// Failures are faked the way ChatStore reports them (a `failure` on the turn,
// the one `notice`, `cooldownUntil`, `unavailable`), from the same "Next
// reply" picker: not sent, rate limited, rejected, offline, unavailable.
// "Talk to a person" answers after a second, as the real endpoint would.
// 2026-09-27 (section E): "Next reply" can also stream a markdown reply, a
// form card, one product, and a 4- or 12-product catalog (inline raster
// images drawn on a canvas, one broken, one without a price, one sold out).
// The cards act through DemoCart / DemoContact: the real stores with only the
// network calls replaced, so the frame, the cards and the E1 prompt run their
// real code. A form submit parks a "pending decision", which is what makes the
// next finished reply offer the email prompt, as the real backend would.
// 2026-09-27 (sessions + compliance): conversations live in memory, keyed by a
// fake id, so "New conversation" and the list work; the thread and that list
// are kept in sessionStorage so a reload shows the continue pill (the bar's
// own state is persisted by the frame under `persistKey`). "Seed history"
// adds three older conversations; "Ask consent" puts the bar behind the
// consent step until Accept. The disclosure links a fake privacy policy.
// The Background control paints the stand-in host page (gradient or any
// colour, kept in localStorage) and sets the bar's scheme from its brightness,
// the way lib/scheme.ts resolves it from a real host.
import { mount, untrack } from 'svelte';
import PawBarFrame, { type BarMessage } from './components/bar/PawBarFrame.svelte';
import { SIZE_KEY, type BarLauncher, type BarSide, type BarSize } from './components/bar/PawBar.svelte';
import { BAR_THEMES, BAR_THEME_IDS, type BarScheme } from './lib/bar-themes';
import { CONTACT_OFFER, FAILURE_COPY } from './lib/chat-errors';
import type { Notice } from './store/chat.svelte';
import { CartStore } from './store/cart.svelte';
import { ContactStore } from './store/contact.svelte';

const DEMO_LOGO =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#ff5a36"/><path d="M9 22V10h7.5a4.5 4.5 0 0 1 0 9H13v3z" fill="white"/></svg>',
  );

const REPLY =
  "My job was the difference between functional and alive. I rebuilt the bar from the structure up, then spent most of the time on the parts you don't notice: easing that has weight, states that hand off instead of cutting, a thinking moment that actually feels like thinking.\nSoftware can work perfectly and still feel dead. That gap is the job.";
const SOURCES = [
  { title: 'Shipping and delivery', url: 'https://example.com/shipping' },
  { title: 'Returns within 30 days', url: 'https://example.com/returns' },
];

// ── Section E fakes ─────────────────────────────────────────────────────────
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
let decisionPending = false;
let contactDismissed = false;

class DemoCart extends CartStore {
  constructor() {
    super({ endpoint: '', widgetId: 'demo', siteKey: '' });
    this.cart = { items: [], total_cents: 0, currency: 'USD', checkout_url: 'https://example.com/checkout' };
  }
  override async runAction(verb: string, args: Record<string, unknown>, pendingKey?: string): Promise<boolean> {
    this.error = null;
    this.pending = pendingKey ?? verb;
    await wait(900);
    this.pending = null;
    if (verb === 'add_to_cart' && args.product_id === 'p-sold') {
      this.error = 'That one just sold out.';
      return false;
    }
    if (verb === 'add_to_cart' && this.cart) {
      this.cart = { ...this.cart, items: [...this.cart.items, { product_id: String(args.product_id), qty: 1 }] };
    } else if (verb !== 'checkout') decisionPending = true;
    return true;
  }
}

class DemoContact extends ContactStore {
  constructor() {
    super({ endpoint: '', widgetId: 'demo', siteKey: '' });
  }
  override async maybeOffer() {
    if (this.status === 'hidden' && decisionPending && !contactDismissed) this.status = 'offer';
  }
  override async submit(email: string) {
    if (this.status !== 'offer' || this.isSubmitting) return;
    this.isSubmitting = true;
    await wait(600);
    this.isSubmitting = false;
    this.emailError = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
    if (!this.emailError) this.status = 'sent';
  }
  override dismiss() {
    contactDismissed = true;
    super.dismiss();
  }
}

const cart = new DemoCart();
const contact = new DemoContact();

// Product art: rasters drawn here, because the cards (rightly) refuse SVG and
// the demo must not reach an external host.
function art(hue: number): string {
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = 180;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 240, 180);
  grad.addColorStop(0, `hsl(${hue} 70% 62%)`);
  grad.addColorStop(1, `hsl(${(hue + 40) % 360} 60% 38%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 240, 180);
  g.fillStyle = `hsl(${hue} 80% 88% / 0.85)`;
  g.beginPath();
  g.arc(150, 96, 46, 0, Math.PI * 2);
  g.fill();
  return c.toDataURL('image/png');
}
const NAMES = [
  'Linen overshirt', 'Everyday tote', 'Ceramic pour-over set', 'Merino beanie', 'Walnut desk tray',
  'Canvas sneakers, low', 'Stoneware mug (set of two)', 'Wool throw blanket', 'Brass bottle opener',
  'Recycled notebook', 'Travel candle', 'Leather key loop',
];
function products(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i === 2 ? 'p-sold' : `p${i}`,
    name: NAMES[i % NAMES.length],
    // One without a price, one with an image that fails to decode.
    price_cents: i === 1 ? undefined : 1800 + i * 650,
    currency: 'USD',
    image_url: i === 3 ? 'data:image/png;base64,bm90LWFuLWltYWdl' : art((i * 47) % 360),
    actions: ['add_to_cart'],
  }));
}
const fence = (card: unknown) => '```pawbar-card\n' + JSON.stringify(card) + '\n```';

const REPLIES: Record<string, () => string> = {
  markdown: () =>
    "Here's what the **Studio** plan includes:\n\n- Unlimited pages and edits\n- A custom domain, **set up for you**\n- Priority support, usually within `2h`\n\nThe full comparison is on the [pricing page](https://example.com/pricing). Want me to put it next to **Basic**?",
  form: () =>
    'Sure, I can book that. Fill this in:\n\n' +
    fence({
      kind: 'form',
      verb: 'book_visit',
      title: 'Book a studio visit',
      submit_label: 'Send',
      fields: [
        { name: 'name', label: 'Name', type: 'text' },
        { name: 'email', label: 'Email', type: 'email' },
      ],
    }),
  product: () =>
    'This one fits what you described:\n\n' +
    fence({
      kind: 'product',
      items: [
        {
          id: 'p-one',
          name: 'Linen overshirt',
          price_cents: 6800,
          currency: 'USD',
          description: 'Washed Belgian linen, relaxed fit. Ships in 2 to 3 days.',
          image_url: art(28),
          actions: ['add_to_cart', 'checkout'],
        },
      ],
    }),
  catalog4: () => 'A few picks from the shop:\n\n' + fence({ kind: 'product', items: products(4) }),
  catalog12: () => "Here's everything in the new collection:\n\n" + fence({ kind: 'product', items: products(12) }),
};

const stage = document.getElementById('stage')!;
const form = document.getElementById('controls') as HTMLFormElement;
const nextSelect = document.getElementById('next') as HTMLSelectElement;

let seq = Date.now() % 100000;
const id = (p: string) => `${p}${++seq}`;

// ── Fake conversations ──────────────────────────────────────────────────────
type Conv = { id: string; state: string; preview: string; lastMessageAt: string; active: boolean };
const DEMO_STORE = 'pawbar-demo-thread';
const saved = (() => {
  try {
    return JSON.parse(sessionStorage.getItem(DEMO_STORE) ?? 'null') as {
      id: string;
      threads: Record<string, BarMessage[]>;
      list: Conv[];
    } | null;
  } catch {
    return null;
  }
})();
const threads: Record<string, BarMessage[]> = saved?.threads ?? {};
const firstId = saved?.id ?? id('c');
let timer: ReturnType<typeof setTimeout> | undefined;

const props = $state({
  messages: (threads[firstId] ?? []) as BarMessage[],
  conversationId: firstId,
  conversations: (saved?.list ?? []) as Conv[],
  persistKey: 'demo',
  privacyHref: '#privacy',
  consent: 'granted' as 'granted' | 'required',
  onconsent(granted: boolean) {
    if (granted) props.consent = 'granted';
  },
  onnewconversation() {
    stash();
    props.conversationId = id('c');
    props.messages = [];
    props.notice = null;
    props.botPaused = false;
    props.handoff = 'none';
    syncList();
  },
  onopenconversation(cid: string) {
    stash();
    props.conversationId = cid;
    props.messages = threads[cid] ?? [
      { id: id('u'), role: 'user', content: props.conversations.find((c) => c.id === cid)?.preview ?? 'Hello', status: 'done' },
      { id: id('a'), role: 'assistant', content: 'This is an older conversation, loaded from the list.', status: 'done' },
    ];
    syncList();
  },
  logoSrc: DEMO_LOGO,
  agentName: 'Acme Concierge',
  launcher: 'bar' as BarLauncher,
  side: 'right' as BarSide,
  size: 'sm' as BarSize,
  theme: 'midnight',
  scheme: 'dark' as BarScheme,
  radius: undefined as number | undefined,
  restoring: false,
  notice: null as Notice | null,
  cooldownUntil: null as number | null,
  unavailable: null as { contactable: boolean } | null,
  handoff: 'none' as 'none' | 'pending',
  botPaused: false,
  expanded: false,
  cart: cart as CartStore,
  contact: contact as ContactStore,
  onsend(text: string) {
    const kind = nextSelect.value;
    props.notice = null;
    if (kind === 'rejected') {
      props.notice = { kind: 'rejected', text: FAILURE_COPY.rejected.line! };
      return { ok: false as const, restoreDraft: text };
    }
    if (kind === 'offline') {
      props.messages.push({ id: id('u'), role: 'user', content: text, status: 'queued' });
      props.notice = { kind: 'offline', text: FAILURE_COPY.offline.line! };
      return;
    }
    if (kind === 'unsent' || kind === 'rate' || kind === 'unavailable') {
      const failure = kind === 'unsent' ? 'unreachable' : kind === 'rate' ? 'rate_limited' : 'unavailable';
      props.messages.push({ id: id('u'), role: 'user', content: text, status: 'error', failure });
      if (kind === 'rate') {
        props.cooldownUntil = Date.now() + 30_000;
        props.notice = { kind: 'cooldown', text: '' };
      }
      if (kind === 'unavailable') {
        props.unavailable = { contactable: true };
        props.notice = { kind: 'unavailable', text: `${FAILURE_COPY.unavailable.line} ${CONTACT_OFFER}`, action: 'contact' };
      }
      return;
    }
    props.messages.push({ id: id('u'), role: 'user', content: text, status: 'done' });
    reply();
  },
  onstop() {
    clearTimeout(timer);
    const m = [...props.messages].reverse().find((x) => x.status === 'streaming');
    if (!m) return;
    if (m.content) {
      m.status = 'done';
      m.stopped = true;
    } else props.messages.splice(props.messages.indexOf(m), 1);
  },
  onretry(failedId: string) {
    const i = props.messages.findIndex((m) => m.id === failedId);
    if (i < 0) return;
    const m = props.messages[i];
    if (m.role === 'user') {
      m.status = 'done';
      m.failure = undefined;
    } else props.messages.splice(i, 1);
    reply('normal');
  },
  async onrequesthuman(req: { message: string; contact: string }) {
    await new Promise((done) => setTimeout(done, 1000));
    if (req.message) props.messages.push({ id: id('u'), role: 'user', content: req.message, status: 'done' });
    props.messages.push({ id: id('s'), role: 'system', content: 'Someone from the team has been notified and will pick this up.', status: 'done' });
    props.handoff = 'pending';
    props.notice = { kind: 'waiting', text: 'Waiting for someone from the team. You can keep chatting meanwhile.' };
    return { ok: true as const };
  },
});

function reply(kind = nextSelect.value) {
  if (props.botPaused) return;
  props.messages.push({ id: id('a'), role: 'assistant', content: '', status: 'streaming' });
  const m = props.messages[props.messages.length - 1];
  const words = (REPLIES[kind]?.() ?? REPLY).split(' ');
  let i = 0;
  const stream = () => {
    if (kind === 'fail' && i === 18) {
      m.status = 'error';
      return;
    }
    m.content = words.slice(0, ++i).join(' ');
    if (i < words.length) timer = setTimeout(stream, 35);
    else {
      m.status = 'done';
      if (kind === 'sources') m.sources = SOURCES;
    }
  };
  if (kind === 'empty') timer = setTimeout(() => (m.status = 'error'), 1200);
  else timer = setTimeout(stream, kind === 'slow' ? 10_000 : 900);
}

// Keeps the fake list in step with the thread, and both in sessionStorage.
function stash() {
  threads[props.conversationId] = $state.snapshot(props.messages).filter((m) => m.status === 'done');
}
function syncList() {
  const first = props.messages.find((m) => m.role === 'user')?.content ?? '';
  const others = untrack(() => props.conversations).filter((c) => c.id !== props.conversationId).map((c) => ({ ...c, active: false }));
  const mine = { id: props.conversationId, state: 'open', preview: first, lastMessageAt: new Date().toISOString(), active: true };
  props.conversations = first || others.length ? [mine, ...others] : [];
}
$effect.root(() => {
  $effect(() => {
    void props.messages.length;
    void props.messages[props.messages.length - 1]?.status;
    stash();
    syncList();
    try {
      sessionStorage.setItem(DEMO_STORE, JSON.stringify({ id: props.conversationId, threads, list: untrack(() => $state.snapshot(props.conversations)) }));
    } catch {
      /* demo only */
    }
  });
});

const themeSelect = document.getElementById('theme') as HTMLSelectElement;
for (const tid of BAR_THEME_IDS) {
  const t = BAR_THEMES[tid];
  themeSelect.add(new Option(t.inspiredBy ? `${t.label} (${t.inspiredBy}-style)` : t.label, tid, false, tid === props.theme));
}

// ── Host background ─────────────────────────────────────────────────────────
const BG_KEY = 'pawbar-demo-bg';
const bgSelect = document.getElementById('bg') as HTMLSelectElement;
const bgColor = document.getElementById('bg-color') as HTMLInputElement;
// Relative luminance of a #rrggbb colour, 0 (black) to 1 (white).
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function setBackground(value: string) {
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : null;
  if (color) document.body.style.setProperty('--demo-bg', color);
  else document.body.style.removeProperty('--demo-bg');
  // The gradient is dark; a colour is light past mid-grey.
  props.scheme = color && luminance(color) > 0.4 ? 'light' : 'dark';
  bgSelect.value = !color ? 'gradient' : [...bgSelect.options].some((o) => o.value === color) ? color : 'custom';
  if (color) bgColor.value = color;
  localStorage.setItem(BG_KEY, color ?? 'gradient');
}
setBackground(localStorage.getItem(BG_KEY) ?? 'gradient');

let live = mount(PawBarFrame, { target: stage, props });

form.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.name === 'launcher') {
    props.launcher = input.value === 'bar' ? 'bar' : 'icon';
    props.side = input.value === 'icon-left' ? 'left' : 'right';
    stage.dataset.anchor = props.launcher === 'bar' ? 'center' : props.side;
  } else if (input.name === 'size') {
    // The visitor's own pick wins over the site default, so clear it and
    // remount — otherwise this radio would look like it does nothing.
    localStorage.removeItem(SIZE_KEY);
    props.size = input.value as BarSize;
    void import('svelte').then(({ unmount }) => {
      void unmount(live);
      live = mount(PawBarFrame, { target: stage, props });
    });
  } else if (input.name === 'theme') {
    props.theme = input.value;
  } else if (input.name === 'bg') {
    setBackground(input.value === 'custom' ? bgColor.value : input.value);
  }
});
form.addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.name === 'bgcolor') return setBackground(input.value);
  if (input.name !== 'radius') return;
  props.radius = Number(input.value);
  document.getElementById('radius-out')!.textContent = `${input.value}px`;
});
form.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).dataset.act;
  if (act === 'team') {
    props.botPaused = true;
    props.handoff = 'none';
    props.notice = { kind: 'takeover', text: "You're chatting with the team" };
    props.messages.push({ id: id('s'), role: 'system', content: 'A member of the team joined the conversation', status: 'done' });
    setTimeout(() => {
      props.messages.push({ id: id('o'), role: 'owner', content: "Hi, I'm Maya from the team. What's your order number?", status: 'done' });
    }, 600);
  } else if (act === 'closed') {
    // Fold the bar, then a reply streams in behind it.
    props.expanded = false;
    (document.activeElement as HTMLElement | null)?.blur();
    props.messages.push({ id: id('u'), role: 'user', content: 'Do you ship to Oslo?', status: 'done' });
    reply('normal');
  } else if (act === 'restore') {
    props.messages = [];
    props.restoring = true;
    setTimeout(() => {
      props.messages = [
        { id: id('u'), role: 'user', content: 'Do you ship to Oslo?', status: 'done' },
        { id: id('a'), role: 'assistant', content: 'Yes. Orders to Norway ship in 3 to 5 days.', status: 'done', sources: SOURCES },
      ];
      props.restoring = false;
    }, 1500);
  } else if (act === 'history') {
    const day = 86_400_000;
    const old: Conv[] = [
      { id: id('c'), state: 'needs_human', preview: 'Can I change the delivery address on my order?', lastMessageAt: new Date(Date.now() - 3 * 3600_000).toISOString(), active: false },
      { id: id('c'), state: 'open', preview: 'Gift ideas under $50', lastMessageAt: new Date(Date.now() - 2 * day).toISOString(), active: false },
      { id: id('c'), state: 'closed', preview: 'Does the linen shirt run small?', lastMessageAt: new Date(Date.now() - 9 * day).toISOString(), active: false },
    ];
    props.conversations = [...props.conversations, ...old];
  } else if (act === 'consent') {
    props.consent = 'required';
  } else if (act === 'reset') {
    clearTimeout(timer);
    props.messages = [];
    props.botPaused = false;
    props.restoring = false;
    props.notice = null;
    props.cooldownUntil = null;
    props.unavailable = null;
    props.handoff = 'none';
    if (cart.cart) cart.cart = { ...cart.cart, items: [] };
    contact.status = 'hidden';
    decisionPending = false;
    contactDismissed = false;
    props.consent = 'granted';
    props.conversations = [];
    for (const k of Object.keys(threads)) delete threads[k];
    try {
      sessionStorage.clear();
    } catch {
      /* demo only */
    }
  }
});
