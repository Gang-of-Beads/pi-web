/**
 * What one subagent run says on a row.
 *
 * The parent conversation could not answer "what are my children doing" in the
 * browser at all: the reader existed, nothing rendered it. The presentation is
 * a pure classifier so every state is named once and enumerated in tests -
 * including the two that are not outcomes: a run that went silent, and a
 * reader that has not been told anything yet.
 */

export interface SubagentRunRow {
  runId: string;
  agent: string;
  status: "running" | "done" | "failed" | "lost" | "unknown";
  elapsedMs: number;
  startedAt: string;
  lastActivity?: string;
  task?: string;
  model?: string;
  toolCount?: number;
  hasOutput: boolean;
}

export type SubagentListState =
  | { kind: "unknown"; reason: string }
  | { kind: "empty" }
  | { kind: "rows"; rows: SubagentRunRow[]; running: number };

export interface RunPresentation {
  label: string;
  tone: "running" | "settled" | "problem" | "unknown";
  detail: string;
}

export function subagentListState(answer: unknown): SubagentListState {
  if (typeof answer !== "object" || answer === null) return { kind: "unknown", reason: "The machine did not answer." };
  if (Reflect.get(answer, "known") !== true) {
    const reason: unknown = Reflect.get(answer, "reason");
    return { kind: "unknown", reason: reason === "no-session" ? "Open a session to see its subagents." : "This machine could not read the runs." };
  }
  const raw: unknown = Reflect.get(answer, "runs");
  if (!Array.isArray(raw)) return { kind: "unknown", reason: "This machine answered without a run list." };
  const rows: SubagentRunRow[] = raw.filter(isRunRow);
  if (rows.length === 0) return { kind: "empty" };
  return { kind: "rows", rows, running: rows.filter((row) => row.status === "running").length };
}

export function runPresentation(row: SubagentRunRow): RunPresentation {
  const elapsed = formatElapsed(row.elapsedMs);
  const activity = row.lastActivity === undefined || row.lastActivity === "" ? undefined : row.lastActivity;
  if (row.status === "running") {
    return { label: "Working", tone: "running", detail: activity === undefined ? `${elapsed} so far` : `${elapsed} · ${activity}` };
  }
  if (row.status === "done") return { label: "Done", tone: "settled", detail: `${elapsed}${row.hasOutput ? "" : " · no output written"}` };
  if (row.status === "failed") return { label: "Failed", tone: "problem", detail: `${elapsed}${activity === undefined ? "" : ` · ${activity}`}` };
  if (row.status === "lost") {
    return { label: "Lost", tone: "problem", detail: `Wrote for ${elapsed}, then went silent without an outcome` };
  }
  return { label: "Unknown", tone: "unknown", detail: "Started; this machine has no outcome for it" };
}

export function formatElapsed(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "unknown";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

function isRunRow(value: unknown): value is SubagentRunRow {
  if (typeof value !== "object" || value === null) return false;
  const runId: unknown = Reflect.get(value, "runId");
  const agent: unknown = Reflect.get(value, "agent");
  const status: unknown = Reflect.get(value, "status");
  return typeof runId === "string"
    && typeof agent === "string"
    && (status === "running" || status === "done" || status === "failed" || status === "lost" || status === "unknown");
}
