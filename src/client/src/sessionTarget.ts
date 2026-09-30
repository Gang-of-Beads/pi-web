import type { SessionInfo } from "../../shared/apiTypes";
import type { SessionLocation } from "./api/clients";
import { LOCAL_MACHINE_ID } from "./machineKeys";
import { classifyReadError, type ReadFact, type ReadMiss } from "./sync/readPhase";
import type { Unanswered } from "./sync/scopedResource";

/**
 * Whether the session a link, a restore or a pick names can be opened,
 * decided from typed answers only (state-diagram D8, "The target of a session
 * link"; P2 slice b, B31).
 *
 * Before, a named session missing from the listing fell through to the latest
 * one, so a link to a deleted session opened a different session while the
 * URL still named the deleted one. Absence from a listing is `asking`; only
 * the daemon's locate answer settles it.
 */
export type SessionTarget =
  | { readonly kind: "open"; readonly session: SessionInfo }
  | { readonly kind: "archived"; readonly session: SessionInfo }
  | { readonly kind: "folder-gone"; readonly session: SessionInfo }
  | { readonly kind: "asking"; readonly sessionId: string }
  | { readonly kind: "unknown"; readonly sessionId: string; readonly miss: ReadMiss }
  | { readonly kind: "gone"; readonly sessionId: string }
  | { readonly kind: "not-listed"; readonly sessionId: string }
  | { readonly kind: "refused"; readonly sessionId: string; readonly fact: "signed-out" | "forbidden" };

/** Where a named session was asked for: the machine, the workspace and its cwd, and the id. */
export interface SessionTargetScope {
  readonly machineId: string;
  readonly workspaceId: string;
  readonly cwd: string;
  readonly sessionId: string;
}

/** A target with the scope it belongs to; it renders, and acts, only while that scope is the selection. */
export interface ScopedSessionTarget extends SessionTargetScope {
  readonly target: SessionTarget;
  /** When the locate first went unanswered, for the app row's grace; retries do not restart it. */
  readonly unansweredSince?: number | undefined;
}

/** The parts of the selection a target is scoped by. */
export interface TargetSelection {
  readonly selectedMachine?: { readonly id: string } | undefined;
  readonly selectedWorkspace?: { readonly id: string } | undefined;
  readonly selectedSession?: { readonly id: string } | undefined;
  readonly sessionTarget: ScopedSessionTarget | undefined;
}

/** The named target of the current selection while no session is selected. Another machine's or workspace's target never shows, and never acts. */
export function targetInScope(selection: TargetSelection): ScopedSessionTarget | undefined {
  const { sessionTarget } = selection;
  if (sessionTarget === undefined || selection.selectedSession !== undefined) return undefined;
  const sameMachine = sessionTarget.machineId === (selection.selectedMachine?.id ?? LOCAL_MACHINE_ID);
  return sameMachine && sessionTarget.workspaceId === selection.selectedWorkspace?.id ? sessionTarget : undefined;
}

/**
 * The session the reader's place names: the selected one, or the named target
 * still on screen. The URL, back and forward, and the machine memory all read
 * this one value, so none of them forgets a target the page is showing (D8).
 */
export function placeSessionId(selection: TargetSelection): string | undefined {
  return selection.selectedSession?.id ?? targetInScope(selection)?.sessionId;
}

/** A named target the daemon has not answered, as a claim for the app row, which says why after its grace (B48). */
export function targetUnanswered(target: ScopedSessionTarget | undefined): Unanswered | undefined {
  if (target?.target.kind !== "unknown" || target.unansweredSince === undefined) return undefined;
  return { miss: target.target.miss, since: target.unansweredSince };
}

/** The named session as the answered listing has it, or `asking` when the listing does not: absence is not an answer. */
export function targetInListing(sessions: readonly SessionInfo[], sessionId: string): SessionTarget {
  const session = sessions.find((candidate) => candidate.id === sessionId) ?? sessions.find((candidate) => candidate.id.startsWith(sessionId));
  return session === undefined ? { kind: "asking", sessionId } : targetOf(session);
}

/** What the daemon's locate answer makes of the target; a daemon older than the route leaves the listing as the only evidence. */
export function targetFromLocation(sessionId: string, location: SessionLocation): SessionTarget {
  return location.kind === "found" ? targetOf(location.session) : { kind: "not-listed", sessionId };
}

/** A failed locate: the daemon's code is `gone`, a stated refusal is final, and anything else is unknown and asked again. */
export function targetFromLocateError(sessionId: string, error: unknown): SessionTarget {
  const outcome = classifyReadError(error);
  if (outcome.kind === "miss") return { kind: "unknown", sessionId, miss: outcome.miss };
  return TARGET_BY_FACT[outcome.fact.kind](sessionId);
}

const TARGET_BY_FACT = {
  none: (sessionId) => ({ kind: "unknown", sessionId, miss: { kind: "link-down" } }),
  gone: (sessionId) => ({ kind: "gone", sessionId }),
  "signed-out": (sessionId) => ({ kind: "refused", sessionId, fact: "signed-out" }),
  forbidden: (sessionId) => ({ kind: "refused", sessionId, fact: "forbidden" }),
} satisfies Record<ReadFact["kind"], (sessionId: string) => SessionTarget>;

const RESOLVED = {
  open: true,
  archived: true,
  "folder-gone": true,
  asking: false,
  unknown: false,
  gone: true,
  "not-listed": true,
  refused: true,
} satisfies Record<SessionTarget["kind"], boolean>;

/** Whether the target has its answer; one that does not is asked again on the read ladder, never given up on (B48). */
export function isResolved(target: SessionTarget): boolean {
  return RESOLVED[target.kind];
}

function targetOf(session: SessionInfo): SessionTarget {
  if (session.cwdMissing === true) return { kind: "folder-gone", session };
  return session.archived === true ? { kind: "archived", session } : { kind: "open", session };
}
