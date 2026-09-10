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
type TransportRecoveryListener = (machineId: string | undefined) => void;

let listener: TransportRecoveryListener | undefined;

/** Register the one owner interested in recovery, or `undefined` to withdraw. */
export function observeTransportRecovery(next: TransportRecoveryListener | undefined): void {
  listener = next;
}

/**
 * The machine a request URL speaks about; undefined for web-owned URLs, which
 * prove the web process answered and nothing about any machine's link - not
 * even the local one, whose daemon can be down while the web process serves
 * 200s.
 */
export function machineIdFromUrl(url: string): string | undefined {
  const scoped = /\/machines\/([^/]+)/.exec(url);
  return scoped?.[1] === undefined ? undefined : decodeURIComponent(scoped[1]);
}

/**
 * Report that the server answered. The report vouches for the machine the URL
 * was routed to, and for nothing else - a web-owned success says nothing
 * about any machine's link. Called on every response, so it must not throw: a
 * listener that fails is a bug in the listener, not a reason for the request
 * that succeeded to look like it failed.
 */
export function reportTransportReachable(url: string): void {
  const current = listener;
  if (current === undefined) return;
  const machineId = machineIdFromUrl(url);
  try {
    current(machineId);
  } catch {
    // Deliberately swallowed; see above.
  }
}
