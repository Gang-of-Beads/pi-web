import { describe, expect, it } from "vitest";
import { parseSessionDialogClosedEvent, parseSessionDialogOpenedEvent } from "./parsers";

/**
 * The browser used to drop an extension's declared screen while parsing, so a
 * dialog the daemon described natively still arrived as a bare terminal frame.
 */
describe("a custom dialog declared as questions", () => {
  const screen = {
    kind: "questions",
    title: "Confirm Goal Draft",
    questions: [{ id: "confirm", question: "Confirm Goal Draft", detail: "x".repeat(3_000), options: [{ value: "0", label: "Confirm" }], custom: false }],
  };
  const dialog = { dialogId: "dialog-1", kind: "custom", title: "Confirm Goal Draft", lines: [], screen, askedAt: "2026-09-30T10:00:00.000Z", runScoped: true };

  it("keeps the declaration, including a proposal longer than an ask's detail", () => {
    expect(parseSessionDialogOpenedEvent({ type: "dialog.opened", dialog }).dialog.screen).toEqual(screen);
  });

  it("drops a dialog whose declaration is not questions rather than drawing it", () => {
    expect(() => parseSessionDialogOpenedEvent({ type: "dialog.opened", dialog: { ...dialog, screen: { kind: "menu", options: ["a"] } } })).toThrow();
  });

  it("reads the answers a questions dialog closed with", () => {
    const answer = { answers: [{ id: "confirm", values: ["0"] }] };
    expect(parseSessionDialogClosedEvent({ type: "dialog.closed", dialogId: "dialog-1", reason: "answered", answer }).answer).toEqual(answer);
  });
});
