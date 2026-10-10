import { isRecord } from "../../../shared/unknownValues.js";

/**
 * Where a failed attempt pi took back to try again stands, per session (state-diagram D11).
 *
 * Owner, 2026-09-30: "don't show the errors from before the retries have completely failed";
 * Q16, 2026-10-10: a failure no retry replaced is the turn's outcome, a Stop during the wait
 * included. pi takes an errored reply back in two places, auto-retry and overflow recovery, both
 * by appending a `context_edit` with no replacement. A session file cannot tell afterwards whether
 * the retry pi promised ever came, so the daemon decides it here, from pi's live events, and
 * records an attempt nothing replaced.
 */
export type RetryRecovery =
  | { readonly kind: "clear" }
  | { readonly kind: "pending"; readonly attempts: readonly string[] };

export type RetryRecoveryEvent =
  | { readonly kind: "taken-back"; readonly attempt: string }
  | { readonly kind: "reply-landed" }
  | { readonly kind: "ended"; readonly reason: string };

export type RetryRecoveryEffect =
  | { readonly kind: "hide"; readonly attempts: readonly string[] }
  | { readonly kind: "unreplaced"; readonly attempts: readonly string[]; readonly reason: string };

export interface RetryRecoveryStep {
  readonly state: RetryRecovery;
  readonly effects: readonly RetryRecoveryEffect[];
}

const CLEAR: RetryRecovery = { kind: "clear" };
const NO_ATTEMPTS: ReadonlySet<string> = new Set();

export const RETRY_REASON_RUN_ENDED = "The run ended before the retry.";
export const RETRY_REASON_SESSION_CLOSED = "The session closed before the retry.";
export const RETRY_REASON_REOPENED = "The retry did not run: the session was opened again before it.";

/** A take-back hides the attempt; any newer reply replaces what is pending; an end with none leaves it unreplaced. */
export function retryRecoveryStep(state: RetryRecovery, event: RetryRecoveryEvent): RetryRecoveryStep {
  if (event.kind === "taken-back") {
    const attempts = [...(state.kind === "pending" ? state.attempts : []), event.attempt];
    return { state: { kind: "pending", attempts }, effects: [{ kind: "hide", attempts: [event.attempt] }] };
  }
  if (state.kind === "clear") return { state, effects: [] };
  if (event.kind === "reply-landed") return { state: CLEAR, effects: [] };
  return { state: CLEAR, effects: [{ kind: "unreplaced", attempts: state.attempts, reason: event.reason }] };
}

type EventReader = (event: Record<string, unknown>, isErroredReply: (entryId: string) => boolean) => RetryRecoveryEvent | undefined;

const RECOVERY_EVENTS: Readonly<Record<string, EventReader>> = {
  entry_appended: (event, isErroredReply) => {
    const entry = event["entry"];
    if (!isRecord(entry) || entry["type"] !== "context_edit" || entry["replacement"] !== null) return undefined;
    const target = entry["targetId"];
    return typeof target === "string" && isErroredReply(target) ? { kind: "taken-back", attempt: target } : undefined;
  },
  message_end: (event) => (isRecord(event["message"]) && event["message"]["role"] === "assistant" ? { kind: "reply-landed" } : undefined),
  auto_retry_end: (event) => (event["success"] === true ? undefined : { kind: "ended", reason: textOr(event["finalError"], RETRY_REASON_RUN_ENDED) }),
  compaction_end: (event) => {
    if (event["reason"] !== "overflow" || event["willRetry"] === true) return undefined;
    return { kind: "ended", reason: event["aborted"] === true ? "Retry cancelled" : textOr(event["errorMessage"], RETRY_REASON_RUN_ENDED) };
  },
  agent_settled: () => ({ kind: "ended", reason: RETRY_REASON_RUN_ENDED }),
};

/** The recovery event a pi session event is, if any; `isErroredReply` says whether an entry is an assistant reply that ended in an error. */
export function retryRecoveryEventOf(event: unknown, isErroredReply: (entryId: string) => boolean): RetryRecoveryEvent | undefined {
  if (!isRecord(event) || typeof event["type"] !== "string" || !Object.hasOwn(RECOVERY_EVENTS, event["type"])) return undefined;
  return RECOVERY_EVENTS[event["type"]]?.(event, isErroredReply);
}

/**
 * Each open runtime's recovery. Keyed by the runtime's session object, so a reopened session
 * starts clear; its first run settles an attempt its file left waiting (a daemon restart in the
 * wait), which no retry of this runtime can replace, before a newer reply would hide it.
 */
export class RetryRecoveries {
  private readonly states = new WeakMap<object, RetryRecovery>();
  private readonly started = new WeakSet();

  observe(session: object, event: RetryRecoveryEvent): readonly RetryRecoveryEffect[] {
    const step = retryRecoveryStep(this.states.get(session) ?? CLEAR, event);
    this.states.set(session, step.state);
    return step.effects;
  }

  firstRun(session: object, awaiting: () => readonly string[]): readonly RetryRecoveryEffect[] {
    if (this.started.has(session)) return [];
    this.started.add(session);
    const attempts = awaiting();
    return attempts.length === 0 ? [] : [{ kind: "unreplaced", attempts, reason: RETRY_REASON_REOPENED }];
  }

  pending(session: object): ReadonlySet<string> {
    const state = this.states.get(session);
    return state?.kind === "pending" ? new Set(state.attempts) : NO_ATTEMPTS;
  }
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}
