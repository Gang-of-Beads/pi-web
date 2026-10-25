import type { TemplateResult } from "lit";
import type { HtmlTemplateTag, PluginButton, PluginHostUi, PluginListGroup, PluginListModel, PluginListRead, PluginListRow, PluginListTone } from "@gang-of-beads/pi-web/plugin-api";
import type { GoalRecord, GoalTodoRecord, WorkspaceGoals } from "./goalRecords.js";
import { currentTodo, elapsedMs, formatDuration, GOAL_STATUS, goalTitle, progressText, sortGoals, TODO_STATUS, type TodoMark } from "./goalPresentation.js";

/**
 * The Goal pages' drawing: status lists through the host's `renderList`, and the small inline
 * views (a goal's TODOs, a session's label) styled with the theme's own tokens, since they land in
 * host elements and shadow roots this plugin's stylesheets do not reach.
 */
export interface GoalRowOptions {
  readonly now: number;
  readonly sessionId: string | undefined;
  readonly expanded: (goal: GoalRecord) => boolean;
  readonly toggle: (goal: GoalRecord) => void;
  readonly body: (goal: GoalRecord) => TemplateResult;
}

function durationPart(ms: number): string | undefined {
  return ms > 0 ? formatDuration(ms) : undefined;
}

function goalDetail(goal: GoalRecord, options: GoalRowOptions): string {
  const current = GOAL_STATUS[goal.status].finished ? undefined : currentTodo(goal);
  return [
    progressText(goal),
    durationPart(elapsedMs(goal, options.now)),
    current === undefined ? undefined : `next: TODO #${String(current.id)}`,
    options.sessionId !== undefined && goal.sessionId === options.sessionId ? "this session" : undefined,
  ].filter((part): part is string => part !== undefined).join(" · ");
}

function goalRow(goal: GoalRecord, options: GoalRowOptions): PluginListRow {
  const status = GOAL_STATUS[goal.status];
  return {
    id: goal.uuid,
    title: goalTitle(goal),
    status: { label: status.label, tone: status.tone },
    detail: goalDetail(goal, options),
    expansion: { expanded: options.expanded(goal), onToggle: () => { options.toggle(goal); }, body: () => options.body(goal) },
  };
}

function skippedNote(skipped: number): string[] {
  if (skipped === 0) return [];
  return [`${String(skipped)} goal ${skipped === 1 ? "file" : "files"} could not be read and ${skipped === 1 ? "is" : "are"} not shown; pi-goal reports ${skipped === 1 ? "it" : "them"} when a session loads.`];
}

export interface WorkspaceListInput {
  readonly read: PluginListRead;
  readonly goals: WorkspaceGoals | undefined;
  readonly rows: GoalRowOptions;
}

/** The workspace page's list: goals still open first, finished goals in their own group. */
export function workspaceListModel(input: WorkspaceListInput): PluginListModel {
  const goals = sortGoals(input.goals?.goals ?? []);
  const open = goals.filter((goal) => !GOAL_STATUS[goal.status].finished);
  const finished = goals.filter((goal) => GOAL_STATUS[goal.status].finished);
  const groups: PluginListGroup[] = [
    { id: "open", heading: "Open", rows: open.map((goal) => goalRow(goal, input.rows)) },
    { id: "finished", heading: "Finished", rows: finished.map((goal) => goalRow(goal, input.rows)) },
  ];
  return {
    read: input.read,
    groups,
    words: {
      empty: (input.goals?.skipped ?? 0) > 0 ? "pi-goal has goal files for this folder, but none could be read." : "pi-goal has no goals for this folder yet.",
      reading: "Reading goals…",
      failed: "Could not read pi-goal's goals.",
      stale: "Could not refresh - showing the last read.",
    },
    notes: skippedNote(input.goals?.skipped ?? 0),
  };
}

export interface GlobalListInput {
  readonly read: PluginListRead;
  readonly workspaces: readonly WorkspaceGoals[] | undefined;
  readonly skippedWorkspaces: number;
  readonly rows: GoalRowOptions;
}

function latestUpdate(workspace: WorkspaceGoals): string {
  return workspace.goals.reduce((latest, goal) => (goal.updatedAt ?? "") > latest ? goal.updatedAt ?? "" : latest, "");
}

/** Every folder's goals, the most recently updated folder first; read-only. */
export function globalListModel(input: GlobalListInput): PluginListModel {
  const workspaces = [...input.workspaces ?? []].sort((a, b) => latestUpdate(b).localeCompare(latestUpdate(a)));
  const skipped = workspaces.reduce((count, workspace) => count + workspace.skipped, 0);
  return {
    read: input.read,
    groups: workspaces.map((workspace) => ({
      id: workspace.directory,
      heading: workspace.directory,
      rows: sortGoals(workspace.goals).map((goal) => goalRow(goal, input.rows)),
    })),
    words: {
      empty: skipped + input.skippedWorkspaces > 0 ? "pi-goal has goal files on this machine, but none could be read." : "pi-goal has no goals on this machine yet.",
      reading: "Reading goals…",
      failed: "Could not read pi-goal's goals.",
      stale: "Could not refresh - showing the last read.",
    },
    notes: [
      ...skippedNote(skipped),
      ...input.skippedWorkspaces === 0 ? [] : [`${String(input.skippedWorkspaces)} goal ${input.skippedWorkspaces === 1 ? "folder" : "folders"} could not be read or ${input.skippedWorkspaces === 1 ? "does" : "do"} not name a matching project, and ${input.skippedWorkspaces === 1 ? "is" : "are"} not shown.`],
    ],
  };
}

const MARK_PATHS: Readonly<Record<TodoMark, string>> = {
  check: "M4 12.5l5 5L20 6.5",
  play: "M8 5l11 7-11 7z",
  cross: "M6 6l12 12M18 6L6 18",
  ring: "M12 4a8 8 0 1 0 0.01 0",
};

/** A TODO's state as a drawn mark in the text's colour family, named for screen readers. */
export function todoMark(html: HtmlTemplateTag, status: GoalTodoRecord["status"], decorative = false): TemplateResult {
  const look = TODO_STATUS[status];
  if (decorative) return html`<svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em" fill=${look.mark === "play" ? "currentColor" : "none"} stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:${look.color};vertical-align:-0.125em;flex:none"><path d=${MARK_PATHS[look.mark]}></path></svg>`;
  return html`<svg role="img" aria-label=${look.label} viewBox="0 0 24 24" width="1em" height="1em" fill=${look.mark === "play" ? "currentColor" : "none"} stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:${look.color};vertical-align:-0.125em;flex:none"><title>${look.label}</title><path d=${MARK_PATHS[look.mark]}></path></svg>`;
}

/** A goal's full text and TODO list; `controls` are drawn under it when the page can act. */
export function goalBody(html: HtmlTemplateTag, goal: GoalRecord, controls: TemplateResult | undefined): TemplateResult {
  const extraText = goal.text.split("\n").slice(1).join("\n").trim();
  return html`
    <div style="display:grid;gap:var(--pi-space-4);min-width:0">
      ${extraText === "" ? "" : html`<div style="white-space:pre-wrap;overflow-wrap:anywhere;color:var(--pi-text-secondary)">${extraText}</div>`}
      ${goal.todos.length === 0
        ? html`<div style="color:var(--pi-muted)">No TODOs yet: pi-goal asks its questions in the chat, then lists the TODOs for confirmation.</div>`
        : html`<ol style="list-style:none;margin:0;padding:0;display:grid;gap:6px">${goal.todos.map((todo) => {
          return html`<li style="display:grid;grid-template-columns:1.25em minmax(0,1fr);gap:4px;align-items:start">
            <span style="line-height:1.4">${todoMark(html, todo.status)}</span>
            <span style="min-width:0;overflow-wrap:anywhere">
              <span>TODO #${String(todo.id)} ${todo.text}</span>
              ${todo.evidence === undefined ? "" : html`<span style="display:block;color:var(--pi-muted);white-space:pre-wrap">${todo.status === "blocked" ? "Blocked: " : ""}${todo.evidence}</span>`}
            </span>
          </li>`;
        })}</ol>`}
      ${controls ?? ""}
    </div>
  `;
}

/** A row of host buttons that wraps on a narrow screen, with the gap the coarse-pointer targets need. */
export function buttonRow(html: HtmlTemplateTag, ui: PluginHostUi, buttons: readonly PluginButton[]): TemplateResult | undefined {
  const render = ui.renderButton;
  if (render === undefined || buttons.length === 0) return undefined;
  return html`<div style="display:flex;flex-wrap:wrap;gap:var(--pi-space-4)">${buttons.map((button) => render(button))}</div>`;
}

const TONE_COLOR: Readonly<Record<PluginListTone, string>> = {
  good: "var(--pi-success)",
  attention: "var(--pi-warning)",
  problem: "var(--pi-danger)",
  neutral: "var(--pi-muted)",
};

/** The one line a session tile in Navigate carries: the most pressing open goal the session created. */
export function sessionLabel(html: HtmlTemplateTag, goals: readonly GoalRecord[], stale: boolean): TemplateResult | undefined {
  const open = sortGoals(goals.filter((goal) => !GOAL_STATUS[goal.status].finished));
  const first = open[0];
  if (first === undefined) return undefined;
  const status = GOAL_STATUS[first.status];
  const more = open.length > 1 ? ` +${String(open.length - 1)}` : "";
  const progress = first.planConfirmed && first.todos.length > 0 ? ` · ${progressText(first)}` : "";
  const staleness = stale ? " · not refreshed" : "";
  return html`<span style="display:block;max-width:100%;color:${TONE_COLOR[status.tone]};white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title=${goalTitle(first)}>Goal #${String(first.id)} · ${status.label}${progress}${more}${staleness}</span>`;
}

/**
 * Display ids two goals of one folder share. pi-goal renumbers the later goal when a session loads
 * the folder, so until then a command naming the id could reach either goal.
 */
export function sharedIds(goals: readonly GoalRecord[]): ReadonlySet<number> {
  const seen = new Set<number>();
  const shared = new Set<number>();
  for (const goal of goals) {
    if (seen.has(goal.id)) shared.add(goal.id);
    seen.add(goal.id);
  }
  return shared;
}
