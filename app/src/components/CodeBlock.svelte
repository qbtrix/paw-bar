<!--
  CodeBlock.svelte — Plain code fence with a copy button. Created 2026-07-15
  (A3 glass bar). v1 is deliberately unhighlighted (no hljs/mermaid, per the
  extraction cut) — textContent-only render, so agent code can never inject
  markup. The ONLY innerHTML anywhere in this app is the DOMPurify-sanitized
  markdown; this component uses a text binding.
-->
<script lang="ts">
  let { code, lang = '' }: { code: string; lang?: string } = $props();
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      setTimeout(() => (copied = false), 1400);
    } catch {
      /* clipboard blocked (insecure ctx / denied) — leave the button idle */
    }
  }
</script>

<div class="code">
  <div class="bar">
    <span class="lang">{lang || 'code'}</span>
    <button type="button" class="copy" onclick={copy} aria-label="Copy code">
      {copied ? 'Copied' : 'Copy'}
    </button>
  </div>
  <pre><code>{code}</code></pre>
</div>

<style>
  .code {
    margin: 0.5em 0;
    border: 1px solid var(--pawbar-border);
    border-radius: var(--pawbar-radius-sm);
    overflow: hidden;
    background: color-mix(in oklab, var(--pawbar-fg) 4%, transparent);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-bottom: 1px solid var(--pawbar-border);
  }
  .lang {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--pawbar-fg-muted);
  }
  .copy {
    font: inherit;
    font-size: 11px;
    color: var(--pawbar-fg-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--pawbar-radius-2xs);
  }
  .copy:hover {
    color: var(--pawbar-fg);
    background: color-mix(in oklab, var(--pawbar-fg) 8%, transparent);
  }
  pre {
    margin: 0;
    padding: 12px 14px;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.5;
  }
</style>
