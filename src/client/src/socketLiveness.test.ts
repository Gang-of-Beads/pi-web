import { describe, expect, it } from "vitest";
import { socketLivenessVerdict, type SocketLivenessInput } from "./socketLiveness.js";

const base: SocketLivenessInput = {
  readyState: "open",
  wantsConnection: true,
  lastFrameAt: 1_000,
  connectStartedAt: 1_000,
  now: 1_000,
  silenceBudgetMs: 50_000,
  handshakeBudgetMs: 15_000,
};

describe("socketLivenessVerdict", () => {
  it("drops an open socket that has gone silent past the budget", () => {
    expect(socketLivenessVerdict({ ...base, now: 51_000 })).toBe("drop-and-reconnect");
  });

  it("leaves an open socket alone while frames still arrive", () => {
    expect(socketLivenessVerdict({ ...base, now: 40_000 })).toBe("leave-alone");
  });

  it("drops a handshake that never completed", () => {
    expect(socketLivenessVerdict({ ...base, readyState: "connecting", now: 16_000 })).toBe("drop-and-reconnect");
  });

  it("gives a handshake its budget before dropping it", () => {
    expect(socketLivenessVerdict({ ...base, readyState: "connecting", now: 10_000 })).toBe("leave-alone");
  });

  it("waits for a first frame before judging an open socket", () => {
    expect(socketLivenessVerdict({ ...base, lastFrameAt: 0, now: 999_000 })).toBe("leave-alone");
  });

  it("waits for a start time before judging a handshake", () => {
    expect(socketLivenessVerdict({ ...base, readyState: "connecting", connectStartedAt: 0, now: 999_000 })).toBe("leave-alone");
  });

  it("leaves a socket alone when no connection is wanted", () => {
    expect(socketLivenessVerdict({ ...base, wantsConnection: false, now: 999_000 })).toBe("leave-alone");
  });

  it("leaves closing and closed sockets to the close path", () => {
    expect(socketLivenessVerdict({ ...base, readyState: "closing", now: 999_000 })).toBe("leave-alone");
    expect(socketLivenessVerdict({ ...base, readyState: "closed", now: 999_000 })).toBe("leave-alone");
  });
});
