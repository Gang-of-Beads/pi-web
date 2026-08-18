import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GoalRecordSummary, GoalTaskSummary } from "../api";
import {
  findCurrentTask,
  flattenGoalTasks,
  formatGoalTokens,
  goalProgressFraction,
  goalProgressLabel,
  goalStatusLabel,
  isGoalBlocked,
  isGoalFinished,
} from "../goalProgress";
import { listStyles } from "./shared";

/**
 * The goals recorded for the selected workspace, with per-task progress.
 *
 * Several goals can be open at once — sessions of a workspace share one
 * `.pi/goals/` directory — so this is a list, not a single card. Each goal
 * collapses to one row carrying its status and completion ratio; expanding it
 * reveals the task tree, the focused task, and each task's verification
 * contract.
 *
 * Read-only by design: the extension owns goal state, and a browser-side
 * mutation would race the agent that is working the goal.
 */
@customElement("goal-panel")
export class GoalPanel extends LitElement {
  @property({ attribute: false }) goals: GoalRecordSummary[] = [];
  @property({ type: Boolean }) loading = false;
  @property({ attribute: false }) onRefresh?: () => void | Promise<void>;

  /** Expanded goal ids. Collapsed by default so many goals stay scannable. */
  @state() private expanded = new Set<string>();

  override render(): TemplateResult {
    return html`
      <section>
        <h2>
          Goals
          <span class="section-count">${this.goals.length === 0 ? "" : String(this.goals.length)}</span>
          <button
            class="refresh-entry"
            type="button"
            title="Re-read goal records from the workspace"
            aria-label="Refresh goals"
            ?disabled=${this.loading}
            @click=${() => { void this.onRefresh?.(); }}
          >↻</button>
        </h2>
        ${this.goals.length === 0 ? this.renderEmpty() : html`<div class="goal-list">${this.goals.map((goal) => this.renderGoal(goal))}</div>`}
      </section>
    `;
  }

  private renderEmpty(): TemplateResult {
    return html`<p class="empty">${this.loading ? "Loading goals…" : "No goals recorded for this workspace."}</p>`;
  }

  private renderGoal(goal: GoalRecordSummary): TemplateResult {
    const open = this.expanded.has(goal.id);
    const fraction = goalProgressFraction(goal);
    const tokens = formatGoalTokens(goal.tokensUsed);
    const current = findCurrentTask(goal);
    const statusClass = isGoalFinished(goal) ? "done" : isGoalBlocked(goal) ? "blocked" : "active";
    return html`
      <article class=${`goal ${statusClass}`}>
        <button
          class="goal-header"
          type="button"
          aria-expanded=${String(open)}
          title=${goal.objective}
          @click=${() => { this.toggle(goal.id); }}
        >
          <span class="goal-caret" aria-hidden="true">${open ? "▾" : "▸"}</span>
          <span class="goal-objective">${goal.objective}</span>
          <span class=${`goal-status ${statusClass}`}>${goalStatusLabel(goal.status)}</span>
          <span class="goal-ratio">${goalProgressLabel(goal)}</span>
        </button>
        <div
          class="goal-bar"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax=${String(goal.totalTaskCount)}
          aria-valuenow=${String(goal.completedTaskCount)}
          aria-label=${`${goal.objective}: ${goalProgressLabel(goal)} tasks complete`}
        >
          <span class="goal-bar-fill" style=${`transform: scaleX(${String(fraction)})`}></span>
        </div>
        ${open ? this.renderDetail(goal, current, tokens) : this.renderCollapsedMeta(goal, current, tokens)}
      </article>
    `;
  }

  private renderCollapsedMeta(goal: GoalRecordSummary, current: GoalTaskSummary | undefined, tokens: string | undefined): TemplateResult | typeof nothing {
    // Collapsed rows still answer the only question that matters at a glance:
    // what is this goal doing right now, or why has it stopped?
    const reason = goal.pauseReason;
    if (current === undefined && reason === undefined && tokens === undefined) return nothing;
    return html`
      <p class="goal-meta">
        ${current === undefined ? nothing : html`<span class="goal-current">Now: ${current.title}</span>`}
        ${reason === undefined ? nothing : html`<span class="goal-reason">${reason}</span>`}
        ${tokens === undefined ? nothing : html`<span class="goal-tokens">${tokens}</span>`}
      </p>
    `;
  }

  private renderDetail(goal: GoalRecordSummary, current: GoalTaskSummary | undefined, tokens: string | undefined): TemplateResult {
    const rows = flattenGoalTasks(goal.tasks);
    return html`
      <div class="goal-detail">
        ${goal.pauseReason === undefined ? nothing : html`<p class="goal-reason detail">${goal.pauseReason}</p>`}
        ${goal.verificationContract === undefined ? nothing : html`<p class="goal-contract"><span class="label">Verification</span>${goal.verificationContract}</p>`}
        ${rows.length === 0
          ? html`<p class="empty">This goal has no task list.</p>`
          : html`<ol class="task-list">${rows.map((row) => this.renderTask(row.task, row.depth, row.task.id === current?.id))}</ol>`}
        <p class="goal-footer">
          ${goal.sisyphus ? html`<span class="goal-flag">Sisyphus</span>` : nothing}
          ${goal.autoContinue ? html`<span class="goal-flag">Auto-continue</span>` : nothing}
          ${tokens === undefined ? nothing : html`<span class="goal-tokens">${tokens}</span>`}
        </p>
      </div>
    `;
  }

  private renderTask(task: GoalTaskSummary, depth: number, isCurrent: boolean): TemplateResult {
    const done = task.status === "complete";
    const skipped = task.status === "skipped";
    return html`
      <li
        class=${`task ${done ? "done" : ""} ${skipped ? "skipped" : ""} ${isCurrent ? "current" : ""}`}
        style=${`padding-inline-start: ${String(depth * 14)}px`}
      >
        <span class="task-mark" aria-hidden="true">${done ? "✓" : skipped ? "—" : "○"}</span>
        <span class="task-body">
          <span class="task-title">${task.title}</span>
          ${task.verificationContract === undefined ? nothing : html`<span class="task-contract">${task.verificationContract}</span>`}
        </span>
        ${isCurrent ? html`<span class="task-now" title="The task the agent reported working on">now</span>` : nothing}
      </li>
    `;
  }

  private toggle(goalId: string): void {
    const next = new Set(this.expanded);
    if (!next.delete(goalId)) next.add(goalId);
    this.expanded = next;
  }

  static override styles = [listStyles, css`
    h2 { min-height: 30px; }
    h2 > .section-count { flex: 0 0 auto; color: var(--pi-muted); font-size: inherit; }
    .refresh-entry { flex: 0 0 auto; display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0; font-size: 13px; }
    .goal-list { display: grid; gap: 8px; }
    .goal { border: 1px solid var(--pi-border-muted); border-radius: 9px; background: var(--pi-surface); overflow: hidden; }
    .goal.blocked { border-color: color-mix(in srgb, var(--pi-warning) 45%, var(--pi-border-muted)); }
    .goal.done { opacity: .72; }
    .goal-header {
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      align-items: baseline;
      gap: 7px;
      width: 100%;
      border: 0;
      background: none;
      color: var(--pi-text);
      padding: 8px 10px 6px;
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    .goal-header:hover { background: var(--pi-surface-hover); }
    .goal-header:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    .goal-caret { color: var(--pi-muted); font-size: 11px; }
    .goal-objective { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .goal-status { flex: 0 0 auto; color: var(--pi-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
    .goal-status.blocked { color: var(--pi-warning); }
    .goal-status.done { color: var(--pi-success); }
    .goal-ratio { flex: 0 0 auto; color: var(--pi-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
    .goal-bar { height: 3px; background: var(--pi-border-muted); }
    /* Scaled rather than resized: width animation runs on the layout thread,
       transform runs on the compositor. Origin pinned left so the bar grows
       from its start rather than from the middle. */
    .goal-bar-fill { display: block; height: 100%; width: 100%; transform-origin: left center; background: var(--pi-accent); transition: transform .2s ease; }
    .goal.done .goal-bar-fill { background: var(--pi-success); }
    .goal.blocked .goal-bar-fill { background: var(--pi-warning); }
    .goal-meta, .goal-footer { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 6px 10px 8px; color: var(--pi-muted); font-size: 11px; }
    .goal-current { color: var(--pi-text); }
    .goal-reason { color: var(--pi-warning); }
    .goal-reason.detail { padding: 8px 10px 0; margin: 0; font-size: 12px; line-height: 1.4; }
    .goal-contract { margin: 0; padding: 8px 10px 0; color: var(--pi-muted); font-size: 11px; line-height: 1.45; }
    .goal-contract .label { display: block; color: var(--pi-text); font-weight: 600; }
    .goal-flag { border: 1px solid var(--pi-border-muted); border-radius: 999px; padding: 1px 7px; }
    .goal-detail { border-top: 1px solid var(--pi-border-muted); }
    .task-list { display: grid; gap: 2px; margin: 0; padding: 8px 10px; list-style: none; }
    .task { display: grid; grid-template-columns: auto 1fr auto; align-items: start; gap: 7px; border-radius: 6px; padding: 3px 4px; font-size: 12px; line-height: 1.4; }
    .task.current { background: color-mix(in srgb, var(--pi-accent) 12%, transparent); }
    .task-mark { color: var(--pi-muted); font-size: 11px; }
    .task.done .task-mark { color: var(--pi-success); }
    .task.done .task-title { color: var(--pi-muted); text-decoration: line-through; }
    .task.skipped .task-title { color: var(--pi-muted); font-style: italic; }
    .task-body { min-width: 0; display: grid; gap: 1px; }
    .task-title { overflow-wrap: anywhere; }
    .task-contract { color: var(--pi-muted); font-size: 11px; overflow-wrap: anywhere; }
    .task-now { color: var(--pi-accent); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .empty { margin: 0; padding: 6px 2px; color: var(--pi-muted); font-size: 12px; }
    @container (max-width: 580px) {
      .goal-header, .refresh-entry { min-height: 42px; }
    }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "goal-panel": GoalPanel;
  }
}
