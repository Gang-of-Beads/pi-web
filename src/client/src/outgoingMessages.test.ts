import { describe, expect, it } from "vitest";
import { OUTGOING_EVENTS, OUTGOING_STATES, outgoingVerdict, type OutgoingState } from "./outgoingMessages.js";

const apply = (state: OutgoingState, event: (typeof OUTGOING_EVENTS)[number]): OutgoingState | "dropped" => {
  const verdict = outgoingVerdict(state, event);
  if (verdict.kind === "move") return verdict.to;
  if (verdict.kind === "drop") return "dropped";
  return state;
};

describe("every state answers every event", () => {
  it("has a verdict for the whole cross product", () => {
    for (const state of OUTGOING_STATES) {
      for (const event of OUTGOING_EVENTS) {
        expect(outgoingVerdict(state, event).kind, `${state} x ${event}`).toBeTypeOf("string");
      }
    }
  });
});

describe("a send's own life", () => {
  it("walks stored to sending to accepted to delivered", () => {
    expect(apply("stored", "send-started")).toBe("sending");
    expect(apply("sending", "send-accepted")).toBe("accepted");
    expect(apply("accepted", "daemon-delivered")).toBe("delivered");
  });

  it("treats the transcript as the strongest proof, even when the transport said nothing", () => {
    expect(apply("unverified", "seen-in-transcript")).toBe("delivered");
    expect(apply("sending", "seen-in-transcript")).toBe("delivered");
  });

  it("calls a network refusal a failure the reader can retry", () => {
    expect(apply("sending", "send-refused-network")).toBe("failed");
  });

  it("calls a lost answer unverified rather than failed, because it may have landed", () => {
    expect(apply("sending", "send-timeout")).toBe("unverified");
    expect(apply("unverified", "daemon-queued")).toBe("accepted");
  });

  it("never moves a delivered message backwards", () => {
    for (const event of OUTGOING_EVENTS) {
      expect(["delivered", "dropped"]).toContain(apply("delivered", event));
    }
  });

  it("does not let a stale refusal undo an acceptance", () => {
    expect(apply("accepted", "send-refused-network")).toBe("accepted");
    expect(apply("accepted", "send-timeout")).toBe("accepted");
  });

  it("retries from failed and from unverified, and drops on discard or a gone scope", () => {
    expect(apply("failed", "retry")).toBe("sending");
    expect(apply("failed", "discard")).toBe("dropped");
    expect(apply("unverified", "discard")).toBe("dropped");
    for (const state of OUTGOING_STATES) {
      expect(apply(state, "scope-gone"), `${state} with a gone scope`).toBe("dropped");
    }
  });
});
