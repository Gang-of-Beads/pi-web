import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { adoptGoalsHostStyles } from "./hostUi.js";
import type { GoalRecordSummary } from "./goalRecords.js";

/** The redesigned goals surface: one quiet row per the minimal-layout
 *  criteria - a status dot, the objective clamped to two lines, a muted
 *  progress count, and a ghost refresh button. No boxed header, no outline
 *  chrome: grouping is spacing, state is color, and the only accent-sized
 *  control is the refresh action. */
export const goalsSectionStyles = `
  :host { display: block; color: var(--pi-text); font: var(--pi-text-sm) var(--pi-font-ui, system-ui, sans-serif); }
  .goal-row { display: flex; align-items: flex-start; gap: var(--pi-space-4); padding: var(--pi-space-3) 0; }
  .dot { flex: 0 0 auto; width: var(--pi-dot-md); height: var(--pi-dot-md); margin-top: var(--pi-space-3); border-radius: 50%; background: var(--pi-accent); }
  .goal-row[data-status="paused"] .dot, .goal-row[data-status="budget_limited"] .dot { background: var(--pi-muted); }
  .goal-row[data-status="blocked"] .dot { background: var(--pi-danger, #c0392b); }
  .goal-row[data-status="complete"] .dot { background: var(--pi-success, #2e7d32); }
  .goal-main { flex: 1 1 auto; min-width: 0; }
  .objective { margin: 0; color: var(--pi-text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .progress { margin: var(--pi-space-1) 0 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
  .refresh { font: inherit; box-sizing: border-box; flex: 0 0 auto; display: inline-grid; place-items: center; width: var(--pi-control-height); height: var(--pi-control-height); padding: 0; border: 0; border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-muted); font-size: var(--pi-text-md); cursor: pointer; }
  @media (pointer: coarse) { .refresh { width: var(--pi-control-height-touch, 44px); height: var(--pi-control-height-touch, 44px); } }
  @media (hover: hover) { .refresh:hover { color: var(--pi-text); background: var(--pi-surface-hover); } }
  .refresh:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
  .pending { margin: 0; padding: var(--pi-space-3) 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
`;

export interface GoalsSectionState {
  goals: GoalRecordSummary[];
  brokenFiles: number;
}

export function activeGoal(state: GoalsSectionState | undefined): GoalRecordSummary | undefined {
  return state?.goals[0];
}

export function progressLabel(goal: GoalRecordSummary): string | undefined {
  if (goal.tasksTotal === 0) return undefined;
  if (goal.status === "complete") return `${String(goal.tasksTotal)}/${String(goal.tasksTotal)} tasks`;
  return `${String(goal.tasksDone)}/${String(goal.tasksTotal)} tasks`;
}

export function badgeFor(state: GoalsSectionState | undefined): string | number | undefined {
  const goal = activeGoal(state);
  if (goal === undefined) return undefined;
  const remaining = goal.tasksTotal - goal.tasksDone;
  if (goal.status === "complete" || remaining <= 0) return undefined;
  return remaining;
}

@customElement("pi-web-goals-section")
export class PiWebGoalsSection extends LitElement {
  static override styles = [css`${unsafeCSS(goalsSectionStyles)}`];
  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) adoptGoalsHostStyles(root);
    return root;
  }

  @property({ attribute: false }) state: GoalsSectionState | undefined = undefined;
  @property({ attribute: false }) onRefresh?: () => void;
  @state() private refreshing = false;

  private readonly handleRefresh = (): void => {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      this.onRefresh?.();
    } finally {
      this.refreshing = false;
    }
  };

  override render() {
    const goal = activeGoal(this.state);
    if (goal === undefined) {
      return this.state === undefined ? html`<p class="pending">Reading goal records…</p>` : nothing;
    }
    const progress = progressLabel(goal);
    return html`
      <div class="goal-row" data-status=${goal.status}>
        <span class="dot" aria-hidden="true"></span>
        <div class="goal-main">
          <p class="objective">${goal.objective}</p>
          ${progress === undefined ? nothing : html`<p class="progress">${progress}</p>`}
        </div>
        <button
          class="refresh"
          type="button"
          title="Re-read goal records from the workspace"
          aria-label="Refresh goals"
          @click=${this.handleRefresh}
        >↻</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "pi-web-goals-section": PiWebGoalsSection;
  }
}
