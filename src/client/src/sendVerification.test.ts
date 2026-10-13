import { describe, expect, it } from "vitest";
import { claimAfterMiss, provenRowStep } from "./sendVerification";

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

describe("the ledger's word on a row the machine took", () => {
  it("acts only on a terminal fact the row missed", () => {
    expect({
      failed: provenRowStep("failed"),
      unknown: provenRowStep("unknown"),
      withdrawn: provenRowStep("withdrawn"),
      consumed: provenRowStep("consumed"),
      pending: provenRowStep("pending"),
      succeeded: provenRowStep("succeeded"),
      noRow: provenRowStep(undefined),
    }).toEqual({
      failed: "cancel",
      unknown: "resend",
      withdrawn: "withdraw",
      consumed: "withdraw",
      pending: "wait",
      succeeded: "wait",
      noRow: "wait",
    });
  });
});
