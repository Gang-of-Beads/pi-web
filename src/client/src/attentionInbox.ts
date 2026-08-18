import type { SessionInfo } from "./api";

/**
 * "Where do I need to act?", across every machine.
 *
 * The quick switcher answers this for the machine you happen to have selected,
 * which is the wrong scope for the question: an agent that finished on the
 * laptop while you were looking at the desktop is exactly the one you have lost
 * track of. This ranks the same signals across machines so nothing needing a
 * person is hidden behind a machine picker.
 *
 * Pure, so the ordering rules are testable without any of the transports.
 */

export type AttentionReason =
  /** Blocked on an `ask_user` answer: cannot progress at all without a person. */
  | "waiting"
  /** A run failed and stopped; the work is not going to finish on its own. */
  | "failed"
  /** Finished with output nobody has read. */
  | "unread"
  /** Still working; may need a person soon, but not yet. */
  | "running";

export interface AttentionCandidate {
  session: SessionInfo;
  machineId: string;
  machineName: string;
  reason: AttentionReason;
}

export interface AttentionInboxInput {
  /** Sessions per machine, as loaded from each machine's listing. */
  sessionsByMachine: ReadonlyMap<string, readonly SessionInfo[]>;
  machineNames: ReadonlyMap<string, string>;
  waitingSessionIds: ReadonlySet<string>;
  failedSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
  runningSessionIds: ReadonlySet<string>;
}

/**
 * Order of urgency. Blocked work cannot move without a person, failed work will
 * never move, unread output is the reason the inbox was opened, and running
 * work is listed last because it is still making progress.
 */
const REASON_ORDER: readonly AttentionReason[] = ["waiting", "failed", "unread", "running"];

/**
 * Everything needing attention, most urgent first, most recently touched first
 * within a reason.
 *
 * A session appears once, under its most urgent reason: a run that failed while
 * holding an unanswered question is listed as blocked, not twice.
 */
export function attentionInbox(input: AttentionInboxInput): AttentionCandidate[] {
  const candidates: AttentionCandidate[] = [];

  for (const [machineId, sessions] of input.sessionsByMachine) {
    for (const session of sessions) {
      if (session.archived === true) continue;
      const reason = attentionReason(session.id, input);
      if (reason === undefined) continue;
      candidates.push({
        session,
        machineId,
        machineName: input.machineNames.get(machineId) ?? machineId,
        reason,
      });
    }
  }

  return candidates.sort((left, right) => {
    const byReason = REASON_ORDER.indexOf(left.reason) - REASON_ORDER.indexOf(right.reason);
    if (byReason !== 0) return byReason;
    return modifiedAt(right.session) - modifiedAt(left.session);
  });
}

/** The most urgent reason a session needs a person, if any. */
export function attentionReason(sessionId: string, input: AttentionInboxInput): AttentionReason | undefined {
  if (input.waitingSessionIds.has(sessionId)) return "waiting";
  if (input.failedSessionIds.has(sessionId)) return "failed";
  if (input.unreadSessionIds.has(sessionId)) return "unread";
  if (input.runningSessionIds.has(sessionId)) return "running";
  return undefined;
}

/** How the reason reads to the user; the inbox is useless if it only shows ids. */
export function attentionReasonLabel(reason: AttentionReason): string {
  switch (reason) {
    case "waiting": return "Waiting for you";
    case "failed": return "Stopped with an error";
    case "unread": return "Finished";
    case "running": return "Working";
  }
}

/** Count of sessions that cannot progress without a person, for a badge. */
export function blockedCount(candidates: readonly AttentionCandidate[]): number {
  return candidates.filter((candidate) => candidate.reason === "waiting" || candidate.reason === "failed").length;
}

function modifiedAt(session: SessionInfo): number {
  const parsed = Date.parse(session.modified);
  return Number.isNaN(parsed) ? 0 : parsed;
}
