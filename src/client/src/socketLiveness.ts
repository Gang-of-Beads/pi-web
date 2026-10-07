export type SocketReadyState = "connecting" | "open" | "closing" | "closed";

/**
 * What a socket's liveness check does: nothing; `check`, ask the daemon for what was missed,
 * because nothing at all arrived for the page's quiet window T (B7, state-diagram D5); or drop a
 * socket silent past its budget and reconnect.
 */
export type SocketLivenessVerdict = "leave-alone" | "check" | "drop-and-reconnect";

export interface SocketLivenessInput {
  readyState: SocketReadyState;
  wantsConnection: boolean;
  lastFrameAt: number;
  connectStartedAt: number;
  now: number;
  silenceBudgetMs: number;
  handshakeBudgetMs: number;
  /** The quiet window T this socket named when it opened; a socket that named none is never checked. */
  quietMs?: number | undefined;
  /** When the last check went out: the next one waits a further T of silence. */
  lastCheckAt?: number | undefined;
}

export function socketLivenessVerdict(input: SocketLivenessInput): SocketLivenessVerdict {
  if (!input.wantsConnection) return "leave-alone";
  if (input.readyState === "connecting") {
    if (input.connectStartedAt === 0) return "leave-alone";
    return input.now - input.connectStartedAt >= input.handshakeBudgetMs ? "drop-and-reconnect" : "leave-alone";
  }
  if (input.readyState !== "open") return "leave-alone";
  if (input.lastFrameAt === 0) return "leave-alone";
  if (input.now - input.lastFrameAt >= input.silenceBudgetMs) return "drop-and-reconnect";
  return quietCheckDue(input) ? "check" : "leave-alone";
}

function quietCheckDue(input: SocketLivenessInput): boolean {
  if (input.quietMs === undefined) return false;
  return input.now - Math.max(input.lastFrameAt, input.lastCheckAt ?? 0) >= input.quietMs;
}
