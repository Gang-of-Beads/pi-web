/**
 * What a background task's terminal notification says to a reader.
 *
 * The frame is the daemon's own task record. The transcript used to show it as
 * "Unrecognized message" because nobody claimed the tag; the domain belongs
 * here, so the words do too.
 */

export type TaskOutcome = "completed" | "failed" | "killed" | "running" | "unknown";

export interface TaskNotice {
  name: string;
  outcome: TaskOutcome;
  detail: string | undefined;
}

const OUTCOMES: Record<string, TaskOutcome> = {
  completed: "completed",
  failed: "failed",
  killed: "killed",
  running: "running",
};

function readString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value: unknown = Reflect.get(payload, key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function readNumber(payload: unknown, key: string): number | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value: unknown = Reflect.get(payload, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function taskNotice(payload: unknown): TaskNotice {
  const name = readString(payload, "name") ?? readString(payload, "id") ?? "Background task";
  const outcome = OUTCOMES[readString(payload, "status") ?? ""] ?? "unknown";
  return { name, outcome, detail: noticeDetail(outcome, readNumber(payload, "exitCode")) };
}

function noticeDetail(outcome: TaskOutcome, exitCode: number | undefined): string | undefined {
  if (outcome === "running") return undefined;
  if (exitCode === undefined) return outcome === "unknown" ? "no status reported" : undefined;
  return `exit ${String(exitCode)}`;
}

export function noticeLabel(notice: TaskNotice): string {
  const state = notice.outcome === "unknown" ? "reported" : notice.outcome === "running" ? "still running" : notice.outcome;
  return notice.detail === undefined ? `${notice.name} ${state}` : `${notice.name} ${state} · ${notice.detail}`;
}
