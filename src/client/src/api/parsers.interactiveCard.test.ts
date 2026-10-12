import { describe, expect, it } from "vitest";
import { parseSessionDialogClosedEvent, parseSessionDialogOpenedEvent } from "./parsers";

/**
 * The browser used to drop an extension's declared screen while parsing, so a
 * dialog the daemon described natively still arrived as a bare terminal frame.
 */
describe("a custom dialog declared as an interactive card", () => {
  const screen = {
    kind: "card",
    title: "Confirm Goal Draft",
    fields: [{ type: "choice", id: "confirm", label: "Confirm Goal Draft", detail: "x".repeat(20_000), options: [{ value: "0", label: "Confirm" }] }],
  };
  const dialog = { dialogId: "dialog-1", kind: "custom", title: "Confirm Goal Draft", lines: [], screen, askedAt: "2026-09-30T10:00:00.000Z", runScoped: true };

  it("keeps the declaration, including a proposal longer than a label", () => {
    expect(parseSessionDialogOpenedEvent({ type: "dialog.opened", dialog }).dialog.screen).toEqual(screen);
  });

  it("drops a dialog whose declaration is not a card rather than drawing it", () => {
    expect(() => parseSessionDialogOpenedEvent({ type: "dialog.opened", dialog: { ...dialog, screen: { kind: "menu", options: ["a"] } } })).toThrow();
  });

  it("reads the values a card closed with", () => {
    const answer = { values: { confirm: { selected: ["0"] } } };
    expect(parseSessionDialogClosedEvent({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered", answer }).answer).toEqual(answer);
  });
});
