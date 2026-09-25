/**
 * Why a turn stopped, for the row that reports it.
 *
 * An aborted turn arrives as pi's own words - "Request was aborted" - plus a
 * footer naming the account. Nothing said who stopped it, so a reader could not
 * tell their own Stop from another device's or a reload: reported as "看不出来是
 * interrupted 还是什么问题，感觉总是自己报这个错".
 *
 * The cause is recorded when the stop happens and read back when the failure
 * row is built, which is a moment later by construction - pi emits the abort
 * error as the turn unwinds.
 */

export type StopCause = "you" | "another-device" | "reload" | "closed";

/** How long a cause stays attributable to the failure that follows it. */
const STOP_CAUSE_TTL_MS = 60_000;

let noted: { cause: StopCause; at: number } | undefined;

export function noteStopCause(cause: StopCause, now = Date.now()): void {
  noted = { cause, at: now };
}

/** The cause of a stop that happened moments ago, or undefined. */
export function recentStopCause(now = Date.now()): StopCause | undefined {
  if (noted === undefined) return undefined;
  return now - noted.at > STOP_CAUSE_TTL_MS ? undefined : noted.cause;
}

/** Test seam: the module holds one value, so a test must be able to clear it. */
export function forgetStopCause(): void {
  noted = undefined;
}

/**
 * The suffix the failure row carries, or undefined when the stop is unknown.
 *
 * Unknown is its own answer: a provider that dropped the stream was not stopped
 * by anybody, and saying "stopped" would be a guess.
 */
export function stopCauseSuffix(cause: StopCause | undefined): string | undefined {
  if (cause === "you") return "you stopped it";
  if (cause === "another-device") return "stopped from another device";
  if (cause === "reload") return "the session was reloaded";
  if (cause === "closed") return "the session was closed";
  return undefined;
}
