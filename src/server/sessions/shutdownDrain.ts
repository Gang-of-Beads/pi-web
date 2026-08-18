/**
 * Letting in-flight agent runs finish before the daemon exits.
 *
 * Restarting to pick up an update currently kills whatever the agent was in the
 * middle of. There is no way to resume such a run afterwards — it is a live
 * streaming request plus a tool-call loop, and once the process is gone there is
 * no execution point left to return to — so the only honest way to make updates
 * non-disruptive is to not interrupt the run in the first place.
 *
 * The daemon therefore stops accepting new work immediately on the signal, then
 * waits for the runs already underway. The wait is bounded: a stuck run must not
 * hold a service restart open forever, and an operator who sent the signal is
 * entitled to have the process eventually go away.
 */

export interface DrainDecision {
  /** Whether to keep waiting rather than tearing the runtime down. */
  wait: boolean;
  /** Why, in the words used for the log line the operator will read. */
  reason: "no-active-work" | "waiting-for-active-work" | "deadline-reached" | "drain-disabled";
  /** Sessions still working, for the log and for the record written on exit. */
  activeSessionIds: readonly string[];
}

export interface DrainState {
  activeSessionIds: readonly string[];
  elapsedMs: number;
  timeoutMs: number;
}

/**
 * Decide whether to keep draining.
 *
 * A zero timeout means the previous behaviour — exit immediately — so the
 * feature can be turned off without removing it.
 */
export function drainDecision(state: DrainState): DrainDecision {
  if (state.timeoutMs <= 0) {
    return { wait: false, reason: "drain-disabled", activeSessionIds: state.activeSessionIds };
  }
  if (state.activeSessionIds.length === 0) {
    return { wait: false, reason: "no-active-work", activeSessionIds: [] };
  }
  if (state.elapsedMs >= state.timeoutMs) {
    // Deliberately gives up rather than waiting out an unbounded run: the
    // sessions still working are reported so they are not lost silently.
    return { wait: false, reason: "deadline-reached", activeSessionIds: state.activeSessionIds };
  }
  return { wait: true, reason: "waiting-for-active-work", activeSessionIds: state.activeSessionIds };
}

/** Default wait: long enough for a typical turn, short enough for a service restart. */
export const DEFAULT_DRAIN_TIMEOUT_MS = 60_000;

/**
 * Resolve the drain timeout from the environment.
 *
 * `PI_WEB_SHUTDOWN_DRAIN_MS=0` restores the immediate-exit behaviour. An
 * unparseable value falls back to the default rather than failing a shutdown,
 * because refusing to stop is a worse outcome than a mistyped timeout.
 */
export function resolveDrainTimeoutMs(
  env: Readonly<Record<string, string | undefined>>,
  fallback = DEFAULT_DRAIN_TIMEOUT_MS,
): number {
  const raw = env["PI_WEB_SHUTDOWN_DRAIN_MS"];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export interface DrainDeps {
  /** Sessions currently doing work the user would not want interrupted. */
  activeSessionIds: () => readonly string[];
  /** Milliseconds elapsed since draining began. */
  elapsedMs: () => number;
  /** Resolves after the poll interval. */
  wait: (ms: number) => Promise<void>;
  onProgress?: (decision: DrainDecision) => void;
}

/** How often the drain re-checks. Frequent enough to exit promptly once idle. */
export const DRAIN_POLL_MS = 250;

/**
 * Wait until no session is working, the deadline passes, or draining is off.
 * Returns the decision that ended the wait, so the caller can log what happened
 * and record which sessions were still running if it gave up.
 */
export async function drainActiveWork(timeoutMs: number, deps: DrainDeps): Promise<DrainDecision> {
  for (;;) {
    const decision = drainDecision({
      activeSessionIds: deps.activeSessionIds(),
      elapsedMs: deps.elapsedMs(),
      timeoutMs,
    });
    deps.onProgress?.(decision);
    if (!decision.wait) return decision;
    await deps.wait(DRAIN_POLL_MS);
  }
}
