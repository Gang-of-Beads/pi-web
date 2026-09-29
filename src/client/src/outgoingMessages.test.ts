import { describe, expect, it } from "vitest";
import { OUTGOING_EVENTS, OUTGOING_STATES, outgoingStateFromStorage, outgoingVerdict, type OutgoingState } from "./outgoingMessages.js";

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
  it("walks sending to received to queued to delivered", () => {
    expect(apply("sending", "send-started")).toBe("sending");
    expect(apply("sending", "send-accepted")).toBe("received");
    expect(apply("received", "daemon-queued")).toBe("queued");
    expect(apply("queued", "daemon-delivered")).toBe("delivered");
  });

  it("treats the transcript as the strongest proof, even when the transport said nothing", () => {
    expect(apply("unverifiable", "seen-in-transcript")).toBe("delivered");
    expect(apply("sending", "seen-in-transcript")).toBe("delivered");
  });

  it("calls a network refusal a failure the reader can retry", () => {
    expect(apply("sending", "send-refused-network")).toBe("failed");
  });

  it("calls a lost answer unverifiable rather than failed, because it may have landed", () => {
    expect(apply("sending", "send-timeout")).toBe("unverifiable");
    expect(apply("unverifiable", "daemon-queued")).toBe("queued");
  });

  it("fails a message the runtime refused after the inbox took it, so the reader can retry it", () => {
    expect({ received: apply("received", "send-refused-permanent"), queued: apply("queued", "send-refused-permanent") }).toEqual({ received: "failed", queued: "failed" });
  });

  it("reads the names earlier builds stored as the states they meant, and an unknown one as none", () => {
    expect({
      stored: outgoingStateFromStorage("stored"),
      accepted: outgoingStateFromStorage("accepted"),
      unverified: outgoingStateFromStorage("unverified"),
      current: outgoingStateFromStorage("queued"),
      unknown: outgoingStateFromStorage("committed-in-2027"),
    }).toEqual({ stored: "sending", accepted: "received", unverified: "unverifiable", current: "queued", unknown: undefined });
  });

  it("never moves a delivered message backwards", () => {
    for (const event of OUTGOING_EVENTS) {
      expect(["delivered", "dropped"]).toContain(apply("delivered", event));
    }
  });

  it("does not let a stale refusal undo an acceptance", () => {
    expect(apply("received", "send-refused-network")).toBe("received");
    expect(apply("queued", "send-timeout")).toBe("queued");
  });

  it("retries from failed and from unverifiable, and drops on discard or a gone scope", () => {
    expect(apply("failed", "retry")).toBe("sending");
    expect(apply("failed", "discard")).toBe("dropped");
    expect(apply("unverifiable", "discard")).toBe("dropped");
    for (const state of OUTGOING_STATES) {
      expect(apply(state, "scope-gone"), `${state} with a gone scope`).toBe("dropped");
    }
  });
});
