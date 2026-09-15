import { describe, expect, it } from "vitest";
import { commandDeliveryPresentation, commandResultLine, commandsForSession, issueCommand, settleCommand } from "./commandLedger";

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
   * The owner's ruling (2026-08-31, "不要自动离场"): a settled row is the
   * user's receipt of what THEY sent and what ran — it does not leave on a
   * timer. The only eviction is the capacity cap, which drops settled rows
   * first and never a pending one.
   */
  it("keeps a settled row for the session's record instead of expiring it", () => {
    const issued = issueCommand([], { sessionKey: KEY, text: "/goal-resume", source: "typed", now: 0 });
    const settled = settleCommand(issued.entries, issued.id, { state: "ok", now: 100 });
    // No linger expiry: the receipt stays readable long after the command ran.
    expect(settled.some((row) => row.text === "/goal-resume" && row.state === "ok")).toBe(true);
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
   * A command row reads in the vocabulary of a sent message, as pi's own
   * TUI shows a command inline and never as a transcript entry: queued
   * behind the reply in flight, running otherwise, read once the daemon ran
   * it, not sent when it refused. Every state is enumerated here.
   */
  it("reads every state with the message delivery vocabulary", () => {
    expect(commandDeliveryPresentation({ state: "pending" }, true)).toMatchObject({ text: "Queued", tone: "received", glyph: "single" });
    expect(commandDeliveryPresentation({ state: "pending" }, false)).toMatchObject({ text: "Running", tone: "pending", glyph: "pending" });
    expect(commandDeliveryPresentation({ state: "accepted" }, false)).toMatchObject({ text: "Queued", tone: "received", glyph: "single" });
    expect(commandDeliveryPresentation({ state: "ok" }, false)).toMatchObject({ text: "Read", tone: "delivered", glyph: "double" });
    expect(commandDeliveryPresentation({ state: "failed" }, false)).toMatchObject({ text: "Not sent", tone: "failed", glyph: "failed" });
  });

  it("shows the result beneath a settled bubble and names a silent failure", () => {
    expect(commandResultLine({ state: "pending" })).toBeUndefined();
    expect(commandResultLine({ state: "ok" })).toBeUndefined();
    expect(commandResultLine({ state: "accepted", resultText: "Runs after the current reply finishes." })).toBe("Runs after the current reply finishes.");
    expect(commandResultLine({ state: "ok", resultText: "Session name: opus-b" })).toBe("Session name: opus-b");
    expect(commandResultLine({ state: "failed", resultText: "/new is not implemented in the web UI yet" })).toBe("/new is not implemented in the web UI yet");
    expect(commandResultLine({ state: "failed" })).toBe("The command failed; see the error above.");
  });
});
