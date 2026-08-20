<!-- HelpTab.svelte — search across the site's own synced pages.
     Created 2026-08-19 (Messenger). Reads the existing GET /paw-bar/articles,
     which the panel already used behind a "Browse articles" menu item; giving
     it a tab is most of what makes it findable.

     Filtering is CLIENT-side against the already-fetched list, deliberately.
     The endpoint returns at most 20 rows, so a query per keystroke would be a
     round trip to re-sort twenty items the widget is already holding — slower,
     and it would turn a working offline-ish surface into one that needs the
     network to filter what is already on screen.

     The no-results state offers to ask instead. A visitor who searched and
     found nothing has told us exactly what they want, and a dead end is the
     one thing a support surface may not give them. -->
<script lang="ts">
  import Icon from '../Icon.svelte';
  import type { Article } from '../../lib/articles-client';

  let {
    articles,
    loading,
    onarticle,
    onask,
  }: {
    articles: Article[];
    loading: boolean;
    onarticle: (article: Article) => void;
    onask: (seed?: string) => void;
  } = $props();

  let query = $state('');

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return articles;
    return articles.filter(
      (a) => a.title.toLowerCase().includes(q) || a.snippet.toLowerCase().includes(q),
    );
  });
</script>

<div class="help">
  <div class="search-well">
    <label class="search">
      <span class="search-icon" aria-hidden="true"><Icon name="search" /></span>
      <input
        type="search"
        bind:value={query}
        placeholder="Search for help"
        aria-label="Search help articles"
        autocomplete="off"
        spellcheck="false"
      />
    </label>
  </div>

  <div class="scroll">
    {#if loading}
      <ul class="list" aria-busy="true" aria-label="Loading articles">
        {#each [0, 1, 2, 3] as row (row)}
          <li class="skeleton-row">
            <span class="skeleton line short"></span>
            <span class="skeleton line"></span>
          </li>
        {/each}
      </ul>
    {:else if articles.length === 0}
      <div class="empty">
        <p class="empty-title">Nothing published yet</p>
        <p class="empty-copy">Ask us instead — someone will get back to you.</p>
        <button type="button" class="empty-action" onclick={() => onask()}>Ask a question</button>
      </div>
    {:else if results.length === 0}
      <div class="empty">
        <p class="empty-title">No results for &ldquo;{query.trim()}&rdquo;</p>
        <p class="empty-copy">We can answer it directly instead.</p>
        <button type="button" class="empty-action" onclick={() => onask(query.trim())}>
          Ask about this
        </button>
      </div>
    {:else}
      <ul class="list">
        {#each results as article (article.url)}
          <li>
            <button type="button" class="row" onclick={() => onarticle(article)}>
              <span class="row-title">{article.title}</span>
              {#if article.snippet}
                <span class="row-snippet">{article.snippet}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .help {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .search-well {
    flex: none;
    padding: 14px 14px 10px;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 12px;
    border: 1px solid var(--pawbar-border);
    border-radius: var(--pawbar-radius-sm);
    background: var(--pawbar-wash);
    transition: border-color var(--pawbar-duration-fast) var(--pawbar-ease);
  }

  .search:focus-within {
    border-color: var(--pawbar-ring);
  }

  .search-icon {
    color: var(--pawbar-fg-subtle);
    font-size: 17px;
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 11px 0;
    border: 0;
    background: transparent;
    color: var(--pawbar-fg);
    font: inherit;
    font-size: 13.5px;
  }

  input:focus {
    outline: none;
  }

  input::placeholder {
    color: var(--pawbar-fg-muted);
  }

  /* Safari draws its own clear button, which collides with the field's own
     border radius and stroke weight. */
  input::-webkit-search-cancel-button {
    -webkit-appearance: none;
    appearance: none;
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 8px 12px;
  }

  .list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 12px;
    border: 0;
    border-radius: var(--pawbar-radius-sm);
    background: transparent;
    color: var(--pawbar-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--pawbar-duration-fast) var(--pawbar-ease);
  }

  .row:hover {
    background: var(--pawbar-wash);
  }

  .row:focus-visible {
    outline: 2px solid var(--pawbar-ring);
    outline-offset: -2px;
  }

  .row-title {
    font-size: 13.5px;
    font-weight: 550;
    letter-spacing: -0.005em;
  }

  .row-snippet {
    font-size: 12px;
    line-height: 1.45;
    color: var(--pawbar-fg-subtle);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .empty {
    display: flex;
    /* Centred in the pane rather than pinned to its top: an empty state stranded
       under the header with a screen of nothing below it reads as a surface that
       failed to load, not as one with nothing in it yet. */
    min-height: 100%;
    justify-content: center;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    text-align: center;
    padding: 44px 28px;
  }

  .empty-title {
    margin: 0;
    font-size: 14.5px;
    font-weight: 600;
    /* Wraps rather than overflowing on a long query. */
    overflow-wrap: anywhere;
  }

  .empty-copy {
    margin: 0 0 6px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--pawbar-fg-muted);
    max-width: 30ch;
  }

  .empty-action {
    padding: 9px 16px;
    border: 0;
    border-radius: 999px;
    background: var(--pawbar-accent);
    color: var(--pawbar-accent-fg);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .empty-action:focus-visible {
    outline: 2px solid var(--pawbar-ring);
    outline-offset: 3px;
  }

  .skeleton-row {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 12px;
  }

  .skeleton {
    display: block;
    background: var(--pawbar-wash-strong);
    border-radius: 6px;
    animation: pulse 1.6s var(--pawbar-ease) infinite;
  }

  .line {
    height: 9px;
  }

  .line.short {
    width: 44%;
  }

  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
    }
  }
</style>
