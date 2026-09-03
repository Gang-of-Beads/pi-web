import { describe, expect, it } from "vitest";
import { dismissCommand, issueCommand, settleCommand, withdrawCommand } from "./commandLedger";

const KEY = "machine-1::session-1";

function issued() {
  return issueCommand([], { text: "/goal", sessionKey: KEY, source: "typed", now: 1000 });
}

describe("a receipt can be closed exactly when it is finished", () => {
  it("refuses to close a row that is still waiting", () => {
    const { entries, id } = issued();
    expect(dismissCommand(entries, id)).toHaveLength(1);
  });

  it("closes a row that reported success", () => {
    const { entries, id } = issued();
    const settled = settleCommand(entries, id, { state: "ok", now: 2000 });
    expect(dismissCommand(settled, id)).toHaveLength(0);
  });

  it("closes a row that reported failure", () => {
    const { entries, id } = issued();
    const settled = settleCommand(entries, id, { state: "failed", resultText: "no", now: 2000 });
    expect(dismissCommand(settled, id)).toHaveLength(0);
  });

  it("withdraws a row whose command answered with a dialog", () => {
    const { entries, id } = issued();
    expect(withdrawCommand(entries, id)).toHaveLength(0);
  });

  it("leaves other rows alone when one is closed", () => {
    const first = issued();
    const settled = settleCommand(first.entries, first.id, { state: "ok", now: 2000 });
    const second = issueCommand(settled, { text: "/model", sessionKey: KEY, source: "typed", now: 3000 });
    const remaining = dismissCommand(second.entries, first.id);
    expect(remaining.map((entry) => entry.id)).toStrictEqual([second.id]);
  });

  it("ignores a close for a row that is not there", () => {
    expect(dismissCommand(issued().entries, "cmd-missing")).toHaveLength(1);
  });
});
