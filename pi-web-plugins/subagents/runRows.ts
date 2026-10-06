import type { PluginListModel, PluginListRow } from "@gang-of-beads/pi-web/plugin-api";

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

type RowSide = Pick<PluginListRow, "status" | "value">;

const ROW_SIDE: Readonly<Record<RunPresentation["tone"], (presentation: RunPresentation) => RowSide>> = {
  running: (presentation) => ({ status: { label: presentation.label, tone: "good" } }),
  settled: (presentation) => ({ value: presentation.label }),
  problem: (presentation) => ({ status: { label: presentation.label, tone: "problem" } }),
  unknown: (presentation) => ({ status: { label: presentation.label, tone: "neutral" } }),
};

function listRow(row: SubagentRunRow): PluginListRow {
  const presentation = runPresentation(row);
  return { id: row.runId, title: row.task === undefined ? row.agent : `${row.agent}: ${row.task}`, ...ROW_SIDE[presentation.tone](presentation), detail: presentation.detail };
}

const LIST_WORDS = {
  empty: "This session has started no subagents.",
  reading: "Reading this session's subagents…",
  failed: "This machine could not read the runs.",
  stale: "Could not refresh - showing the last read.",
} as const;

/**
 * The page the host draws for this session's runs: running children in one
 * group, settled ones in another. A machine that could not say anything gives
 * its reason as the empty page's words; one whose latest refresh failed keeps
 * the last read under the stale line.
 */
export function subagentListModel(state: SubagentListState | undefined, refreshFailed: boolean): PluginListModel {
  if (state === undefined) return { read: "reading", groups: [], words: LIST_WORDS };
  if (state.kind === "unknown") return { read: "failed", groups: [], words: { ...LIST_WORDS, failed: state.reason } };
  const rows = state.kind === "rows" ? state.rows : [];
  return {
    read: refreshFailed ? "failed" : "ready",
    words: LIST_WORDS,
    groups: [
      { id: "running", heading: "Running", rows: rows.filter((row) => row.status === "running").map(listRow) },
      { id: "finished", heading: "Finished", rows: rows.filter((row) => row.status !== "running").map(listRow) },
    ],
  };
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
