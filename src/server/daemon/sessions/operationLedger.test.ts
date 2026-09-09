// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OperationLedger } from "./operationLedger.js";

let dataDir = "";

beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), "pi-web-ledger-")); });
afterEach(() => { rmSync(dataDir, { recursive: true, force: true }); });

const ID = "cm-1757000000000-ab12cd34";

describe("the operation ledger across a restart", () => {
  /**
   * The defect this whole slice exists for: the old ledger said "a daemon
   * restart forgets the ledger", so the browser's correct retry ran the prompt
   * a second time.
   */
  it("still knows an identity after the process that recorded it is gone", () => {
    const first = OperationLedger.open(dataDir);
    expect(first.decide("s1", ID, "fp").kind).toBe("admit");
    first.begin("s1", ID, "fp");
    first.settle("s1", ID, "succeeded");

    const second = OperationLedger.open(dataDir);
    expect(second.decide("s1", ID, "fp")).toMatchObject({ kind: "replay", outcome: "succeeded" });
  });

  it("downgrades an operation that was in flight to unknown, never to an outcome", () => {
    const first = OperationLedger.open(dataDir);
    first.begin("s1", ID, "fp");

    const second = OperationLedger.open(dataDir);
    expect(second.rowFor("s1", ID)?.outcome).toBe("unknown");
    expect(second.decide("s1", ID, "fp")).toMatchObject({ kind: "replay", outcome: "unknown" });
  });

  it("offers a reconnecting client exactly its open rows", () => {
    const ledger = OperationLedger.open(dataDir);
    ledger.begin("s1", ID, "fp");
    ledger.begin("s1", "cm-1757000000001-ffffffff", "fp2");
    ledger.settle("s1", "cm-1757000000001-ffffffff", "succeeded");
    expect(ledger.openRows("s1").map((row) => row.operationId)).toEqual([ID]);
  });

  it("survives a line torn off by a kill mid-write", () => {
    const first = OperationLedger.open(dataDir);
    first.begin("s1", ID, "fp");
    first.settle("s1", ID, "failed");
    appendFileSync(join(dataDir, "operations.jsonl"), '{"sessionId":"s1","operatio', "utf8");

    const second = OperationLedger.open(dataDir);
    expect(second.decide("s1", ID, "fp")).toMatchObject({ kind: "replay", outcome: "failed" });
  });

  it("rewrites rather than growing without bound", () => {
    const ledger = OperationLedger.open(dataDir);
    for (let index = 0; index < 20; index += 1) {
      const id = `cm-175700000${String(index).padStart(4, "0")}-abcdefff`;
      ledger.begin("s1", id, "fp");
      ledger.settle("s1", id, "succeeded");
    }
    const reopened = OperationLedger.open(dataDir);
    const lines = readFileSync(join(dataDir, "operations.jsonl"), "utf8").split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(20);
    expect(reopened.openRows("s1")).toEqual([]);
  });
});
