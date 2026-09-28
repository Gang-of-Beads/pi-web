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
  return { id: task.id, name: task.name, ...presentation, detail: parts.filter((part) => part !== undefined).join(" · ") };
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
