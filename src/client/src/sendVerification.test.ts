import { describe, expect, it } from "vitest";
import { VERIFY_AFTER_MS, verificationStep } from "./sendVerification";

describe("an unanswered send, asked about", () => {
  it.each([
    ["pending", { kind: "mark", state: "received", retireOutbox: true }],
    ["succeeded", { kind: "mark", state: "received", retireOutbox: true }],
    ["failed", { kind: "mark", state: "failed", retireOutbox: false }],
    ["unknown", { kind: "mark", state: "failed", retireOutbox: false }],
    ["withdrawn", { kind: "withdraw" }],
  ])("takes the ledger's %s at its word on any ask", (outcome, step) => {
    expect({ early: verificationStep(outcome, false), last: verificationStep(outcome, true) }).toEqual({ early: step, last: step });
  });

  it("waits while the daemon has no row and more asks are coming", () => {
    expect(verificationStep(undefined, false)).toEqual({ kind: "wait" });
  });

  it("calls it not received on the last ask, so the row can be retried under its identity", () => {
    expect(verificationStep(undefined, true)).toEqual({ kind: "mark", state: "failed", retireOutbox: false });
  });

  it("reads an outcome this build does not know as no row, never as a verdict", () => {
    expect({ early: verificationStep("committed-in-2027", false), last: verificationStep("committed-in-2027", true) })
      .toEqual({ early: { kind: "wait" }, last: { kind: "mark", state: "failed", retireOutbox: false } });
  });

  it("asks on a clock that ends", () => {
    expect(VERIFY_AFTER_MS).toEqual([5_000, 15_000, 45_000]);
  });
});
