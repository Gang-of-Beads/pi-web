import { describe, expect, it } from "vitest";
import { claimAfterMiss, provenRowStep, VERIFY_AFTER_MS, verificationStep } from "./sendVerification";

describe("claimAfterMiss", () => {
  const scope = { machineId: "local", sessionId: "s1" };
  const linkDown = { kind: "link-down" } as const;

  it("keeps the first moment of the same session's claim and takes the latest reason", () => {
    const first = claimAfterMiss(undefined, scope, linkDown, 1_000);
    const again = claimAfterMiss(first, scope, { kind: "server-error", machineId: "local", reason: "HTTP 500" }, 9_000);
    expect(again).toEqual({ machineId: "local", sessionId: "s1", since: 1_000, miss: { kind: "server-error", machineId: "local", reason: "HTTP 500" } });
  });

  it("starts a new episode for another session or another machine", () => {
    const first = claimAfterMiss(undefined, scope, linkDown, 1_000);
    expect({
      session: claimAfterMiss(first, { machineId: "local", sessionId: "s2" }, linkDown, 9_000).since,
      machine: claimAfterMiss(first, { machineId: "remote-1", sessionId: "s1" }, linkDown, 9_000).since,
    }).toEqual({ session: 9_000, machine: 9_000 });
  });
});

describe("an unanswered send, asked about", () => {
  it.each([
    ["pending", { kind: "mark", state: "received", retireOutbox: false }],
    ["succeeded", { kind: "mark", state: "received", retireOutbox: true }],
    ["failed", { kind: "fail", cause: "not-sent" }],
    ["unknown", { kind: "fail", cause: "not-received" }],
    ["withdrawn", { kind: "withdraw" }],
  ])("takes the ledger's %s at its word on any ask", (outcome, step) => {
    expect({ early: verificationStep(outcome, false), last: verificationStep(outcome, true) }).toEqual({ early: step, last: step });
  });

  it("waits while the daemon has no row and more asks are coming", () => {
    expect(verificationStep(undefined, false)).toEqual({ kind: "wait" });
  });

  it("calls it not received on the last ask, so the row can be retried under its identity", () => {
    expect(verificationStep(undefined, true)).toEqual({ kind: "fail", cause: "not-received" });
  });

  it("reads an outcome this build does not know as no row, never as a verdict", () => {
    expect({ early: verificationStep("committed-in-2027", false), last: verificationStep("committed-in-2027", true) })
      .toEqual({ early: { kind: "wait" }, last: { kind: "fail", cause: "not-received" } });
  });

  it("acts on a row a server fact proved only with a terminal fact it missed", () => {
    expect({
      failed: provenRowStep("failed"),
      unknown: provenRowStep("unknown"),
      withdrawn: provenRowStep("withdrawn"),
      pending: provenRowStep("pending"),
      succeeded: provenRowStep("succeeded"),
      noRow: provenRowStep(undefined),
    }).toEqual({
      failed: { kind: "fail", cause: "not-sent" },
      unknown: { kind: "fail", cause: "not-received" },
      withdrawn: { kind: "withdraw" },
      pending: { kind: "wait" },
      succeeded: { kind: "wait" },
      noRow: { kind: "wait" },
    });
  });

  it("asks on a clock that ends", () => {
    expect(VERIFY_AFTER_MS).toEqual([5_000, 15_000, 45_000]);
  });
});
