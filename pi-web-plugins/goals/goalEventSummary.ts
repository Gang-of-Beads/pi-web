/**
 * What a goal lifecycle message says to a reader.
 *
 * These carried no renderer, so the transcript drew "Unrecognized message" for
 * the goal plugin's own domain. The goal surface belongs to this plugin, so
 * the words for its events do too.
 */

export interface GoalEventSummary {
  title: string;
  detail: string | undefined;
}

const TITLES: Record<string, string> = {
  "pi-goal-audit-event": "Goal audit",
  "pi-goal-guard": "Goal guard",
  "pi-goal-draft": "Goal draft",
  "pi-goal-focus": "Goal focus",
};

const PHASES: Record<string, string> = {
  start: "started",
  started: "started",
  complete: "complete",
  completed: "complete",
  rejected: "rejected",
  passed: "passed",
};

function read(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value: unknown = Reflect.get(payload, key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function goalEventSummary(tag: string, payload: unknown, content?: string): GoalEventSummary {
  const title = TITLES[tag] ?? "Goal event";
  const phase = read(payload, "phase");
  const parts = [
    phase === undefined ? undefined : PHASES[phase] ?? phase,
    read(payload, "auditor"),
    read(payload, "reason"),
    read(payload, "goalId") ?? read(payload, "focusedGoalId"),
  ].filter((part): part is string => part !== undefined);
  if (parts.length > 0) return { title, detail: parts.join(" · ") };
  const line = (content ?? "").trim().split("\n")[0] ?? "";
  return { title, detail: line === "" ? undefined : line.slice(0, 120) };
}
