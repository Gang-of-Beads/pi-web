/** The runtime facts that say a session has work in hand. */
export interface SessionWorkFlags {
  readonly isStreaming: boolean;
  readonly isBashRunning: boolean;
  readonly isCompacting: boolean;
  readonly pendingMessageCount: number;
}

/**
 * Whether a session has work in hand: a turn, a shell run, a compaction, or messages waiting,
 * including the daemon's own queued ones the caller counts in. The session service and the
 * command service each kept a copy of this test (B14 review items 10-11).
 */
export function sessionHasActiveWork(session: SessionWorkFlags, extraQueuedMessageCount = 0): boolean {
  return session.isStreaming || session.isCompacting || session.isBashRunning || session.pendingMessageCount + extraQueuedMessageCount > 0;
}
