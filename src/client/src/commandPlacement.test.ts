import { describe, expect, it } from "vitest";
import { placeCommands } from "./commandPlacement";
import type { CommandLedgerEntry } from "./commandLedger";

/**
 * Owner report: "为啥这个slash消息一直在这" - a `/goal` that started the turn was
 * drawn after every message, under the reply it caused, and read as pending.
 */
function command(id: string, issuedAt: number): CommandLedgerEntry {
  return { id, sessionKey: "s", text: `/goal ${id}`, source: "typed", state: "ok", issuedAt, settledAt: issuedAt };
}

describe("placing command bubbles in the transcript", () => {
  it("puts a command before the message that followed it", () => {
    const { before, tail } = placeCommands([command("a", 100)], [50, 200, 300]);

    expect(before.get(1)?.map((row) => row.id)).toEqual(["a"]);
    expect(tail).toEqual([]);
  });

  it("keeps a command newer than everything on screen in the tail", () => {
    const { before, tail } = placeCommands([command("a", 400)], [50, 200]);

    expect(before.size).toBe(0);
    expect(tail.map((row) => row.id)).toEqual(["a"]);
  });

  it("keeps several commands in issue order, each at its own moment", () => {
    const { before, tail } = placeCommands([command("a", 100), command("b", 250), command("c", 900)], [50, 200, 300]);

    expect(before.get(1)?.map((row) => row.id)).toEqual(["a"]);
    expect(before.get(2)?.map((row) => row.id)).toEqual(["b"]);
    expect(tail.map((row) => row.id)).toEqual(["c"]);
  });

  it("falls past a group with no timestamp rather than guessing", () => {
    const { before, tail } = placeCommands([command("a", 100)], [undefined, 200]);

    expect(before.has(0)).toBe(false);
    expect(before.get(1)?.map((row) => row.id)).toEqual(["a"]);
    expect(tail).toEqual([]);
  });

  it("has nothing to place when there is no transcript", () => {
    const { before, tail } = placeCommands([command("a", 100)], []);

    expect(before.size).toBe(0);
    expect(tail.map((row) => row.id)).toEqual(["a"]);
  });
});
