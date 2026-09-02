import { describe, expect, it } from "vitest";
import { commandOutcomeFor, dismissCommand, issueCommand, withdrawCommand } from "./commandLedger.js";

/**
 * A command that opens a dialog leaves no receipt behind.
 *
 * Receipts were settled by whether the request threw, which dressed a refusal
 * as success. Reporting what the command actually did fixed that, but it also
 * left the commands that answer with a dialog - select, tree - with no outcome
 * at all, so their rows stayed pending forever. A pending row cannot be
 * dismissed and is not evicted by the cap, so every dialog opened added a
 * permanent line to the transcript that the reader could not remove.
 *
 * The dialog is the acknowledgment. The row is withdrawn when one opens.
 */

describe("a command whose answer is a dialog", () => {
  it("has no receipt outcome, because nothing has happened yet", () => {
    expect(commandOutcomeFor({ type: "select", requestId: "r1", title: "Pick", options: [] })).toBeUndefined();
    expect(commandOutcomeFor({ type: "tree", tree: { nodes: [], activeLeafId: null, activePathIds: [] } })).toBeUndefined();
  });

  it("leaves no row behind once withdrawn", () => {
    const issued = issueCommand([], { sessionKey: "m:s", text: "/model", source: "typed", now: 1 });

    expect(withdrawCommand(issued.entries, issued.id)).toHaveLength(0);
  });

  it("withdraws only the row named, leaving other commands alone", () => {
    const first = issueCommand([], { sessionKey: "m:s", text: "/model", source: "typed", now: 1 });
    const second = issueCommand(first.entries, { sessionKey: "m:s", text: "/new", source: "typed", now: 2 });

    const remaining = withdrawCommand(second.entries, first.id);

    expect(remaining.map((row) => row.id)).toEqual([second.id]);
  });

  it("ignores an id that is not there", () => {
    const issued = issueCommand([], { sessionKey: "m:s", text: "/model", source: "typed", now: 1 });

    expect(withdrawCommand(issued.entries, "absent")).toHaveLength(1);
  });

  /** The stuck state this replaces: dismissal refuses a pending row. */
  it("could not be removed by dismissal, which is why withdrawal exists", () => {
    const issued = issueCommand([], { sessionKey: "m:s", text: "/model", source: "typed", now: 1 });

    expect(dismissCommand(issued.entries, issued.id)).toHaveLength(1);
  });
});
