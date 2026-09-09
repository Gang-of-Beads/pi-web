// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEDGER_LIMITS, afterRestart, decideOperation, isWellFormedOperationId,
  type OperationDecision, type OperationRefusalCode, type OperationRow,
} from "./operationDecision.js";

const NOW = 1_700_000_000_000;

function row(overrides: Partial<OperationRow> = {}): OperationRow {
  return { operationId: "op-abcdef12", fingerprint: "fp-1", outcome: "pending", recordedAt: NOW - 1000, updatedAt: NOW - 1000, ...overrides };
}

function request(overrides: Partial<{ operationId: string; fingerprint: string; now: number }> = {}) {
  return { operationId: "op-abcdef12", fingerprint: "fp-1", now: NOW, ...overrides };
}

describe("deciding what to do with an operation", () => {
  it("admits an identity it has never seen", () => {
    expect(decideOperation(undefined, request(), 0)).toEqual({ kind: "admit" });
  });

  it("replays a recorded outcome instead of running the work again", () => {
    for (const outcome of ["succeeded", "failed", "unknown"] as const) {
      expect(decideOperation(row({ outcome }), request(), 1))
        .toEqual({ kind: "replay", outcome, recordedAt: NOW - 1000 });
    }
  });

  it("reports a live row as in flight rather than starting a second run", () => {
    expect(decideOperation(row(), request(), 1)).toEqual({ kind: "in-flight", since: NOW - 1000 });
  });

  /** The rule that keeps a retry from silently becoming a rewrite. */
  it("refuses the same id with a different payload as a conflict", () => {
    expect(decideOperation(row({ outcome: "succeeded" }), request({ fingerprint: "fp-2" }), 1))
      .toEqual({ kind: "refuse", code: "conflict" });
  });

  /**
   * Evicting to make room turns a later replay back into a second execution,
   * so a full ledger refuses new work instead.
   */
  it("refuses on capacity rather than evicting a row", () => {
    expect(decideOperation(undefined, request(), DEFAULT_LEDGER_LIMITS.capacity))
      .toEqual({ kind: "refuse", code: "capacity" });
  });

  it("refuses a replay that has aged past retention", () => {
    const old = row({ outcome: "succeeded", recordedAt: NOW - DEFAULT_LEDGER_LIMITS.retentionMs - 1 });
    expect(decideOperation(old, request(), 1)).toEqual({ kind: "refuse", code: "expired" });
  });

  it("refuses a malformed identity or an empty fingerprint", () => {
    expect(decideOperation(undefined, request({ operationId: "op" }), 0)).toEqual({ kind: "refuse", code: "invalid" });
    expect(decideOperation(undefined, request({ fingerprint: "" }), 0)).toEqual({ kind: "refuse", code: "invalid" });
  });

  it("calls a pending row that went quiet unknown, not still running", () => {
    const stale = row({ updatedAt: NOW - DEFAULT_LEDGER_LIMITS.pendingStaleMs - 1 });
    expect(decideOperation(stale, request(), 1)).toEqual({ kind: "replay", outcome: "unknown", recordedAt: stale.recordedAt });
  });

  it("produces one of exactly four decision kinds, and every refusal names a code", () => {
    const decisions: OperationDecision[] = [
      decideOperation(undefined, request(), 0),
      decideOperation(row(), request(), 1),
      decideOperation(row({ outcome: "succeeded" }), request(), 1),
      decideOperation(undefined, request({ operationId: "!" }), 0),
    ];
    expect(decisions.map((decision) => decision.kind)).toEqual(["admit", "in-flight", "replay", "refuse"]);
    const codes: OperationRefusalCode[] = ["invalid", "conflict", "expired", "capacity"];
    expect(new Set(codes).size).toBe(4);
  });
});

describe("what a restart may assert", () => {
  it("downgrades every pending row to unknown and leaves settled rows alone", () => {
    expect(afterRestart(row()).outcome).toBe("unknown");
    expect(afterRestart(row({ outcome: "succeeded" })).outcome).toBe("succeeded");
    expect(afterRestart(row({ outcome: "failed" })).outcome).toBe("failed");
    expect(afterRestart(row({ outcome: "unknown" })).outcome).toBe("unknown");
  });
});

describe("operation identities", () => {
  it("accepts the shape the client mints and rejects the rest", () => {
    expect(isWellFormedOperationId("cm-1757000000000-ab12cd34")).toBe(true);
    expect(isWellFormedOperationId("short")).toBe(false);
    expect(isWellFormedOperationId(`op-${"x".repeat(200)}`)).toBe(false);
    expect(isWellFormedOperationId("op with spaces")).toBe(false);
  });
});
