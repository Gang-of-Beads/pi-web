import { QUIET_WINDOW_MS, retryDelayMs } from "../sync/readPhase.js";

/**
 * When a failed page read may be asked again (state-diagram D4, review ca45d6ed).
 *
 * The update that follows a failed read re-evaluated the reader's last scroll and asked again at
 * once, so a failing older read repeated about 47 times a second against the daemon while the
 * reader rested at the top (`probe-failed-page.mjs` leg B). A failure holds both ends on the read
 * ladder every "never gives up" read uses; the hold's own timer releases it, and a page that
 * lands opens the ends again. The hold is a state, not a time compared with the wall clock: a
 * clock that stepped back left a hold whose timer had run standing (review 754821b2).
 */
export type PageRetry = { readonly kind: "open" } | HeldPageRetry | { readonly kind: "released"; readonly failures: number };

export interface HeldPageRetry {
  readonly kind: "held";
  readonly failures: number;
  readonly waitMs: number;
}

export const PAGE_RETRY_OPEN: PageRetry = { kind: "open" };

export function holdAfterFailure(retry: PageRetry): HeldPageRetry {
  const failures = retry.kind === "open" ? 1 : retry.failures + 1;
  return { kind: "held", failures, waitMs: retryDelayMs(failures - 1, QUIET_WINDOW_MS) };
}

/** The hold's timer ran: the ends may be asked again, and the next failure waits longer. */
export function releaseHold(retry: PageRetry): PageRetry {
  return retry.kind === "held" ? { kind: "released", failures: retry.failures } : retry;
}

export function isHeld(retry: PageRetry): boolean {
  return retry.kind === "held";
}
