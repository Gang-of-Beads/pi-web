import { QUIET_WINDOW_MS, retryDelayMs } from "../sync/readPhase.js";

/**
 * When a failed page read may be asked again (state-diagram D4, review ca45d6ed).
 *
 * The update that follows a failed read re-evaluated the reader's last scroll and asked again at
 * once, so a failing older read repeated about 47 times a second against the daemon while the
 * reader rested at the top (`probe-failed-page.mjs` leg B). A failure holds both ends on the read
 * ladder every "never gives up" read uses; a page that lands opens them again.
 */
export type PageRetry = { readonly kind: "open" } | HeldPageRetry;

export interface HeldPageRetry {
  readonly kind: "held";
  readonly failures: number;
  readonly until: number;
}

export const PAGE_RETRY_OPEN: PageRetry = { kind: "open" };

export function holdAfterFailure(retry: PageRetry, now: number): HeldPageRetry {
  const failures = retry.kind === "held" ? retry.failures + 1 : 1;
  return { kind: "held", failures, until: now + retryDelayMs(failures - 1, QUIET_WINDOW_MS) };
}

export function isHeld(retry: PageRetry, now: number): boolean {
  return retry.kind === "held" && now < retry.until;
}
