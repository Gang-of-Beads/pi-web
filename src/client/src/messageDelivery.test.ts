import { describe, expect, it } from "vitest";
import { applyQueueToDelivery, carryDeliveryForward, findDeliveryLineIndex, findTrackedUserLineIndex, isEchoOfTrackedMessage, markDelivery, newClientMessageId, optimisticUserLine, removeDeliveryLine } from "./messageDelivery";
import type { ChatLine } from "./components/shared";

const ID = "cm-1";

function tracked(state: "sending" | "received" | "queued" | "delivered" | "failed", id = ID, text = "hello"): ChatLine {
  return { role: "user", parts: [{ type: "text", text }], meta: { delivery: { clientMessageId: id, state } } };
}

function assistant(text = "working"): ChatLine {
  return { role: "assistant", parts: [{ type: "text", text }] };
}

describe("newClientMessageId", () => {
  it("mints distinct ids", () => {
    expect(newClientMessageId()).not.toBe(newClientMessageId());
  });
});

describe("optimisticUserLine", () => {
  it("renders the message as sending before any round trip", () => {
    const line = optimisticUserLine("ship it", ID);
    expect(line.role).toBe("user");
    expect(line.meta?.delivery).toEqual({ clientMessageId: ID, state: "sending" });
    expect(findDeliveryLineIndex([line], ID)).toBe(0);
  });
});

describe("markDelivery", () => {
  it("advances a message through the delivery states", () => {
    const advanced = markDelivery([tracked("sending")], ID, "received");
    expect(advanced[0]?.meta?.delivery?.state).toBe("received");
  });

  it("never moves a state backwards", () => {
    // A status update can arrive after the queue already drained; it must not
    // pull a delivered message back into the queue.
    const messages = [tracked("delivered")];
    expect(markDelivery(messages, ID, "queued")).toBe(messages);
    expect(markDelivery([tracked("received")], ID, "sending")[0]?.meta?.delivery?.state).toBe("received");
  });

  it("keeps the transcript identity when nothing changes", () => {
    const messages = [tracked("received")];
    expect(markDelivery(messages, ID, "received")).toBe(messages);
    expect(markDelivery(messages, "other-id", "delivered")).toBe(messages);
  });

  it("reports a failed send and does not let a late success undo it", () => {
    const failed = markDelivery([tracked("sending")], ID, "failed");
    expect(failed[0]?.meta?.delivery?.state).toBe("failed");
    expect(markDelivery(failed, ID, "received")).toBe(failed);
  });

  it("records the lane a queued message is waiting in", () => {
    const queued = markDelivery([tracked("received")], ID, "queued", "steer");
    expect(queued[0]?.meta?.delivery).toEqual({ clientMessageId: ID, state: "queued", kind: "steer" });
  });
});

describe("applyQueueToDelivery", () => {
  it("marks messages the agent still has as queued", () => {
    const next = applyQueueToDelivery([tracked("received")], [{ kind: "followUp", text: "hello", clientMessageId: ID }]);
    expect(next[0]?.meta?.delivery).toEqual({ clientMessageId: ID, state: "queued", kind: "followUp" });
  });

  it("marks a message delivered once it leaves the queue", () => {
    const next = applyQueueToDelivery([tracked("queued")], []);
    expect(next[0]?.meta?.delivery?.state).toBe("delivered");
  });

  it("leaves an in-flight send alone: absence from the queue proves nothing yet", () => {
    const messages = [tracked("sending")];
    expect(applyQueueToDelivery(messages, [])).toBe(messages);
  });

  it("ignores queue entries from other clients", () => {
    const messages = [tracked("received")];
    expect(applyQueueToDelivery(messages, [{ kind: "steer", text: "someone else" }])[0]?.meta?.delivery?.state).toBe("delivered");
  });
});

describe("removeDeliveryLine", () => {
  it("removes the bubble for a message taken back out of the queue", () => {
    // Recall puts the text back in the composer, so the transcript must not
    // keep a copy: an unsent message is not history.
    expect(removeDeliveryLine([tracked("queued"), assistant()], ID)).toEqual([assistant()]);
  });

  it("leaves the transcript alone when the bubble is already gone", () => {
    // The agent can take the message between the click and the response; the
    // status that comes back is then the truth and nothing here should change.
    const messages = [assistant()];
    expect(removeDeliveryLine(messages, ID)).toEqual(messages);
  });

  it("keeps a recalled message from being promoted to delivered", () => {
    // applyQueueToDelivery reads "no longer queued" as delivered, so a bubble
    // left behind after a recall would claim the agent had read it.
    const remaining = removeDeliveryLine([tracked("queued")], ID);
    expect(applyQueueToDelivery(remaining, [])).toEqual([]);
  });
});

describe("isEchoOfTrackedMessage", () => {
  it("recognises the server echo of a message this browser sent", () => {
    expect(isEchoOfTrackedMessage([tracked("sending"), assistant()], ID)).toBe(true);
  });

  it("treats an unknown or absent id as a new message", () => {
    expect(isEchoOfTrackedMessage([tracked("sending")], "cm-other")).toBe(false);
    expect(isEchoOfTrackedMessage([tracked("sending")], undefined)).toBe(false);
  });
});

describe("carryDeliveryForward", () => {
  it("moves the mark to delivered when the agent commits its own copy", () => {
    // The committed copy replaces the rendered bubble; without carrying the
    // state the mark vanished at the exact moment delivery was proven.
    const finalized: ChatLine = { role: "user", parts: [{ type: "text", text: "hello" }], meta: { timestamp: "2026-08-20T00:00:00.000Z" } };
    const carried = carryDeliveryForward(tracked("queued"), finalized);
    expect(carried.meta?.delivery).toEqual({ clientMessageId: ID, state: "delivered" });
    expect(carried.meta?.timestamp).toBe("2026-08-20T00:00:00.000Z");
  });

  it("leaves an untracked message untouched", () => {
    const finalized: ChatLine = { role: "user", parts: [{ type: "text", text: "hello" }] };
    expect(carryDeliveryForward({ role: "user", parts: [] }, finalized)).toBe(finalized);
  });

  it("does not claim delivery for a message that failed to send", () => {
    expect(carryDeliveryForward(tracked("failed"), { role: "user", parts: [] }).meta?.delivery?.state).toBe("failed");
  });
});

describe("findTrackedUserLineIndex", () => {
  it("finds the sender's bubble by text wherever it sits", () => {
    expect(findTrackedUserLineIndex([assistant(), tracked("received")], "hello")).toBe(1);
    expect(findTrackedUserLineIndex([tracked("received")], "other")).toBe(-1);
    expect(findTrackedUserLineIndex([{ role: "user", parts: [{ type: "text", text: "hello" }] }], "hello")).toBe(-1);
  });
});
