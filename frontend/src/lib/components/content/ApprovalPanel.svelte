<script lang="ts">
  import { Button, SearchInput, SegmentedControl } from "@kenn-io/kit-ui";
  import { m, getLocale } from "../../i18n/index.js";
  import { loadApprovals } from "../../api/approvals.js";
  import { filterApprovals, type ApprovalRecord } from "../../utils/approvals.js";
  import { router } from "../../stores/router.svelte.js";
  import { sync } from "../../stores/sync.svelte.js";
  import { ui } from "../../stores/ui.svelte.js";

  let { sessionId, fullPage = false }: { sessionId?: string; fullPage?: boolean } = $props();
  let opened = $state(false);
  let revision = $state(0);
  let loading = $state(false);
  let failed = $state(false);
  let failedCount = $state(0);
  let records = $state<ApprovalRecord[]>([]);
  let query = $state("");
  let outcome = $state("all");
  let visibleLimit = $state(50);
  const expanded = $derived(fullPage || opened);
  const filtered = $derived(filterApprovals(records, outcome, query));
  const visible = $derived(filtered.slice(0, visibleLimit));
  const options = $derived([
    { value: "all", label: m.approvals_all() },
    { value: "allow", label: m.approvals_allow(), tone: "success" as const },
    { value: "deny", label: m.approvals_deny(), tone: "danger" as const },
    { value: "unknown", label: m.approvals_unknown() },
  ]);

  $effect(() => {
    const id = sessionId;
    void revision;
    void sync.lastSync;
    records = [];
    failed = false;
    failedCount = 0;
    loading = false;
    if (!expanded) return;
    const controller = new AbortController();
    loading = true;
    void loadApprovals(controller.signal, id).then((result) => {
      if (controller.signal.aborted) return;
      records = result.records;
      failedCount = result.failedSessions.length;
    }).catch(() => {
      if (!controller.signal.aborted) failed = true;
    }).finally(() => {
      if (!controller.signal.aborted) loading = false;
    });
    return () => controller.abort();
  });

  function label(value: ApprovalRecord["outcome"]): string {
    return value === "allow" ? m.approvals_allow() : value === "deny" ? m.approvals_deny() : m.approvals_unknown();
  }

  function date(value: string): string {
    if (!value) return m.approvals_missing();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(getLocale());
  }

  function openReview(record: ApprovalRecord): void {
    ui.scrollToOrdinal(record.ordinal, record.session.id);
    router.navigateToSession(record.session.id);
  }
</script>

<section class="approvals" class:full-page={fullPage} aria-label={m.approvals_title()}>
  <div class="heading">
    {#if fullPage}
      <h2>{m.approvals_title()}</h2>
    {:else}
      <Button size="sm" ariaExpanded={expanded} onclick={() => opened = !opened}>
        {m.approvals_title()}
      </Button>
    {/if}
    {#if expanded}
      <span class="count" aria-live="polite">{m.approvals_count({ count: records.length })}</span>
      <Button size="sm" disabled={loading} onclick={() => revision++}>{m.shared_refresh()}</Button>
    {/if}
    {#if !fullPage}
      <Button size="sm" onclick={() => router.navigate("approvals")}>{m.approvals_view_all()}</Button>
    {/if}
  </div>

  {#if expanded}
    <div class="panel-body">
      <p class="scope-note">{m.approvals_scope()}</p>
      <div class="filters">
        <SegmentedControl {options} value={outcome} ariaLabel={m.approvals_filter()}
          onchange={(value) => { outcome = value; visibleLimit = 50; }} />
        <SearchInput bind:value={query} placeholder={m.approvals_search()} ariaLabel={m.approvals_search()}
          clearLabel={m.approvals_clear_search()} oninput={() => visibleLimit = 50} />
      </div>
      {#if loading}
        <p role="status">{m.approvals_loading()}</p>
      {:else if failed}
        <p role="alert">{m.approvals_error()}</p>
      {:else}
        {#if failedCount}
          <p role="alert">{m.approvals_partial({ count: failedCount })}</p>
        {/if}
        {#if records.length === 0}
          <p class="empty">{m.approvals_empty()}</p>
        {:else if filtered.length === 0}
          <p class="empty">{m.approvals_no_matches()}</p>
        {/if}
        <div class="records">
          {#each visible as record (record.id)}
            <article class="record" class:denied={record.outcome === "deny"}>
              <div class="record-heading">
                <span class="outcome" class:allow={record.outcome === "allow"} class:deny={record.outcome === "deny"}>
                  {label(record.outcome)}
                </span>
                <time datetime={record.timestamp}>{date(record.timestamp)}</time>
                <span class="project">{record.session.project}</span>
              </div>
              <pre class="operation">{record.operation || m.approvals_missing_action()}</pre>
              <dl>
                <div><dt>{m.approvals_risk()}</dt><dd>{record.risk || m.approvals_missing()}</dd></div>
                <div><dt>{m.approvals_authorization()}</dt><dd>{record.authorization || m.approvals_missing()}</dd></div>
              </dl>
              <p class="rationale">{record.rationale || m.approvals_missing_reason()}</p>
              {#if record.justification}
                <p class="justification"><strong>{m.approvals_justification()}</strong> {record.justification}</p>
              {/if}
              <div class="links">
                {#if record.session.parent_session_id}
                  <Button size="sm" onclick={() => router.navigateToSession(record.session.parent_session_id!)}>{m.approvals_parent()}</Button>
                {/if}
                <Button size="sm" onclick={() => openReview(record)}>{m.approvals_open_review()}</Button>
              </div>
              <details>
                <summary>{m.approvals_raw()}</summary>
                <h3>{m.approvals_request()}</h3>
                <pre>{record.request || m.approvals_missing()}</pre>
                <h3>{m.approvals_response()}</h3>
                <pre>{record.response || m.approvals_missing()}</pre>
              </details>
            </article>
          {/each}
        </div>
        {#if visible.length < filtered.length}
          <Button onclick={() => visibleLimit += 50}>{m.approvals_more()}</Button>
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  .approvals { flex-shrink: 0; min-width: 0; border-bottom: 1px solid var(--border-muted); }
  .heading { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 10px 16px; }
  h2 { font-size: 18px; margin: 0; }
  .count, .scope-note, time, .project, dt, .justification { color: var(--text-secondary); }
  .count { margin-right: auto; font-size: 12px; }
  .panel-body { max-height: 45vh; overflow: auto; padding: 0 16px 16px; }
  .full-page { max-width: 1100px; margin: 0 auto; padding: 16px; border: 0; }
  .full-page .panel-body { max-height: none; overflow: visible; }
  .scope-note { font-size: 12px; line-height: 1.6; margin: 4px 0 16px; }
  .filters { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
  .records { display: grid; gap: 12px; margin-bottom: 12px; }
  .record { min-width: 0; padding: 14px; border: 1px solid var(--border-muted); border-radius: 8px; background: var(--bg-secondary); }
  .record.denied { border-left: 3px solid var(--accent-red); }
  .record-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 12px; }
  .project { margin-left: auto; overflow-wrap: anywhere; }
  .outcome { font-weight: 600; color: var(--text-secondary); }
  .outcome.allow { color: var(--accent-green); }
  .outcome.deny { color: var(--accent-red); }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.6 var(--font-mono); max-height: 360px; overflow: auto; }
  .operation { max-height: 120px; padding: 10px; background: var(--bg-primary); border-radius: 4px; }
  dl { display: flex; gap: 24px; flex-wrap: wrap; margin: 8px 0; font-size: 12px; }
  dl > div { display: flex; gap: 8px; }
  dd { margin: 0; }
  .rationale, .justification { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.6; }
  .links { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
  details { border-top: 1px solid var(--border-muted); padding-top: 10px; }
  summary { cursor: pointer; font-size: 12px; color: var(--text-secondary); }
  h3 { font-size: 12px; margin: 12px 0 4px; }
  .empty { padding: 16px 0; color: var(--text-secondary); }
  @media (max-width: 640px) { .full-page { padding: 0; } .record { padding: 10px; } }
</style>
