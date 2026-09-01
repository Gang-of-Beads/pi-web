import { describe, expect, it } from "vitest";
import { commandOutcomeFor } from "./commandLedger";

/**
 * A receipt reports what the server did, not whether the request reached it.
 *
 * The ledger settled every command that did not throw as "ok", so a command
 * the server refused outright still displayed "/new done" — beside the system
 * line saying "/new is not implemented in the web UI yet". Two receipts for
 * one action, disagreeing, and the green one is the one a reader believes.
 */

describe("what a command result means for its receipt", () => {
  it("reports a completed command as done", () => {
    expect(commandOutcomeFor({ type: "done" })?.state).toBe("ok");
  });

  it("carries a completed command's message as the receipt's text", () => {
    expect(commandOutcomeFor({ type: "done", message: "renamed" })?.resultText).toBe("renamed");
  });

  it("does not report a refused command as done", () => {
    expect(commandOutcomeFor({ type: "unsupported", message: "/new is not implemented in the web UI yet" })?.state).toBe("failed");
  });

  it("gives the refusal's own words to the reader", () => {
    const outcome = commandOutcomeFor({ type: "unsupported", message: "/new is not implemented in the web UI yet" });

    expect(outcome?.resultText).toBe("/new is not implemented in the web UI yet");
  });

  /** A dialog is not an outcome: the command is still waiting on the reader. */
  it("leaves a command that opened a dialog unsettled", () => {
    expect(commandOutcomeFor({ type: "select", requestId: "r", title: "Pick one", options: [] })).toBeUndefined();
    expect(commandOutcomeFor({ type: "tree", tree: { nodes: [], activeLeafId: null, activePathIds: [] } })).toBeUndefined();
  });
});
