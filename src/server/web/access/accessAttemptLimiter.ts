/**
 * How many failed access attempts the gate takes before it stops evaluating token guesses.
 *
 * A token has at least 32 characters, so guessing one online is infeasible; the limits bound noise
 * and weak passphrases. A failure is a wrong sign-in, a wrong bearer or header token, or a malformed
 * or forged cookie. Once 20 failures from one peer address, or 200 from everyone, have counted in a
 * 10-minute window, sign-in and token guesses are refused unevaluated until the window ends: from that
 * address alone, or from every address. A cookie is
 * always checked, so a browser that is signed in is never locked out. Behind a reverse proxy every
 * client shares the proxy's address; no forwarded address is trusted.
 *
 * A failure counts only while its peer is still allowed, so one peer adds at most 20 to the global
 * count and cannot reach the ceiling alone (review 2026-10-21, P1-1). The state stays bounded: a peer
 * gets an entry only when one of its failures counts, which the global ceiling caps per window, no
 * entry is made past `MAX_TRACKED_PEERS`, and expired entries are swept at most once a minute rather
 * than on every request.
 */

const ACCESS_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const ACCESS_FAILURES_PER_PEER = 20;
const ACCESS_FAILURES_GLOBAL = 200;
const MAX_TRACKED_PEERS = 4 * ACCESS_FAILURES_GLOBAL;
const SWEEP_EVERY_MS = 60 * 1000;

interface FailureWindow {
  startedAt: number;
  failures: number;
  warned: boolean;
}

/** Which limit refuses token guesses: this peer address's own, or the ceiling over every address. */
export type AccessLimit = "address" | "overall";

/** Whether a peer may try a token now, and if not, which limit refuses it and when it may again. */
export type AttemptAllowance = { readonly allowed: true } | { readonly allowed: false; readonly limit: AccessLimit; readonly retryAfterSeconds: number };

export interface AccessAttemptLimiter {
  allowance(peer: string, now: number): AttemptAllowance;
  /**
   * Counts one failure when the peer is still allowed, and does nothing otherwise. Names the limits
   * this failure reached for the first time this window (the peer's own, once per peer; the overall
   * ceiling, once for everyone), so the caller warns once about each limit that actually tripped.
   */
  recordFailure(peer: string, now: number): readonly AccessLimit[];
}

function expired(window: FailureWindow, now: number): boolean {
  return now - window.startedAt >= ACCESS_ATTEMPT_WINDOW_MS;
}

export function createAccessAttemptLimiter(): AccessAttemptLimiter {
  const peers = new Map<string, FailureWindow>();
  const everyone: FailureWindow = { startedAt: 0, failures: 0, warned: false };
  let sweptAt = 0;

  const current = (window: FailureWindow, now: number): FailureWindow => {
    if (expired(window, now)) {
      window.startedAt = now;
      window.failures = 0;
      window.warned = false;
    }
    return window;
  };

  const sweep = (now: number): void => {
    if (now - sweptAt < SWEEP_EVERY_MS) return;
    sweptAt = now;
    for (const [address, window] of peers) if (expired(window, now)) peers.delete(address);
  };

  const existingWindow = (peer: string, now: number): FailureWindow | undefined => {
    const window = peers.get(peer);
    return window === undefined ? undefined : current(window, now);
  };

  const retryAfter = (window: FailureWindow, now: number): number => Math.max(1, Math.ceil((window.startedAt + ACCESS_ATTEMPT_WINDOW_MS - now) / 1000));

  const allowance = (peer: string, now: number): AttemptAllowance => {
    const global = current(everyone, now);
    const own = existingWindow(peer, now);
    if (own !== undefined && own.failures >= ACCESS_FAILURES_PER_PEER) return { allowed: false, limit: "address", retryAfterSeconds: retryAfter(own, now) };
    if (global.failures >= ACCESS_FAILURES_GLOBAL) return { allowed: false, limit: "overall", retryAfterSeconds: retryAfter(global, now) };
    return { allowed: true };
  };

  return {
    allowance,
    recordFailure(peer, now) {
      if (!allowance(peer, now).allowed) return [];
      sweep(now);
      let own = existingWindow(peer, now);
      if (own === undefined) {
        if (peers.size >= MAX_TRACKED_PEERS) return [];
        own = { startedAt: now, failures: 0, warned: false };
        peers.set(peer, own);
      }
      everyone.failures += 1;
      own.failures += 1;
      const tripped: AccessLimit[] = [];
      if (own.failures >= ACCESS_FAILURES_PER_PEER && !own.warned) {
        own.warned = true;
        tripped.push("address");
      }
      if (everyone.failures >= ACCESS_FAILURES_GLOBAL && !everyone.warned) {
        everyone.warned = true;
        tripped.push("overall");
      }
      return tripped;
    },
  };
}
