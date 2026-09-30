import type { PluginSessionStatus } from "@gang-of-beads/pi-web/plugin-api";

/**
 * When the subagents panel reads its run list again (object model §4.3, idle
 * traffic).
 *
 * The panel read `runs.list` every 3 s for as long as it followed a session,
 * and it follows one whenever any workspace panel is open, because the tab's
 * badge asks. With a session sitting idle that was 20 reads a minute, and each
 * answer re-rendered the app, which re-read the session pins as well: 40-47
 * requests a minute on 8505 with the git or files panel open and nothing
 * happening. A run list changes only while the session works, and the host's
 * status says when that is: a turn is streaming, or runs are still counted.
 * That is narrower than the shell's own "active" on purpose: compacting, a
 * reader's shell command or a queued message start no run.
 *
 * The panel therefore polls only while the session it shows works, and reads
 * once on the edges: when it starts following (or follows again after the
 * plugin forgot what it saw), when work starts, and when work ends. An unknown
 * status is no news: it neither starts a poll nor counts as a change, so the
 * read a new selection already makes is not doubled when its status lands.
 */
export type RunsActivity = "unknown" | "idle" | "working";

/** What the panel last recorded for the session it follows; `unfollowed` before it has, or after it forgot. */
export type FollowedActivity = "unfollowed" | RunsActivity;

export interface RunsPollingDecision {
  readonly read: boolean;
  readonly poll: boolean;
}

const DECISIONS = {
  unfollowed: {
    unknown: { read: true, poll: false },
    idle: { read: true, poll: false },
    working: { read: true, poll: true },
  },
  unknown: {
    unknown: { read: false, poll: false },
    idle: { read: false, poll: false },
    working: { read: false, poll: true },
  },
  idle: {
    unknown: { read: false, poll: false },
    idle: { read: false, poll: false },
    working: { read: true, poll: true },
  },
  working: {
    unknown: { read: false, poll: true },
    idle: { read: true, poll: false },
    working: { read: false, poll: true },
  },
} as const satisfies Record<FollowedActivity, Record<RunsActivity, RunsPollingDecision>>;

export function runsActivityOf(status: PluginSessionStatus | undefined): RunsActivity {
  if (status === undefined) return "unknown";
  return status.isStreaming || (status.backgroundRunCount ?? 0) > 0 ? "working" : "idle";
}

export function runsPollingDecision(previous: FollowedActivity, next: RunsActivity): RunsPollingDecision {
  return DECISIONS[previous][next];
}

/** What to record after a follow: an unknown status keeps what was known before it. */
export function followedAfter(previous: FollowedActivity, next: RunsActivity): RunsActivity {
  return next === "unknown" && previous !== "unfollowed" ? previous : next;
}

/** Answers the host was asked to draw without drawing the panel or its badge, after which nobody is watching. */
export const UNSEEN_ANSWERS_BEFORE_STOP = 2;
