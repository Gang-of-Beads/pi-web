import { describe, expect, it } from "vitest";
import { commandStateLabel, commandsForSession, expireSettledCommands, issueCommand, SETTLED_ROW_LINGER_MS, settleCommand } from "./commandLedger";

const KEY = "local:session-1";

describe("the browser's record of an issued command", () => {
  /**
   * The press the owner repeated four times had been accepted every time; the
   * screen just held no evidence of it. Issuing must create that evidence at
   * once, not when the daemon eventually answers.
   */
  it("records the press before the daemon answers", () => {
    const { entries, id } = issueCommand([], { sessionKey: KEY, text: "/goal-resume", source: "goal-panel", now: 1000 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id, state: "pending", text: "/goal-resume", source: "goal-panel" });
  });

  it("settles the row with the outcome, success or failure alike", () => {
    const issued = issueCommand([], { sessionKey: KEY, text: "/goal-pause", source: "typed", now: 1000 });
    const ok = settleCommand(issued.entries, issued.id, { state: "ok", now: 2000 });
    expect(ok[0]).toMatchObject({ state: "ok", settledAt: 2000 });

    const failed = settleCommand(issued.entries, issued.id, { state: "failed", resultText: "Session daemon unavailable", now: 2000 });
    expect(failed[0]).toMatchObject({ state: "failed", resultText: "Session daemon unavailable" });
  });

  /**
   * A settled row is an acknowledgment, not an archive: the transcript's own
   * record is canonical once the daemon echoes the command's effect, so the
   * browser's copy leaves after its linger instead of accumulating.
   */
  it("lets a settled row go after its linger and never expires a pending one", () => {
    const issued = issueCommand([], { sessionKey: KEY, text: "/x", source: "typed", now: 0 });
    const settled = settleCommand(issued.entries, issued.id, { state: "ok", now: 100 });
    expect(expireSettledCommands(settled, 100 + SETTLED_ROW_LINGER_MS - 1)).toHaveLength(1);
    expect(expireSettledCommands(settled, 100 + SETTLED_ROW_LINGER_MS)).toHaveLength(0);
    expect(expireSettledCommands(issued.entries, 1_000_000)).toHaveLength(1);
  });

  /** Retained data renders only under the key it was fetched for. */
  it("keeps rows to the session that issued them", () => {
    const a = issueCommand([], { sessionKey: "local:a", text: "/one", source: "typed", now: 0 });
    const both = issueCommand(a.entries, { sessionKey: "local:b", text: "/two", source: "typed", now: 0 });
    expect(commandsForSession(both.entries, "local:a").map((row) => row.text)).toEqual(["/one"]);
    expect(commandsForSession(both.entries, "local:b").map((row) => row.text)).toEqual(["/two"]);
  });

  it("caps the ledger by dropping settled rows, never pending ones", () => {
    let entries = issueCommand([], { sessionKey: KEY, text: "/pending-forever", source: "typed", now: 0 }).entries;
    for (let index = 0; index < 25; index += 1) {
      const issued = issueCommand(entries, { sessionKey: KEY, text: `/n${String(index)}`, source: "typed", now: index });
      entries = settleCommand(issued.entries, issued.id, { state: "ok", now: index });
    }
    expect(entries.length).toBeLessThanOrEqual(20);
    expect(entries.some((row) => row.text === "/pending-forever")).toBe(true);
  });

  /**
   * Task 4.2's unit half: while the session streams, a pending row waits
   * ("waiting for the current reply to finish") and runs otherwise; settled
   * rows tell the outcome. The wording is part of the contract - the reader
   * must know the command proceeds when the reply finishes.
   */
  it("labels a pending row as waiting during a stream and running otherwise", () => {
    expect(commandStateLabel({ state: "pending" }, true)).toBe("waiting for the current reply to finish");
    expect(commandStateLabel({ state: "pending" }, false)).toBe("running…");
    expect(commandStateLabel({ state: "ok", resultText: "/goal-resume done" }, false)).toBe("/goal-resume done");
    expect(commandStateLabel({ state: "ok" }, false)).toBe("done");
    expect(commandStateLabel({ state: "failed", resultText: "boom" }, false)).toBe("failed — boom");
    expect(commandStateLabel({ state: "failed" }, false)).toBe("failed — see the error above");
  });
});
