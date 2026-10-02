import type { SessionActivity, SessionStatus } from "../../shared/apiTypes";
import type { SessionActivityCategory } from "../../shared/sessionActivityState";

/**
 * What the chat dock says, once its category is known (B14, state-diagram
 * D3). The category comes from `sessionActivityCategory`, as on every other
 * surface; these words are output only and decide nothing. The dock used to
 * decide its category from the activity's label when no status had arrived,
 * so a session whose last word was "stopped" showed working dots.
 */
export interface DockFacts {
  /** The step narration, when the daemon publishes steps and the session works. */
  narrated?: string;
  activity?: SessionActivity;
  status?: SessionStatus;
  /** Whether there is work a reader could stop (`isSessionActive`). */
  stoppable: boolean;
}

const CATEGORY_WORDS: Readonly<Record<SessionActivityCategory, (facts: DockFacts) => string>> = {
  working: (facts) => workWords(facts),
  asking: (facts) => (facts.stoppable ? workWords(facts) : "Waiting for your answer"),
  background: () => "idle",
  idle: (facts) => activityWords(facts.activity) ?? "idle",
  error: (facts) => activityWords(facts.activity) ?? "error",
};

/** The status's own word for the work it reports, most specific first. */
const STATUS_WORK_WORDS: readonly (readonly [(status: SessionStatus) => boolean, string])[] = [
  [(status) => status.isCompacting, "compacting"],
  [(status) => status.isBashRunning, "bash"],
  [(status) => status.isStreaming, "running"],
  [(status) => status.pendingMessageCount > 0, "queued"],
];

export function activityDockWords(category: SessionActivityCategory, facts: DockFacts): string {
  return CATEGORY_WORDS[category](facts);
}

function workWords(facts: DockFacts): string {
  if (facts.narrated !== undefined) return facts.narrated;
  if (facts.activity?.phase === "active") return activityWords(facts.activity) ?? "working";
  return statusWorkWord(facts.status) ?? activityWords(facts.activity) ?? "working";
}

function statusWorkWord(status: SessionStatus | undefined): string | undefined {
  if (status === undefined) return undefined;
  return STATUS_WORK_WORDS.find(([applies]) => applies(status))?.[1];
}

function activityWords(activity: SessionActivity | undefined): string | undefined {
  if (activity === undefined) return undefined;
  return activity.detail !== undefined && activity.detail !== "" ? `${activity.label}: ${activity.detail}` : activity.label;
}
