import type { TemplateResult } from "lit";
import type { HtmlTemplateTag, ToolRendererViewModel } from "@gang-of-beads/pi-web/plugin-api";
import type { GoalTodoStatus } from "./goalRecords.js";
import { TODO_STATUS } from "./goalPresentation.js";
import { todoMark } from "./goalViews.js";

/**
 * The transcript cards for pi-goal's two tools.
 *
 * `goal_todo` is the agent marking a TODO: the card says which TODO became what, with the evidence
 * it gave. `goal_plan` is the agent asking a clarifying question or proposing the TODO plan: the
 * card shows the question and its answer, or the proposed TODOs and approvals. The answer itself is
 * given in pi-goal's own dialog card; this card only records it. A call these cannot read is left
 * to the host's card (`undefined`).
 */
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Reflect.get(value, key) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Every entry a non-empty string, or undefined: a malformed list is left to the host's card rather than drawn in part. */
function texts(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const entries = value.map(text);
  return entries.every((entry): entry is string => entry !== undefined) ? entries : undefined;
}

interface ApprovalArgument {
  readonly action: string;
  readonly command: string;
}

function approvalArguments(value: unknown): ApprovalArgument[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const entries = value.map((entry: unknown) => {
    const action = text(field(entry, "action"));
    const command = text(field(entry, "command"));
    return action === undefined || command === undefined ? undefined : { action, command };
  });
  return entries.every((entry): entry is ApprovalArgument => entry !== undefined) ? entries : undefined;
}

/** pi-goal answers a closed dialog with this sentence instead of an answer. */
const PLANNING_STOPPED = "Planning stopped.";

const TODO_STATUSES: readonly GoalTodoStatus[] = ["pending", "running", "blocked", "done"];

function todoStatus(value: unknown): GoalTodoStatus | undefined {
  return TODO_STATUSES.find((status) => status === value);
}

const MUTED = "color:var(--pi-muted)";
const WRAP = "white-space:pre-wrap;overflow-wrap:anywhere";

function failure(html: HtmlTemplateTag, view: ToolRendererViewModel): TemplateResult | string {
  if (view.status === "error") return html`<div style="color:var(--pi-danger);${WRAP}">${view.resultText ?? "The tool failed."}</div>`;
  if (view.status === "interrupted") return html`<div style=${MUTED}>Interrupted before pi-goal answered.</div>`;
  return "";
}

/**
 * What a `goal_todo` call established: the new status only once pi-goal answered with it; before
 * that, or when it refused, the card says which status was asked for and not that it took.
 */
const TODO_CALL_WORDS: Readonly<Record<ToolRendererViewModel["status"], (label: string) => string>> = {
  success: (label) => label,
  running: (label) => `marking as ${label}…`,
  error: (label) => `not marked as ${label}`,
  interrupted: (label) => `not marked as ${label}`,
};

export function renderGoalTodoCall(html: HtmlTemplateTag, view: ToolRendererViewModel): TemplateResult | undefined {
  const goalId = count(field(view.args, "goalId"));
  const todoId = count(field(view.args, "todoId"));
  const requested = todoStatus(field(view.args, "status"));
  const recorded = view.status === "success" ? todoStatus(field(view.details, "status")) ?? requested : undefined;
  if (goalId === undefined || todoId === undefined || requested === undefined) return undefined;
  const look = TODO_STATUS[recorded ?? requested];
  const todoText = text(field(view.details, "text"));
  const evidence = view.status === "success" ? text(field(view.details, "evidence")) ?? text(field(view.args, "evidence")) : text(field(view.args, "evidence"));
  return html`
    <div style="display:grid;gap:4px;min-width:0">
      <div>${recorded === undefined ? "" : html`${todoMark(html, recorded, true)} `}Goal #${String(goalId)} · TODO #${String(todoId)} <strong>${TODO_CALL_WORDS[view.status](look.label)}</strong></div>
      ${todoText === undefined ? "" : html`<div style=${WRAP}>${todoText}</div>`}
      ${evidence === undefined ? "" : html`<div style="${MUTED};${WRAP}">${evidence}</div>`}
      ${failure(html, view)}
    </div>
  `;
}

function firstSentence(value: string | undefined): string | undefined {
  return value === undefined ? undefined : /^[^.!?\n]*[.!?]?/u.exec(value)?.[0].trim();
}

function renderAsk(html: HtmlTemplateTag, view: ToolRendererViewModel, goalId: number): TemplateResult | undefined {
  const question = text(field(view.args, "question"));
  if (question === undefined) return undefined;
  const options = texts(field(view.args, "options"));
  if (options === undefined) return undefined;
  const result = view.status === "success" ? text(view.resultText) : undefined;
  const stopped = result?.startsWith(PLANNING_STOPPED) === true;
  const answer = stopped ? undefined : result;
  return html`
    <div style="display:grid;gap:6px;min-width:0">
      <div style=${MUTED}>Goal #${String(goalId)} asks</div>
      <div style=${WRAP}>${question}</div>
      ${options.length === 0 ? "" : html`<ul style="margin:0;padding-left:1.25em;${MUTED}">${options.map((option) => html`<li style=${WRAP}>${option}</li>`)}</ul>`}
      ${answer === undefined ? "" : html`<div style=${WRAP}><strong>Answer:</strong> ${answer}</div>`}
      ${stopped ? html`<div style=${MUTED}>Not answered: the dialog was closed and planning stopped.</div>` : ""}
      ${view.status === "running" ? html`<div style=${MUTED}>Waiting for the answer in the dialog card.</div>` : ""}
      ${failure(html, view)}
    </div>
  `;
}

function renderConfirm(html: HtmlTemplateTag, view: ToolRendererViewModel, goalId: number): TemplateResult | undefined {
  const todos = texts(field(view.args, "todos"));
  const approvals = approvalArguments(field(view.args, "approvals"));
  if (todos === undefined || todos.length === 0 || approvals === undefined) return undefined;
  const outcome = view.status === "success" ? firstSentence(text(view.resultText)) : undefined;
  return html`
    <div style="display:grid;gap:6px;min-width:0">
      <div style=${MUTED}>Goal #${String(goalId)} · proposed plan, ${String(todos.length)} ${todos.length === 1 ? "TODO" : "TODOs"}</div>
      <ol style="margin:0;padding-left:1.5em;display:grid;gap:2px">${todos.map((todo) => html`<li style=${WRAP}>${todo}</li>`)}</ol>
      ${approvals.length === 0 ? "" : html`
        <div style=${MUTED}>Approved with the plan when confirmed:</div>
        <ul style="margin:0;padding-left:1.25em;display:grid;gap:2px">${approvals.map((approval) => html`<li style=${WRAP}>${approval.action}<br><code style=${WRAP}>${approval.command}</code></li>`)}</ul>`}
      ${outcome === undefined ? "" : html`<div><strong>${outcome}</strong></div>`}
      ${view.status === "running" ? html`<div style=${MUTED}>Waiting for confirmation in the dialog card.</div>` : ""}
      ${failure(html, view)}
    </div>
  `;
}

export function renderGoalPlanCall(html: HtmlTemplateTag, view: ToolRendererViewModel): TemplateResult | undefined {
  const goalId = count(field(view.args, "goalId"));
  if (goalId === undefined) return undefined;
  const action = field(view.args, "action");
  if (action === "ask") return renderAsk(html, view, goalId);
  if (action === "confirm") return renderConfirm(html, view, goalId);
  return undefined;
}
