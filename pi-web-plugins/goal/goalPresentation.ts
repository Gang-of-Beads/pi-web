import type { PluginListTone, PluginSessionCommandOutcome } from "@gang-of-beads/pi-web/plugin-api";
import type { GoalRecord, GoalStatus, GoalTodoRecord, GoalTodoStatus } from "./goalRecords.js";

/**
 * How the Goal pages say what a goal and its TODOs are, and which commands a goal offers.
 *
 * Every decision is one table keyed by pi-goal's states, so a state pi-goal adds fails to compile
 * here instead of drawing as another. The order follows pi-goal's own list: what needs the reader
 * first (running, awaiting review), finished goals last.
 */
export interface GoalStatusPresentation {
  readonly label: string;
  readonly tone: PluginListTone;
  readonly order: number;
  readonly finished: boolean;
}

export const GOAL_STATUS: Readonly<Record<GoalStatus, GoalStatusPresentation>> = {
  running: { label: "running", tone: "good", order: 0, finished: false },
  review: { label: "awaiting review", tone: "attention", order: 1, finished: false },
  paused: { label: "paused", tone: "neutral", order: 2, finished: false },
  clarifying: { label: "awaiting clarification", tone: "attention", order: 3, finished: false },
  pending: { label: "ready to run", tone: "neutral", order: 4, finished: false },
  done: { label: "done", tone: "good", order: 5, finished: true },
  cancelled: { label: "cancelled", tone: "neutral", order: 6, finished: true },
};

export type TodoMark = "check" | "play" | "cross" | "ring";

export interface TodoPresentation {
  readonly mark: TodoMark;
  readonly label: string;
  readonly color: string;
}

export const TODO_STATUS: Readonly<Record<GoalTodoStatus, TodoPresentation>> = {
  done: { mark: "check", label: "done", color: "var(--pi-success)" },
  running: { mark: "play", label: "in progress", color: "var(--pi-accent)" },
  blocked: { mark: "cross", label: "blocked", color: "var(--pi-danger)" },
  pending: { mark: "ring", label: "pending", color: "var(--pi-muted)" },
};

export function sortGoals(goals: readonly GoalRecord[]): GoalRecord[] {
  return [...goals].sort((a, b) => GOAL_STATUS[a.status].order - GOAL_STATUS[b.status].order
    || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
    || b.id - a.id);
}

export function goalTitle(goal: GoalRecord): string {
  return `#${String(goal.id)} ${goal.text.split("\n")[0]?.trim() ?? ""}`;
}

export function progressText(goal: GoalRecord): string {
  if (!goal.planConfirmed || goal.todos.length === 0) return "No confirmed TODOs";
  const done = goal.todos.filter((todo) => todo.status === "done").length;
  return `TODO ${String(done)}/${String(goal.todos.length)}`;
}

/** Execution time so far: finished runs plus the current one while it runs. */
export function elapsedMs(goal: GoalRecord, now: number): number {
  const started = goal.status === "running" && goal.runStartedAt !== undefined ? Date.parse(goal.runStartedAt) : Number.NaN;
  return goal.elapsedMs + (Number.isFinite(started) ? Math.max(0, now - started) : 0);
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${String(minutes)}m` : `${String(hours)}h ${String(minutes % 60)}m`;
}

/** The TODO a reader looks for first: the one in progress, else the first not done. */
export function currentTodo(goal: GoalRecord): GoalTodoRecord | undefined {
  return goal.todos.find((todo) => todo.status === "running") ?? goal.todos.find((todo) => todo.status !== "done");
}

export type GoalCommand = "run" | "pause" | "status";

/**
 * The commands a goal offers on the page, with pi-goal's own rules for its panel keys: a running
 * goal pauses, a goal that is done, paused or cancelled has nothing to pause, every other goal runs
 * (or continues clarifying when its plan is not confirmed). pi-goal checks again when the command
 * arrives, so a stale page can only ask, never force.
 */
const STATUS_COMMANDS: Readonly<Record<GoalStatus, readonly GoalCommand[]>> = {
  running: ["pause", "status"],
  review: ["run", "pause", "status"],
  paused: ["run", "status"],
  clarifying: ["run", "pause", "status"],
  pending: ["run", "pause", "status"],
  done: ["status"],
  cancelled: ["status"],
};

export function goalCommands(goal: GoalRecord): readonly GoalCommand[] {
  return STATUS_COMMANDS[goal.status];
}

export function commandLabel(command: GoalCommand, goal: GoalRecord): string {
  if (command === "pause") return "Pause";
  if (command === "status") return "Status in chat";
  if (!goal.planConfirmed || goal.todos.length === 0) return "Clarify";
  return goal.status === "pending" ? "Run" : "Continue";
}

export function commandArgs(command: GoalCommand, goal: GoalRecord): string {
  return `${command} #${String(goal.id)}`;
}

export type FeedbackTone = "info" | "problem";

export interface CommandFeedback {
  readonly tone: FeedbackTone;
  readonly text: string;
}

const NOTICE_TONE: Readonly<Record<"info" | "warning" | "error", FeedbackTone>> = { info: "info", warning: "problem", error: "problem" };

/**
 * What the page says after a command, from the host's verdict: pi-goal's own notices when it ran,
 * and the host's words otherwise. `quietWords` stand in for notices the reader sees in the chat
 * anyway (the status text), but only when every notice was info: a warning is always shown. `waiting` and `unknown` say only what is known, and the page reads
 * the goals again either way.
 */
export function commandFeedback(outcome: PluginSessionCommandOutcome, quietWords?: string): CommandFeedback {
  if (outcome.kind === "ran") {
    if (quietWords !== undefined && outcome.notices.every((notice) => notice.level === "info")) return { tone: "info", text: quietWords };
    const last = outcome.notices.at(-1);
    return last === undefined ? { tone: "info", text: "Sent to the session." } : { tone: NOTICE_TONE[last.level], text: last.message };
  }
  if (outcome.kind === "waiting") return { tone: "info", text: "Sent; the session has not answered yet. It may be waiting for a reply in the chat." };
  const words: unknown = Reflect.get(outcome, "words");
  return { tone: "problem", text: typeof words === "string" && words !== "" ? words : "The session gave an answer this page does not know; read the chat for what happened." };
}

/**
 * Whether the page can act in the folder it shows: a session of that folder is on screen and this
 * PI WEB lets pages run its commands. Each state has its own words, so an old host is never told
 * to open a session it already has open.
 */
export type CommandAvailability = "ready" | "no-session" | "host-too-old";

export function commandAvailability(session: { readonly runCommand?: unknown } | undefined): CommandAvailability {
  if (session === undefined) return "no-session";
  return session.runCommand === undefined ? "host-too-old" : "ready";
}

export const AVAILABILITY_WORDS: Readonly<Record<Exclude<CommandAvailability, "ready">, { readonly note: string; readonly placeholder: string; readonly toolbar: string }>> = {
  "no-session": {
    note: "Open a session in this folder to run or pause goals from here.",
    placeholder: "Open a session here to add goals",
    toolbar: "read-only, no session here",
  },
  "host-too-old": {
    note: "This PI WEB cannot run commands from pages; update it to run or pause goals from here.",
    placeholder: "Update PI WEB to add goals from this page",
    toolbar: "read-only on this PI WEB",
  },
};
