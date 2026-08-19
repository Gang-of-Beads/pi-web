import { describe, expect, it } from "vitest";
import { applyQueueToDelivery, findDeliveryLineIndex, isEchoOfTrackedMessage, markDelivery, newClientMessageId, optimisticUserLine, queuedMessagesWithoutBubbles } from "./messageDelivery";
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

describe("queuedMessagesWithoutBubbles", () => {
  it("hides a queued entry the sender already sees as a bubble", () => {
    // The duplicate render users reported: one send appearing as a transcript
    // bubble and as a "1 pending" queue row at the same time.
    const queued = [{ kind: "steer" as const, text: "hello", clientMessageId: ID }];
    expect(queuedMessagesWithoutBubbles(queued, [tracked("queued")])).toEqual([]);
  });

  it("keeps entries sent from another device or before ids existed", () => {
    const queued = [{ kind: "followUp" as const, text: "from my phone" }, { kind: "steer" as const, text: "other tab", clientMessageId: "cm-2" }];
    expect(queuedMessagesWithoutBubbles(queued, [tracked("queued")])).toEqual(queued);
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
