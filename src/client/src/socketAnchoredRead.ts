/**
 * When a fact a machine's socket keeps live may be read (state-diagram D5, P6 slice a).
 *
 * The unread set and the pins are kept live by their machine's realtime socket, and the socket's
 * open reads them: only a read sent after the subscription began can be sure no change fell
 * between its answer and the first event. A read sent while the socket is still connecting is
 * therefore read again at the open; a boot did exactly that, 3 ms apart, for each of them. So a
 * need that arises while the socket connects waits for the open, for a bounded grace: a socket
 * that has not opened by then (a proxy without WebSocket, a dead network) must not hold the read
 * hostage, and the page reads anyway.
 */

/** Where a machine's realtime socket stands. `connecting.since` is when it last stopped being open. */
export type SocketPhase =
  | { kind: "absent" }
  | { kind: "connecting"; since: number }
  | { kind: "open" };

/** `read` now, or leave the read to the socket's open. */
export type AnchoredRead = "read" | "await-open";

/** How long a need waits for a connecting socket before reading on its own. */
export const FIRST_OPEN_GRACE_MS = 1_500;

/** How long until a need left to a connecting socket should read on its own; 0 when it should now. */
export function graceRemaining(phase: SocketPhase, now: number): number {
  if (phase.kind !== "connecting") return 0;
  return Math.max(0, phase.since + FIRST_OPEN_GRACE_MS - now);
}

export function anchoredRead(phase: SocketPhase, now: number): AnchoredRead {
  return graceRemaining(phase, now) > 0 ? "await-open" : "read";
}
