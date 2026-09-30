import { describe, expect, it } from "vitest";
import { pendingPromptActions, trayState, type PendingPromptState } from "./pendingPromptActions";

/**
 * Owner report: "a message already confirmed as being processed - how can it still
 * have retry/discard? Some states simply cannot exist together". A message on its way cannot be re-sent, and a message the
 * daemon confirmed is no longer a tray row at all. The words are the bubble's
 * (owner, 2026-09-30): Sending… / Receiving… / Not sent / Not received.
 */
describe("what an undelivered prompt offers", () => {
  it("offers nothing while the message is on its way", () => {
    expect(pendingPromptActions("sending")).toEqual({ state: "sending", label: "Sending…", retry: false, discard: false });
  });

  it("offers a retry once the send has stopped, in the bubble's words", () => {
    expect({
      unverifiable: pendingPromptActions("unverifiable"),
      notSent: pendingPromptActions("not-sent"),
      notReceived: pendingPromptActions("not-received"),
    }).toEqual({
      unverifiable: { state: "unverifiable", label: "Receiving…", retry: true, discard: true },
      notSent: { state: "not-sent", label: "Not sent", retry: true, discard: true },
      notReceived: { state: "not-received", label: "Not received", retry: true, discard: true },
    });
  });

  it("answers every state it can be asked about", () => {
    const states: PendingPromptState[] = ["sending", "unverifiable", "not-sent", "not-received"];
    for (const state of states) {
      const actions = pendingPromptActions(state);
      expect(actions.state).toBe(state);
      expect(actions.label).not.toBe("");
    }
  });
});

describe("which words a tray record reads", () => {
  it("is sending on its way, its cause once failed, and receiving once it stopped unconfirmed", () => {
    expect({
      inFlight: trayState({ state: "failed" }, true),
      failedWithoutCause: trayState({ state: "failed" }, false),
      failedNotReceived: trayState({ state: "failed", failure: "not-received" }, false),
      stopped: trayState({ state: "unverifiable" }, false),
      stored: trayState({}, false),
    }).toEqual({ inFlight: "sending", failedWithoutCause: "not-sent", failedNotReceived: "not-received", stopped: "unverifiable", stored: "unverifiable" });
  });
});
