import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GoalRecordSummary, GoalTaskSummary } from "../api";
import type { PanelLoad } from "../appState";
import {
  findCurrentTask,
  flattenGoalTasks,
  formatGoalTokens,
  goalCommandsFor,
  goalProgressFraction,
  goalProgressLabel,
  goalStatusLabel,
  isGoalBlocked,
  isGoalFinished,
} from "../goalProgress";
import { listStyles, interactiveSurfaceStyles } from "./shared";

/**
 * The goals recorded for the selected workspace, with per-task progress.
 *
 * Several goals can be open at once — sessions of a workspace share one
 * `.pi/goals/` directory — so this is a list, not a single card. Each goal
 * collapses to one row carrying its status and completion ratio; expanding it
 * reveals the task tree, the focused task, and each task's verification
 * contract.
 *
 * Reading is the default: the extension owns goal state, and a browser-side
 * edit would race the agent working the goal. Archiving is the one exception,
 * because a paused goal otherwise stays at the top of this list forever - the
 * extension's own clear command refuses without a confirmable UI, which a web
 * session has not got. It confirms first, and says what it will do.
 */
@customElement("goal-panel")
export class GoalPanel extends LitElement {
  /**
   * One keyed load slot, not three flags: the empty claim is reachable only
   * through `state === "loaded"`, and a slot keyed to another selection reads
   * as unloaded here. Three travelling flags forgot each other once already -
   * the loading flag existed in state and never once reached this panel.
   */
  @property({ attribute: false }) goalsLoad: PanelLoad<GoalRecordSummary[]> = { state: "unloaded", key: undefined, data: [] };
  @property({ attribute: false }) onRefresh?: () => void | Promise<void>;
  @property({ attribute: false }) presence?: "present" | "absent" | "failed";
  /** Archive a goal the agent is not going to finish; confirmed before it runs. */
  @property({ attribute: false }) onArchive?: (goal: GoalRecordSummary) => void | Promise<void>;
  /**
   * Runs a goal slash command in the focused session. The panel lists goals for
   * the whole workspace, but a command only means something inside a session,
   * so a panel with no session to run in shows its controls disabled rather
   * than hiding them.
   */
  @property({ attribute: false }) onRunCommand?: (goal: GoalRecordSummary, command: string) => void | Promise<void>;
  @property({ type: Boolean }) canRunCommands = true;
  /**
   * A command from this panel is in flight. Every command button disables at
   * the press itself - not at the next poll - so the press is heard at once
   * and a double press cannot start a second copy. The transcript's ledger
   * row carries the waiting/running/result story; this carries "heard you".
   */
  @property({ type: Boolean }) commandInFlight = false;

  /** Expanded goal ids. Collapsed by default so many goals stay scannable. */
  @state() private expanded = new Set<string>();
  /** The goal whose archive button has been armed; a second press runs it. */
  @state() private confirmingArchiveId: string | undefined;

  override render(): TemplateResult {
    return html`
      <section>
        <h2>
          Goals
          <span class="section-count">${this.openGoalsLabel()}</span>
          <button
            class="refresh-entry"
            type="button"
            title="Re-read goal records from the workspace"
            aria-label="Refresh goals"
            ?disabled=${this.isReading}
            @click=${() => { void this.onRefresh?.(); }}
          >↻</button>
        </h2>
        ${this.rows.length === 0 ? this.renderEmpty() : html`<div class="goal-list">${this.rows.map((goal) => this.renderGoal(goal))}</div>`}
      </section>
    `;
  }

  /**
   * What the number beside the heading counts. Finished goals stay listed for
   * the record, so counting them would advertise work that is over.
   */
  private get rows(): GoalRecordSummary[] {
    // A slot whose key does not match this panel's selection is unloaded here,
    // whatever it holds: rows kept across a key change would be another
    // project's goals rendered as this one's.
    return this.goalsLoad.state === "loaded" ? this.goalsLoad.data : [];
  }

  /**
   * The root a goal was read from, shown only when two roots contributed.
   * A union read labels every record, but with one distinct root the label
   * says nothing the panel did not already answer for, and the everyday
   * single-root shape must render exactly as before.
   */
  private sourceRootLabel(goal: GoalRecordSummary): string | undefined {
    const roots = new Set(this.rows.map((row) => row.sourceRoot).filter((root) => root !== undefined));
    if (roots.size < 2) return undefined;
    return goal.sourceRoot;
  }

  /** A read is under way. Not the same as never having read. */
  private get isReading(): boolean {
    return this.goalsLoad.state === "loading";
  }

  /**
   * Nothing has been read for this selection yet.
   *
   * Rendered as "Loading goals…" this was a lie with a trap in it: the refresh
   * control was disabled in the same state, so the one action that would have
   * started a read was unavailable exactly while nothing was reading. The panel
   * sat there forever and the only way out was reloading the page.
   */
  private get isUnread(): boolean {
    return this.goalsLoad.state === "unloaded";
  }

  private openGoalsLabel(): string {
    const open = this.rows.filter((goal) => !isGoalFinished(goal)).length;
    return open === 0 ? "" : `${String(open)} open`;
  }

  private renderCommands(goal: GoalRecordSummary): TemplateResult | null {
    const commands = goalCommandsFor(goal);
    if (commands.length === 0) return null;
    return html`
      <div class="goal-commands">
        ${commands.map((entry) => html`
          <button
            class=${`goal-command ${entry.destructive ? "destructive" : ""}`}
            type="button"
            ?disabled=${!this.canRunCommands || this.commandInFlight}
            title=${!this.canRunCommands ? "Open a session in this workspace to run goal commands" : this.commandInFlight ? "A goal command is already running" : entry.description}
            @click=${() => { void this.onRunCommand?.(goal, entry.command); }}
          >${entry.label}</button>
        `)}
      </div>
    `;
  }

  private renderEmpty(): TemplateResult {
    // Three of these four states used to collapse into "No goals recorded":
    // not read yet, read failed, and another workspace's rows. Only a completed
    // read over the matching selection may claim emptiness.
    const line = this.goalsLoad.state === "failed"
      ? "Couldn't read goals from this workspace."
      : this.isReading ? "Loading goals…"
      : this.isUnread ? "Goals have not been read yet."
      : this.presence === "absent" ? "Goal tools are not installed for this session."
      : "No goals recorded for this workspace.";
    return html`<p class="empty">${line}</p>`;
  }

  private renderGoal(goal: GoalRecordSummary): TemplateResult {
    const open = this.expanded.has(goal.id);
    const fraction = goalProgressFraction(goal);
    const tokens = formatGoalTokens(goal.tokensUsed);
    const current = findCurrentTask(goal);
    const statusClass = isGoalFinished(goal) ? "done" : isGoalBlocked(goal) ? "blocked" : "active";
    const sourceRoot = this.sourceRootLabel(goal);
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
          ${sourceRoot === undefined ? nothing : html`<span class="goal-root" title=${sourceRoot}>${sourceRoot}</span>`}
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
        ${this.renderCommands(goal)}
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
          ${this.onArchive === undefined ? nothing : html`
            <button
              class="goal-archive"
              type="button"
              title="Move this goal out of the active list"
              @click=${() => { this.confirmArchive(goal); }}
            >${this.confirmingArchiveId === goal.id ? "Confirm archive" : "Archive goal"}</button>
          `}
        </p>
        ${this.confirmingArchiveId === goal.id ? html`
          <p class="goal-archive-warning" role="alert">
            Archiving moves this record to <code>archived/</code>. An agent already working this goal keeps its own copy until it is told to reload, so archive it while that session is idle.
          </p>
        ` : nothing}
      </div>
    `;
  }

  /**
   * Two presses rather than a dialog: the first arms and explains, the second
   * runs. A destructive action that reaches into another process's state should
   * not happen on one stray tap, and a modal for it would be heavier than the
   * panel it sits in.
   */
  private confirmArchive(goal: GoalRecordSummary): void {
    if (this.confirmingArchiveId !== goal.id) {
      this.confirmingArchiveId = goal.id;
      return;
    }
    this.confirmingArchiveId = undefined;
    void this.onArchive?.(goal);
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

  static override styles = [interactiveSurfaceStyles, listStyles, css`
    h2 { min-height: 30px; }
    h2 > .section-count { flex: 1 1 auto; margin-inline-start: var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-2xs); font-weight: 400; letter-spacing: normal; }
    .refresh-entry { flex: 0 0 auto; display: inline-grid; place-items: center; width: 34px; height: 34px; padding: 0; font-size: var(--pi-text-sm); }

    .goal-commands { display: flex; gap: var(--pi-space-2); padding: var(--pi-space-3) var(--pi-space-4) 0; }
    .goal-command { flex: 0 0 auto; padding: var(--pi-space-2) var(--pi-space-4); border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-text-secondary); font-size: var(--pi-text-2xs); cursor: pointer; }
    @media (hover: hover) { .goal-command:hover:not(:disabled) { border-color: var(--pi-border-strong, var(--pi-accent)); color: var(--pi-text); } }
    .goal-command:disabled { opacity: .45; cursor: default; }
    @media (hover: hover) { .goal-command.destructive:hover:not(:disabled) { border-color: var(--pi-danger-border, var(--pi-warning)); color: var(--pi-danger, var(--pi-warning)); } }
    .goal-list { display: grid; gap: var(--pi-space-4); }
    .goal { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-md); background: var(--pi-surface); overflow: hidden; }
    .goal.blocked { border-color: color-mix(in srgb, var(--pi-warning) 45%, var(--pi-border-muted)); }
    .goal.done { opacity: .72; }
    .goal-header {
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      align-items: center;
      gap: var(--pi-space-4);
      width: 100%;
      /* The whole header is the primary tap target on a phone. */
      min-height: 40px;
      box-sizing: border-box;
      border: 0;
      background: none;
      color: var(--pi-text);
      padding: var(--pi-space-4) var(--pi-space-5) var(--pi-space-3);
      font: inherit;
      text-align: start;
      cursor: pointer;
    }
    @media (hover: hover) { .goal-header:hover { background: var(--pi-surface-hover); } }
    .goal-header:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    .goal-caret { color: var(--pi-muted); font-size: var(--pi-text-2xs); }
    .goal-objective { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .goal-status { flex: 0 0 auto; color: var(--pi-muted); font-size: var(--pi-text-2xs); text-transform: uppercase; letter-spacing: .03em; }
    .goal-status.blocked { color: var(--pi-warning); }
    .goal-status.done { color: var(--pi-success); }
    .goal-ratio { flex: 0 0 auto; color: var(--pi-muted); font-size: var(--pi-text-2xs); font-variant-numeric: tabular-nums; }
    /* A quiet qualifier, not a badge: it only appears when two roots contributed, and says where this row came from. */
    .goal-root { flex: 0 0 auto; max-width: 30%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); font-size: var(--pi-text-2xs); font-family: var(--pi-font-mono, monospace); }
    .goal-bar { height: 3px; background: var(--pi-border-muted); }
    /* Scaled rather than resized: width animation runs on the layout thread,
       transform runs on the compositor. Origin pinned left so the bar grows
       from its start rather than from the middle. */
    .goal-bar-fill { display: block; height: 100%; width: 100%; transform-origin: left center; background: var(--pi-accent); transition: transform .2s ease; }
    .goal.done .goal-bar-fill { background: var(--pi-success); }
    .goal.blocked .goal-bar-fill { background: var(--pi-warning); }
    .goal-meta, .goal-footer { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pi-space-4); margin: 0; padding: var(--pi-space-3) var(--pi-space-5) var(--pi-space-4); color: var(--pi-muted); font-size: var(--pi-text-2xs); }
    .goal-archive { margin-left: auto; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); background: var(--pi-surface); color: var(--pi-muted); padding: 3px var(--pi-space-5); font: inherit; font-size: var(--pi-text-2xs); cursor: pointer; }
    .goal-archive:focus-visible { color: var(--pi-danger); border-color: var(--pi-danger); }
    @media (hover: hover) { .goal-archive:hover { color: var(--pi-danger); border-color: var(--pi-danger); } }
    .goal-archive-warning { margin: 0; padding: 0 var(--pi-space-5) var(--pi-space-5); color: var(--pi-warning); font-size: var(--pi-text-2xs); line-height: 1.45; }
    .goal-archive-warning code { font-family: var(--pi-control-monospace-font-family, ui-monospace, monospace); }
    .goal-current { color: var(--pi-text); }
    .goal-reason { color: var(--pi-warning); }
    .goal-reason.detail { padding: var(--pi-space-4) var(--pi-space-5) 0; margin: 0; font-size: var(--pi-text-xs); line-height: 1.4; }
    .goal-contract { margin: 0; padding: var(--pi-space-4) var(--pi-space-5) 0; color: var(--pi-muted); font-size: var(--pi-text-2xs); line-height: 1.45; }
    .goal-contract .label { display: block; color: var(--pi-text); font-weight: 600; }
    .goal-flag { border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-pill); padding: 1px var(--pi-space-4); }
    .goal-detail { border-top: 1px solid var(--pi-border-muted); }
    .task-list { display: grid; gap: var(--pi-space-1); margin: 0; padding: var(--pi-space-4) var(--pi-space-5); list-style: none; }
    .task { display: grid; grid-template-columns: auto 1fr auto; align-items: start; gap: var(--pi-space-4); border-radius: var(--pi-radius-sm); padding: 3px var(--pi-space-2); font-size: var(--pi-text-xs); line-height: 1.4; }
    .task.current { background: color-mix(in srgb, var(--pi-accent) 12%, transparent); }
    .task-mark { color: var(--pi-muted); font-size: var(--pi-text-2xs); }
    .task.done .task-mark { color: var(--pi-success); }
    .task.done .task-title { color: var(--pi-muted); text-decoration: line-through; }
    .task.skipped .task-title { color: var(--pi-muted); font-style: italic; }
    .task-body { min-width: 0; display: grid; gap: 1px; }
    .task-title { overflow-wrap: anywhere; }
    .task-contract { color: var(--pi-muted); font-size: var(--pi-text-2xs); overflow-wrap: anywhere; }
    .task-now { color: var(--pi-accent); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .empty { margin: 0; padding: var(--pi-space-3) var(--pi-space-1); color: var(--pi-muted); font-size: var(--pi-text-xs); }
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
