import type { PluginListModel, PluginListRead, PluginListRow } from "@gang-of-beads/pi-web/plugin-api";

/**
 * What the background list shows for each task, decided in one place.
 *
 * The first list this plugin drew was bare spans, so a row read "Install pi-web .26 when
 * publishedlost" - name and status run together, four hundred of them, over the transcript.
 * The rows are now a pure classification the element only renders: the tool's status maps to
 * a named tone and a reader's word through one table, running work comes first, and a long
 * history is cut to the newest rows with the rest counted rather than silently dropped.
 */

export type TaskTone = "running" | "done" | "problem" | "unknown";

export type TasksRead = "unread" | "read" | "failed";

export interface TaskInput {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly startedAt?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly exitCode?: number | undefined;
}

export interface TaskRow {
  readonly id: string;
  readonly name: string;
  readonly tone: TaskTone;
  readonly label: string;
  readonly detail: string;
  readonly startedAt?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly exitCode?: number | undefined;
}

export interface TaskList {
  readonly running: readonly TaskRow[];
  readonly finished: readonly TaskRow[];
  readonly hiddenFinished: number;
}

const STATUS: Record<string, { tone: TaskTone; label: string }> = {
  running: { tone: "running", label: "running" },
  completed: { tone: "done", label: "done" },
  failed: { tone: "problem", label: "failed" },
  killed: { tone: "problem", label: "stopped" },
  lost: { tone: "problem", label: "lost" },
  unknown: { tone: "unknown", label: "unknown" },
};

export const FINISHED_SHOWN = 30;

export function taskPresentation(status: string): { tone: TaskTone; label: string } {
  return STATUS[status] ?? { tone: "unknown", label: status === "" ? "unknown" : status };
}

export function durationLabel(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

function row(task: TaskInput): TaskRow {
  const presentation = taskPresentation(task.status);
  const parts = [durationLabel(task.durationMs), task.exitCode === undefined ? undefined : `exit ${String(task.exitCode)}`];
  return { id: task.id, name: task.name, ...presentation, detail: parts.filter((part) => part !== undefined).join(" · "), startedAt: task.startedAt, durationMs: task.durationMs, exitCode: task.exitCode };
}

function newestFirst(left: TaskInput, right: TaskInput): number {
  return (right.startedAt ?? "").localeCompare(left.startedAt ?? "");
}

export function backgroundTaskList(tasks: readonly TaskInput[], shown = FINISHED_SHOWN): TaskList {
  const running = tasks.filter((task) => task.status === "running").sort(newestFirst).map(row);
  const finished = tasks.filter((task) => task.status !== "running").sort(newestFirst);
  return {
    running,
    finished: finished.slice(0, shown).map(row),
    hiddenFinished: Math.max(0, finished.length - shown),
  };
}

/**
 * The page the host draws for this session's runs (owner, 2026-10-06: mockup A).
 *
 * Running work is one group and finished work another. A running row carries a
 * green "running"; a finished row its exit code as a plain value, or, when it
 * failed, the failure as a red status. The detail line is when it started and
 * how long it ran. An empty page is "none" only once the session was read;
 * before that it is still reading, and after a failed read it is unknown, with
 * any rows from an earlier read kept under the stale line.
 */
const LIST_READ: Readonly<Record<TasksRead, PluginListRead>> = { unread: "reading", read: "ready", failed: "failed" };

const LIST_WORDS = {
  empty: "This session has started no background runs.",
  reading: "Reading this session's background runs…",
  failed: "This machine could not read the background runs.",
  stale: "Could not refresh - showing the last read.",
} as const;

type RowSide = Pick<PluginListRow, "status" | "value">;

const exitWord = (row: TaskRow): string | undefined => row.exitCode === undefined ? undefined : `exit ${String(row.exitCode)}`;

const ROW_SIDE: Readonly<Record<TaskTone, (row: TaskRow) => RowSide>> = {
  running: (row) => ({ status: { label: row.label, tone: "good" } }),
  done: (row) => ({ value: exitWord(row) ?? row.label }),
  problem: (row) => ({ status: { label: exitWord(row) ?? row.label, tone: "problem" } }),
  unknown: (row) => ({ status: { label: row.label, tone: "neutral" } }),
};

export type ClockTime = (iso: string) => string | undefined;

export const localClockTime: ClockTime = (iso) => {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? undefined : new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

function rowDetail(row: TaskRow, clock: ClockTime, startedWord: string): string {
  const started = row.startedAt === undefined ? undefined : clock(row.startedAt);
  const parts = [started === undefined ? undefined : `${startedWord}${started}`, durationLabel(row.durationMs)];
  return parts.filter((part) => part !== undefined).join(" · ");
}

function listRow(row: TaskRow, clock: ClockTime, startedWord: string): PluginListRow {
  return { id: row.id, title: row.name, ...ROW_SIDE[row.tone](row), detail: rowDetail(row, clock, startedWord) };
}

export function backgroundListModel(tasks: readonly TaskInput[], read: TasksRead, clock: ClockTime = localClockTime): PluginListModel {
  const list = backgroundTaskList(tasks);
  const hidden = list.hiddenFinished;
  return {
    read: LIST_READ[read],
    words: LIST_WORDS,
    groups: [
      { id: "running", heading: "Running", rows: list.running.map((row) => listRow(row, clock, "started ")) },
      { id: "finished", heading: "Finished", rows: list.finished.map((row) => listRow(row, clock, "")) },
    ],
    notes: hidden === 0 ? [] : [`${String(hidden)} older ${hidden === 1 ? "run" : "runs"} not shown`],
  };
}
