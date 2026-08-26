/**
 * Whether the server has just been reached.
 *
 * A connection failure is raised by whichever channel happened to fail, and
 * recovery is noticed by whichever channel happens to succeed next. Those are
 * rarely the same one: a failed request puts a banner on screen, while the
 * banner was only withdrawn when the realtime socket reconnected. If the
 * socket never dropped - a request timed out, a phone slept, a tunnel blinked -
 * nothing ever withdrew it, and the only way out was to reload the page.
 *
 * Any successful exchange with the server is proof the transport is back. This
 * carries that fact from the request boundary to whoever owns the banner,
 * without the request layer knowing what a banner is.
 */
type TransportRecoveryListener = () => void;

let listener: TransportRecoveryListener | undefined;

/** Register the one owner interested in recovery, or `undefined` to withdraw. */
export function observeTransportRecovery(next: TransportRecoveryListener | undefined): void {
  listener = next;
}

/**
 * Report that the server answered. Called on every successful request, so it
 * must not throw: a listener that fails is a bug in the listener, not a reason
 * for the request that succeeded to look like it failed.
 */
export function reportTransportReachable(): void {
  const current = listener;
  if (current === undefined) return;
  try {
    current();
  } catch {
    // Deliberately swallowed; see above.
  }
}
