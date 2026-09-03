/**
 * Every request settles.
 *
 * The browser had no request timeout anywhere. A fetch that hung - a daemon too
 * busy to answer, a socket that died without closing, a network that went away
 * mid-flight - never resolved and never rejected, so neither the `try` nor the
 * `catch` around it ever ran. Any state a caller had set while waiting stayed
 * set for the life of the page: "Loading goals…" with no read in flight,
 * "Loading this session…" that never resolves, a panel that can only be fixed
 * by reloading.
 *
 * Those were treated as separate bugs and fixed separately, by working out who
 * should clear each flag. That was the wrong half of the problem: the flags were
 * owned correctly and the thing that was supposed to clear them never returned.
 *
 * A request that cannot finish has to say so. Waiting forever is not a state a
 * reader can act on, and it is indistinguishable from working.
 */

/** How long a request may take before it is reported as unanswered. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Uploads carry attachments over links that are sometimes slow, so they get
 * longer - but still a bound. "Slow" and "never" have to stay different.
 */
export const UPLOAD_TIMEOUT_MS = 180_000;

export class RequestTimeoutError extends Error {
  constructor(readonly url: string, readonly timeoutMs: number) {
    super(`The server did not answer within ${String(Math.round(timeoutMs / 1000))}s.`);
    this.name = "RequestTimeoutError";
  }
}

/** Whether nobody answered in time, as opposed to answering with a refusal. */
export function isRequestTimeout(error: unknown): boolean {
  return error instanceof RequestTimeoutError;
}

/**
 * A signal that aborts after `timeoutMs`, combined with whatever the caller
 * already passed so a deadline never takes away their own cancellation.
 */
export function deadlineSignal(timeoutMs: number, existing?: AbortSignal | null): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  const forward = (): void => { controller.abort(); };
  if (existing != null) {
    if (existing.aborted) controller.abort();
    else existing.addEventListener("abort", forward, { once: true });
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      if (existing != null) existing.removeEventListener("abort", forward);
    },
  };
}

/** Whether this request should be given the longer upload budget. */
export function timeoutForBody(body: BodyInit | null | undefined): number {
  return body instanceof FormData ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

/**
 * fetch with a deadline, for the few callers that cannot go through request()
 * because they read the response themselves.
 *
 * They are the same hazard: a hung fetch here strands whatever the caller set
 * while waiting, exactly as it did through request().
 */
export async function fetchWithDeadline(url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const deadline = deadlineSignal(timeoutMs, init?.signal);
  try {
    return await fetch(url, { ...init, signal: deadline.signal });
  } catch (error) {
    if (deadline.signal.aborted && init?.signal?.aborted !== true) throw new RequestTimeoutError(url, timeoutMs);
    throw error;
  } finally {
    deadline.done();
  }
}
