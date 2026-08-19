<!-- HomeTab.svelte — the panel's opening surface.
     Created 2026-08-19 (Messenger).

     The greeting is set in two weights on two lines ("Hello there." dim, "How
     can we help?" bright) rather than as one heading. That is the reference's
     move and it is doing real work: the first line is a courtesy the eye can
     skip and the second is the actual question, so the visitor's attention
     lands on the thing they have to answer.

     No eyebrow above it, and the cards below are deliberately NOT a row of
     equal tiles — the ask card is the primary action at full width, and
     articles are a list beneath it. Same-size cards would say these are peers,
     and they are not: one of them is why the visitor opened the bar.

     Operate mode, so the hero never grows past a third of the panel; the action
     is visible without scrolling at the shortest viewport the loader gives us. -->
<script lang="ts">
  import Icon from '../Icon.svelte';
  import type { Article } from '../../lib/articles-client';

  let {
    greeting,
    starters,
    articles,
    articlesLoading = false,
    avatars,
    onask,
    onarticle,
  }: {
    greeting: string;
    starters: string[];
    articles: Article[];
    /** Still fetching. Held as "assume content is coming", so the welcome
     *  layout is not adopted and then immediately abandoned. */
    articlesLoading?: boolean;
    avatars: string[];
    onask: (seed?: string) => void;
    onarticle: (article: Article) => void;
  } = $props();

  // Faces that 404 are dropped on sight. Held as a Set rather than by filtering
  // the prop, so a re-render from the parent cannot resurrect a URL we already
  // watched fail.
  let brokenAvatars = $state(new Set<string>());
  const shownAvatars = $derived(avatars.filter((a) => !brokenAvatars.has(a)).slice(0, 3));

  function onAvatarError(src: string) {
    brokenAvatars = new Set(brokenAvatars).add(src);
  }

  // A brand-new site has published nothing and its agent has no starters, so
  // below the ask card there is genuinely nothing to show. Rather than leave the
  // card floating above a screen of empty panel — which reads as content that
  // failed to load — the hero takes the room and the surface becomes a welcome
  // screen, which is what it actually is at that point.
  //
  // Gated on the fetch having FINISHED, and never animated. Both matter: the
  // articles arrive async, so computing this from an empty list mid-flight made
  // the hero collapse from 62% to 200px the moment they landed — sliding the ask
  // card up under the visitor's cursor after first paint. Animating min-height
  // to soften that only added layout thrash to a shift that should not happen at
  // all. Settling once, when the answer is actually known, is the fix.
  const hasBody = $derived(articlesLoading || starters.length > 0 || articles.length > 0);

  // The reference splits its greeting across two lines. An owner writes one
  // string, so the split is inferred: first sentence quiet, remainder loud. A
  // greeting with no sentence break renders whole in the loud voice rather than
  // being cut at an arbitrary width.
  const parts = $derived.by(() => {
    const text = (greeting || '').trim();
    if (!text) return { quiet: 'Hello there.', loud: 'How can we help?' };
    const match = text.match(/^(.+?[.!?])\s+(.+)$/s);
    if (!match) return { quiet: '', loud: text };
    return { quiet: match[1], loud: match[2] };
  });
</script>

<div class="home" class:sparse={!hasBody}>
  <header class="hero">
    <div class="hero-wash" aria-hidden="true"></div>
    <div class="hero-copy">
      <h1>
        {#if parts.quiet}<span class="quiet">{parts.quiet}</span>{/if}
        <span class="loud">{parts.loud}</span>
      </h1>
    </div>
  </header>

  <div class="body">
    <button type="button" class="ask" onclick={() => onask()}>
      <span class="ask-copy">
        <span class="ask-title">Ask a question</span>
        <span class="ask-sub">Our AI answers now, the team can step in</span>
      </span>
      {#if shownAvatars.length > 0}
        <span class="faces" aria-hidden="true">
          {#each shownAvatars as src, i (src + i)}
            <!-- Owner-supplied URLs. A face that fails to load REMOVES itself
                 rather than leaving a broken-image box on a customer's site;
                 if they all fail the arrow takes over, so the card is never
                 missing its right-hand end. -->
            <img
              class="face"
              {src}
              alt=""
              loading="lazy"
              decoding="async"
              onerror={() => onAvatarError(src)}
            />
          {/each}
        </span>
      {:else}
        <span class="ask-go" aria-hidden="true"><Icon name="send" /></span>
      {/if}
    </button>

    {#if starters.length > 0}
      <ul class="starters">
        <!-- Keyed by INDEX, not by the string. These are owner-typed prose,
             nothing dedupes them, and two identical starters is a typo in a
             settings field rather than an impossible state — but a repeated key
             is a render-time throw that takes the panel down. Index is the
             correct key for a fixed-order list of identical controls anyway. -->
        {#each starters.slice(0, 4) as starter, i (i)}
          <li>
            <button type="button" class="starter" onclick={() => onask(starter)}>
              {starter}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if articles.length > 0}
      <section class="reading">
        <h2>Answers people look for</h2>
        <ul>
          {#each articles.slice(0, 4) as article (article.url)}
            <li>
              <button type="button" class="article" onclick={() => onarticle(article)}>
                <span class="article-title">{article.title}</span>
                {#if article.snippet}
                  <span class="article-snippet">{article.snippet}</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</div>

<style>
  .home {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .home.sparse .hero {
    /* Enough to seat the greeting well above the card without pushing the
       primary action off a short viewport. */
    min-height: 62%;
  }

  .home.sparse h1 {
    font-size: 30px;
  }

  .hero {
    position: relative;
    flex: none;
    min-height: var(--pawbar-hero-height);
    display: flex;
    align-items: flex-end;
    padding: 20px 20px 26px;
    /* Owner artwork when set; the gradient is the floor underneath it, so a
       slow or missing image never leaves unreadable white-on-white. */
    background:
      var(--pawbar-hero-image, none) center / cover no-repeat,
      linear-gradient(160deg, var(--pawbar-hero-from), var(--pawbar-hero-to));
    color: var(--pawbar-hero-fg);
  }

  /* Keeps the greeting at contrast over ANY owner photograph. Without it the
     hero image is a coin flip on legibility, which is not a bet to take with a
     surface the owner can change after we ship. */
  .hero-wash {
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, oklch(0 0 0 / 0.55), oklch(0 0 0 / 0.05) 60%);
    pointer-events: none;
  }

  .hero-copy {
    position: relative;
  }

  h1 {
    margin: 0;
    font-size: 26px;
    line-height: 1.24;
    letter-spacing: -0.022em;
    font-weight: 600;
    text-wrap: balance;
  }

  .quiet,
  .loud {
    display: block;
  }

  .quiet {
    color: oklch(1 0 0 / 0.62);
    font-weight: 500;
  }

  .loud {
    color: var(--pawbar-hero-fg);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    /* Lifts the first card over the hero's lower edge, so the panel reads as
       one surface rather than a header stacked on a list. */
    margin-top: -18px;
    position: relative;
  }

  .ask {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 15px 16px;
    border: 1px solid var(--pawbar-border);
    border-radius: var(--pawbar-radius);
    background: var(--pawbar-surface-raised);
    box-shadow: var(--pawbar-shadow-sm);
    color: var(--pawbar-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      transform var(--pawbar-duration-fast) var(--pawbar-ease),
      border-color var(--pawbar-duration-fast) var(--pawbar-ease);
  }

  .ask:hover {
    border-color: oklch(1 0 0 / 0.22);
    transform: translateY(calc(-1px * var(--pawbar-motion-scale)));
  }

  .ask:focus-visible {
    outline: 2px solid var(--pawbar-ring);
    outline-offset: 2px;
  }

  .ask-copy {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }

  .ask-title {
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .ask-sub {
    font-size: 12.5px;
    color: var(--pawbar-fg-muted);
  }

  .ask-go {
    color: var(--pawbar-fg-muted);
    font-size: 18px;
    transform: rotate(90deg);
  }

  .faces {
    display: flex;
    flex: none;
  }

  .face {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid var(--pawbar-surface-raised);
  }

  .face + .face {
    margin-left: -10px;
  }

  .starters {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .starter {
    padding: 7px 12px;
    border: 1px solid var(--pawbar-border);
    border-radius: 999px;
    background: transparent;
    color: var(--pawbar-fg-muted);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
    transition:
      color var(--pawbar-duration-fast) var(--pawbar-ease),
      border-color var(--pawbar-duration-fast) var(--pawbar-ease);
  }

  .starter:hover {
    color: var(--pawbar-fg);
    border-color: oklch(1 0 0 / 0.24);
  }

  .starter:focus-visible {
    outline: 2px solid var(--pawbar-ring);
    outline-offset: 2px;
  }

  .reading h2 {
    margin: 4px 0 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--pawbar-fg-muted);
  }

  .reading ul {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--pawbar-border);
    border-radius: var(--pawbar-radius);
    overflow: hidden;
    background: oklch(1 0 0 / 0.03);
  }

  .reading li + li {
    border-top: 1px solid var(--pawbar-border);
  }

  .article {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 12px 14px;
    border: 0;
    background: transparent;
    color: var(--pawbar-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--pawbar-duration-fast) var(--pawbar-ease);
  }

  .article:hover {
    background: oklch(1 0 0 / 0.05);
  }

  .article:focus-visible {
    outline: 2px solid var(--pawbar-ring);
    outline-offset: -2px;
  }

  .article-title {
    font-size: 13.5px;
    font-weight: 550;
    letter-spacing: -0.005em;
  }

  .article-snippet {
    font-size: 12px;
    line-height: 1.45;
    color: var(--pawbar-fg-subtle);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
