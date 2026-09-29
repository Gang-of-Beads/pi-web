/**
 * How long the web proxy waits for the session daemon before it answers the browser itself.
 *
 * Below the browser's own 30 s request deadline, so the browser hears the proxy's verdict (a
 * 504 it can classify as unverifiable) instead of timing out on its own, and above the slowest
 * daemon answers measured on a working install: over 1.5 GB of access log the slowest session
 * read took 22.6 s and the slowest prompt 6.1 s.
 */
export const SESSION_PROXY_DEADLINE_MS = 25_000;

/** The browser's side of the proxied request: finished, or closed before it was. */
export interface BrowserConnection {
  readonly writableFinished: boolean;
  on(event: "close", listener: () => void): unknown;
  off(event: "close", listener: () => void): unknown;
}

export type BoundedDaemonOutcome<T> =
  | { kind: "answered"; value: T }
  | { kind: "deadline" }
  | { kind: "client-gone" };

/**
 * Run one daemon call that always ends: with the daemon's answer, at the deadline, or when the
 * browser's connection goes away. Either of the last two aborts the call's signal, so the
 * daemon request is cancelled rather than left running for nobody - and the race does not rely
 * on the daemon honouring that signal, because a daemon that never answers must still leave
 * the proxy able to answer the browser.
 */
export function boundDaemonRequest<T>(
  response: BrowserConnection,
  call: (signal: AbortSignal) => Promise<T>,
  deadlineMs: number = SESSION_PROXY_DEADLINE_MS,
): Promise<BoundedDaemonOutcome<T>> {
  const controller = new AbortController();
  return new Promise<BoundedDaemonOutcome<T>>((resolve, reject) => {
    let settled = false;
    const release = (): void => {
      settled = true;
      clearTimeout(timer);
      response.off("close", onClose);
    };
    const end = (outcome: BoundedDaemonOutcome<T>): void => {
      if (settled) return;
      release();
      if (outcome.kind !== "answered") controller.abort(new Error(outcome.kind));
      resolve(outcome);
    };
    const onClose = (): void => {
      if (!response.writableFinished) end({ kind: "client-gone" });
    };
    const timer = setTimeout(() => { end({ kind: "deadline" }); }, deadlineMs);
    response.on("close", onClose);
    call(controller.signal).then(
      (value) => { end({ kind: "answered", value }); },
      (error: unknown) => {
        if (settled) return;
        release();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
