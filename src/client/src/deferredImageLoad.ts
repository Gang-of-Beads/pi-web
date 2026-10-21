/**
 * The load states of a deferred tool-result image: a network fetch through the web process to the
 * machine's session daemon, which can fail while the daemon restarts or the machine is unreachable.
 *
 * Owner, 2026-10-21: an image that could not load retried every time its "did not load" row came
 * into view, which drew the image's box again, which failed again: the same image was fetched
 * hundreds of times a minute during a daemon outage, and the two boxes of different heights
 * alternated, so the transcript shrank and grew. The invariant now: an image part keeps one box
 * while it loads, waits, retries or gives up, and only the loaded picture replaces it. Retries back
 * off and stop; while the page knows the machine's link is down they wait for it, and the link's
 * return is worth one retry at once.
 */

/** The waits before each retry after a failed fetch; after the last one the image has failed. */
export const IMAGE_RETRY_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000, 32_000];

/** One image's fetch history: the current address's outcome, failed fetches in a row, and the retry nonce in its address. */
export interface DeferredImageAttempt {
  readonly fetch: "loading" | "loaded" | "failed";
  readonly failures: number;
  readonly nonce: number;
}

export const FIRST_IMAGE_ATTEMPT: DeferredImageAttempt = { fetch: "loading", failures: 0, nonce: 0 };

/** `reloading` is a retry's fetch in flight: the box keeps saying the image did not load until one does. */
export type DeferredImageState = "loading" | "reloading" | "loaded" | "retrying" | "waiting-for-link" | "failed";

export function deferredImageState(attempt: DeferredImageAttempt, socketConnecting: boolean): DeferredImageState {
  if (attempt.fetch === "loading") return attempt.failures > 0 ? "reloading" : "loading";
  if (attempt.fetch === "loaded") return "loaded";
  if (attempt.failures > IMAGE_RETRY_DELAYS_MS.length) return "failed";
  return socketConnecting ? "waiting-for-link" : "retrying";
}

/** How long a retrying image waits before its next fetch. */
export function imageRetryDelayMs(attempt: DeferredImageAttempt): number {
  return IMAGE_RETRY_DELAYS_MS[attempt.failures - 1] ?? 0;
}

export function imageFetchFailed(attempt: DeferredImageAttempt): DeferredImageAttempt {
  return { fetch: "failed", failures: attempt.failures + 1, nonce: attempt.nonce };
}

export function imageFetchLoaded(attempt: DeferredImageAttempt): DeferredImageAttempt {
  return { fetch: "loaded", failures: 0, nonce: attempt.nonce };
}

/** The next fetch of the backoff, under an address the browser's cached failure cannot answer. */
export function imageRetried(attempt: DeferredImageAttempt): DeferredImageAttempt {
  return { fetch: "loading", failures: attempt.failures, nonce: attempt.nonce + 1 };
}

/** The reader asked again after the image failed: one more fetch, and failing it is final again. */
export function imageRetriedByReader(attempt: DeferredImageAttempt): DeferredImageAttempt {
  return { fetch: "loading", failures: IMAGE_RETRY_DELAYS_MS.length, nonce: attempt.nonce + 1 };
}

/**
 * The lines the image's box says in each state, and what a tap on it does; the loaded picture says
 * nothing. The box is the small placeholder, so each line is short enough to fit it on a phone.
 * Every state that says the image did not load takes a tap: a retry in flight or a link the page
 * believes down (a proxy without WebSocket upgrades never opens it) must not leave the reader
 * without a way to ask again.
 */
export interface DeferredImageView {
  readonly lines: readonly string[];
  readonly tap: ((attempt: DeferredImageAttempt) => DeferredImageAttempt) | undefined;
}

export const DEFERRED_IMAGE_VIEWS: Readonly<Record<DeferredImageState, DeferredImageView>> = {
  loading: { lines: ["Loading image…"], tap: undefined },
  reloading: { lines: ["Did not load", "Retrying…"], tap: imageRetried },
  loaded: { lines: [], tap: undefined },
  retrying: { lines: ["Did not load", "Retrying…"], tap: imageRetried },
  "waiting-for-link": { lines: ["Did not load", "Waiting for the machine…"], tap: imageRetried },
  failed: { lines: ["Did not load", "Retry"], tap: imageRetriedByReader },
};

/**
 * What the machine's link coming back does to an image in each state (read with the link up): an
 * image still in its backoff tries now, and one that already gave up tries once more, so a flapping
 * link or a run of failed reconnects does not leave a transcript of boxes to tap one by one.
 */
export const RETRY_ON_LINK_RETURN: Readonly<Record<DeferredImageState, ((attempt: DeferredImageAttempt) => DeferredImageAttempt) | undefined>> = {
  loading: undefined,
  reloading: undefined,
  loaded: undefined,
  retrying: imageRetried,
  "waiting-for-link": imageRetried,
  failed: imageRetriedByReader,
};
