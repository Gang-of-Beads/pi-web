export type SocketReadyState = "connecting" | "open" | "closing" | "closed";

export type SocketLivenessVerdict = "leave-alone" | "drop-and-reconnect";

export interface SocketLivenessInput {
  readyState: SocketReadyState;
  wantsConnection: boolean;
  lastFrameAt: number;
  connectStartedAt: number;
  now: number;
  silenceBudgetMs: number;
  handshakeBudgetMs: number;
}

export function socketLivenessVerdict(input: SocketLivenessInput): SocketLivenessVerdict {
  if (!input.wantsConnection) return "leave-alone";
  if (input.readyState === "connecting") {
    if (input.connectStartedAt === 0) return "leave-alone";
    return input.now - input.connectStartedAt >= input.handshakeBudgetMs ? "drop-and-reconnect" : "leave-alone";
  }
  if (input.readyState !== "open") return "leave-alone";
  if (input.lastFrameAt === 0) return "leave-alone";
  return input.now - input.lastFrameAt >= input.silenceBudgetMs ? "drop-and-reconnect" : "leave-alone";
}
