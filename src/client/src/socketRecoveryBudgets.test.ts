import { describe, expect, it } from "vitest";
import { HANDSHAKE_TIMEOUT_MS, LIVENESS_TIMEOUT_MS } from "./sessionSocket";
import { KEEPALIVE_INTERVAL_MS } from "../../server/daemon/realtime/keepaliveInterval";

/**
 * The budgets that decide how long a connection the network killed without a
 * FIN keeps looking alive. They are a contract between the two processes: the
 * daemon promises a keepalive every KEEPALIVE_INTERVAL_MS, the browser waits
 * for a small multiple of it before retiring the socket. Too tight and a slow
 * path drops a working connection; too loose and a phone that has just
 * regained signal stares at stale content, which is what a 50s budget checked
 * every 15s did.
 */
describe("the socket recovery budgets", () => {
  it("waits for more than two keepalives and fewer than three", () => {
    expect(LIVENESS_TIMEOUT_MS).toBeGreaterThan(KEEPALIVE_INTERVAL_MS * 2);
    expect(LIVENESS_TIMEOUT_MS).toBeLessThan(KEEPALIVE_INTERVAL_MS * 3);
  });

  it("gives a handshake less time than a silent open socket", () => {
    expect(HANDSHAKE_TIMEOUT_MS).toBeLessThan(LIVENESS_TIMEOUT_MS);
    expect(HANDSHAKE_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
  });
});
