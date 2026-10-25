/**
 * The goal records the Goal plugin reads from pi-goal's files, and the answers its server half
 * gives the page.
 *
 * pi-goal (a Pi extension installed on its own) owns the files and every change to them; this
 * module only parses what it wrote, defensively, keeping the fields the pages draw. It imports
 * nothing at runtime, because the server half loads it unbundled and the browser half bundles it.
 */
import type { JsonObject } from "@gang-of-beads/pi-web/plugin-api";

/** The agent-side surface the pages front: pi-goal, backed by its tools. */
export const GOAL_SURFACE = "pi-goal";

export type GoalStatus = "clarifying" | "pending" | "running" | "paused" | "review" | "done" | "cancelled";
export type GoalTodoStatus = "pending" | "running" | "blocked" | "done";

export interface GoalTodoRecord extends JsonObject {
  readonly id: number;
  readonly text: string;
  readonly status: GoalTodoStatus;
  readonly completedAt?: string;
  readonly evidence?: string;
}

export interface GoalRecord extends JsonObject {
  readonly uuid: string;
  readonly id: number;
  readonly text: string;
  readonly status: GoalStatus;
  readonly workspace: string;
  readonly sessionId?: string;
  readonly updatedAt?: string;
  readonly planConfirmed: boolean;
  readonly todos: readonly GoalTodoRecord[];
  readonly elapsedMs: number;
  readonly runStartedAt?: string;
}

/** One workspace's goals as read: the goals that parsed, and how many files did not. */
export interface WorkspaceGoals extends JsonObject {
  readonly directory: string;
  readonly goals: readonly GoalRecord[];
  readonly skipped: number;
}

/**
 * The answer for one workspace. `failed` is a read that could not happen (the directory exists and
 * could not be listed); it never stands for "no goals", which is `ready` with none.
 */
export type WorkspaceGoalsRead =
  | ({ readonly state: "ready" } & WorkspaceGoals)
  | { readonly state: "failed"; readonly directory: string; readonly error: string };

/** The answer for every workspace pi-goal has stored goals for on this machine. */
export type AllGoalsRead =
  | { readonly state: "ready"; readonly workspaces: readonly WorkspaceGoals[]; readonly skippedWorkspaces: number }
  | { readonly state: "failed"; readonly error: string };

const GOAL_STATUSES: readonly GoalStatus[] = ["clarifying", "pending", "running", "paused", "review", "done", "cancelled"];
const TODO_STATUSES: readonly GoalTodoStatus[] = ["pending", "running", "blocked", "done"];

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Reflect.get(value, key) : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function timeText(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function oneOf<T extends string>(known: readonly T[], value: unknown): T | undefined {
  return known.find((entry) => entry === value);
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function optionalOf<T>(value: unknown, check: (present: unknown) => T | undefined): { readonly ok: boolean; readonly value: T | undefined } {
  if (value === undefined) return { ok: true, value: undefined };
  const checked = check(value);
  return { ok: checked !== undefined, value: checked };
}

function isTextList(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => nonEmptyText(entry) !== undefined);
}

function isAnswerList(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof field(entry, "question") === "string" && typeof field(entry, "answer") === "string");
}

/** pi-goal's approval bounds (`validateApprovals` in its src/sexp.ts). */
const MAX_APPROVALS = 30;
const MAX_APPROVAL_LENGTH = 2000;

function approvalText(value: unknown): boolean {
  const text = nonEmptyText(value);
  return text !== undefined && text.length <= MAX_APPROVAL_LENGTH;
}

function isApprovalList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= MAX_APPROVALS && value.every((entry) => approvalText(field(entry, "action")) && approvalText(field(entry, "command")));
}

function parseTodo(value: unknown): GoalTodoRecord | undefined {
  const id = positiveInteger(field(value, "id"));
  const text = nonEmptyText(field(value, "text"));
  const status = oneOf(TODO_STATUSES, field(value, "status"));
  const completedAt = optionalOf(field(value, "completedAt"), timeText);
  const evidenceField = field(value, "evidence");
  if (id === undefined || text === undefined || status === undefined || !completedAt.ok) return undefined;
  if (evidenceField !== undefined && typeof evidenceField !== "string") return undefined;
  const evidence = nonEmptyText(evidenceField);
  return { id, text, status, ...(completedAt.value === undefined ? {} : { completedAt: completedAt.value }), ...(evidence === undefined ? {} : { evidence }) };
}

function parseTodos(value: unknown): GoalTodoRecord[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const todos = value.map(parseTodo);
  if (!todos.every((todo): todo is GoalTodoRecord => todo !== undefined)) return undefined;
  return new Set(todos.map((todo) => todo.id)).size === todos.length ? todos : undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** The optional fields pi-goal checks on load, each absent or well-formed; any malformed one makes pi-goal skip the file. */
function optionalFieldsValid(value: unknown): boolean {
  const planConfirmed = field(value, "planConfirmed");
  const approvalsConfirmed = field(value, "approvalsConfirmed");
  const history = field(value, "history");
  return (planConfirmed === undefined || typeof planConfirmed === "boolean")
    && (approvalsConfirmed === undefined || typeof approvalsConfirmed === "boolean")
    && (history === undefined || Array.isArray(history))
    && ["constraints", "acceptance"].every((key) => field(value, key) === undefined || isTextList(field(value, key)))
    && (field(value, "answers") === undefined || isAnswerList(field(value, "answers")))
    && (field(value, "approvals") === undefined || isApprovalList(field(value, "approvals")))
    && ["createdAt", "updatedAt", "runStartedAt"].every((key) => optionalOf(field(value, key), timeText).ok)
    && optionalOf(field(value, "elapsedMs"), finiteNonNegative).ok;
}

/**
 * One goal file's content, or undefined when pi-goal would not load it. The checks follow
 * pi-goal's own (`restoreGoals` in its src/index.ts): a file pi-goal skips is skipped here too,
 * so the page rarely offers a command for a goal the session does not have. pi-goal's template
 * checks (the 64 KiB limit and the structured design fields) are not repeated: such a goal is
 * drawn, and pi-goal answers a command for it with its own "no goal #N" notice. `uuid` is the file's name, which the content must repeat;
 * `workspace` is the directory the file was read under (older files omit it).
 */
export function parseGoalRecord(value: unknown, uuid: string, workspace: string): GoalRecord | undefined {
  const id = positiveInteger(field(value, "id"));
  const text = nonEmptyText(field(value, "text"));
  const status = oneOf(GOAL_STATUSES, field(value, "status"));
  const todos = parseTodos(field(value, "todos"));
  if (!UUID_V7.test(uuid) || field(value, "uuid") !== uuid || id === undefined || text === undefined || status === undefined || todos === undefined || !optionalFieldsValid(value)) return undefined;
  const elapsed = finiteNonNegative(field(value, "elapsedMs")) ?? 0;
  const sessionId = nonEmptyText(field(value, "sessionId"));
  const updatedAt = timeText(field(value, "updatedAt"));
  const runStartedAt = timeText(field(value, "runStartedAt"));
  return {
    uuid,
    id,
    text,
    status,
    workspace,
    planConfirmed: field(value, "planConfirmed") === true,
    todos,
    elapsedMs: elapsed,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(runStartedAt === undefined ? {} : { runStartedAt }),
  };
}

function parseWorkspaceGoals(value: unknown): WorkspaceGoals | undefined {
  const directory = nonEmptyText(field(value, "directory"));
  const goals = field(value, "goals");
  const skipped = field(value, "skipped");
  if (directory === undefined || !Array.isArray(goals) || typeof skipped !== "number") return undefined;
  const parsed = goals.map((goal) => parseGoalRecord(goal, String(field(goal, "uuid")), directory));
  if (!parsed.every((goal): goal is GoalRecord => goal !== undefined)) return undefined;
  return { directory, goals: parsed, skipped };
}

/** The server's answer for one workspace as the page received it; undefined when it is not one. */
export function parseWorkspaceGoalsRead(value: unknown): WorkspaceGoalsRead | undefined {
  if (field(value, "state") === "failed") {
    const directory = nonEmptyText(field(value, "directory"));
    const error = field(value, "error");
    return directory === undefined || typeof error !== "string" ? undefined : { state: "failed", directory, error };
  }
  if (field(value, "state") !== "ready") return undefined;
  const workspace = parseWorkspaceGoals(value);
  return workspace === undefined ? undefined : { state: "ready", ...workspace };
}

/** The server's answer for every workspace as the page received it; undefined when it is not one. */
export function parseAllGoalsRead(value: unknown): AllGoalsRead | undefined {
  if (field(value, "state") === "failed") {
    const error = field(value, "error");
    return typeof error === "string" ? { state: "failed", error } : undefined;
  }
  const workspaces = field(value, "workspaces");
  const skippedWorkspaces = field(value, "skippedWorkspaces");
  if (field(value, "state") !== "ready" || !Array.isArray(workspaces) || typeof skippedWorkspaces !== "number") return undefined;
  const parsed = workspaces.map(parseWorkspaceGoals);
  if (!parsed.every((workspace): workspace is WorkspaceGoals => workspace !== undefined)) return undefined;
  return { state: "ready", workspaces: parsed, skippedWorkspaces };
}
