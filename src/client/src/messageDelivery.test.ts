import { describe, expect, it } from "vitest";
import { applyQueueToDelivery, carryDeliveryForward, findDeliveryLineIndex, findTrackedUserLineIndex, isEchoOfTrackedMessage, markDelivery, newClientMessageId, optimisticUserLine, withdrawDeliveryLine } from "./messageDelivery";
import type { ChatLine, MessageDeliveryState } from "./components/shared";

const ID = "cm-1";

function tracked(state: MessageDeliveryState, id = ID, text = "hello"): ChatLine {
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

  /**
   * This file used to assert the opposite one line above the case that
   * contradicted it: absence settled a `queued` bubble, while absence left a
   * `sending` one alone. A queue snapshot cannot tell those apart - it simply
   * does not mention the message - and the agent omits a message from it while
   * expanding a prompt, and between taking it and writing it to the
   * transcript. Settling on that produced both reported defects: the bubble
   * lost its mark, its own queue entry could then no longer claim it, and the
   * entry was drawn a second time or vanished outright.
   *
   * Delivery is proved by the agent's committed copy (carryDeliveryForward),
   * never by a gap in a snapshot.
   */
  it("leaves a queued message queued when a snapshot omits it", () => {
    const next = applyQueueToDelivery([tracked("queued")], []);
    expect(next[0]?.meta?.delivery?.state).toBe("queued");
  });

  it("leaves an in-flight send alone: absence from the queue proves nothing yet", () => {
    const messages = [tracked("sending")];
    expect(applyQueueToDelivery(messages, [])).toBe(messages);
  });

  it("does not settle a received message because the queue only holds another client's", () => {
    const messages = [tracked("received")];
    expect(applyQueueToDelivery(messages, [{ kind: "steer", text: "someone else" }])[0]?.meta?.delivery?.state).toBe("received");
  });
});

describe("withdrawDeliveryLine on recall and Stop", () => {
  it("removes the bubble for a message taken back out of the queue", () => {
    // Recall puts the text back in the composer, so the transcript must not
    // keep a copy: an unsent message is not history.
    expect(withdrawDeliveryLine([tracked("queued"), assistant()], ID)).toEqual([assistant()]);
  });

  it("leaves the transcript alone when the bubble is already gone", () => {
    // The agent can take the message between the click and the response; the
    // status that comes back is then the truth and nothing here should change.
    const messages = [assistant()];
    expect(withdrawDeliveryLine(messages, ID)).toEqual(messages);
  });

  it("keeps a recalled message from being settled by a later status", () => {
    const remaining = withdrawDeliveryLine([tracked("queued")], ID);
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
});

describe("findTrackedUserLineIndex", () => {
  it("finds the sender's bubble by text wherever it sits", () => {
    expect(findTrackedUserLineIndex([assistant(), tracked("received")], "hello")).toBe(1);
    expect(findTrackedUserLineIndex([tracked("received")], "other")).toBe(-1);
    expect(findTrackedUserLineIndex([{ role: "user", parts: [{ type: "text", text: "hello" }] }], "hello")).toBe(-1);
  });
});

describe("optimisticUserLine with attachments", () => {
  it("keeps the images with the bubble, since the queue only keeps text", () => {
    // A pending prompt that was mostly a screenshot rendered as an empty-looking
    // line: the session's queue carries the text of a queued message and nothing
    // else, so the bubble is the only place the picture can survive until the
    // agent takes it.
    const line = optimisticUserLine("look at this", "c1", [
      { kind: "image", mimeType: "image/png", data: "AAAA", name: "shot.png" },
      { kind: "file", mimeType: "application/pdf", data: "BBBB", name: "spec.pdf" },
    ]);

    expect(line.parts).toEqual([
      { type: "text", text: "look at this" },
      // Files are referenced from the prompt text once saved, so only images
      // are carried here.
      { type: "image", mimeType: "image/png", data: "AAAA" },
    ]);
  });

  it("drops the empty text part when the prompt is only a picture", () => {
    const line = optimisticUserLine("", "c2", [{ kind: "image", mimeType: "image/webp", data: "CCCC" }]);
    expect(line.parts).toEqual([{ type: "image", mimeType: "image/webp", data: "CCCC" }]);
  });

  it("is unchanged for a plain text prompt", () => {
    expect(optimisticUserLine("just words", "c3").parts).toEqual([{ type: "text", text: "just words" }]);
  });
});

describe("the bubble the browser draws for what you just sent", () => {
  /**
   * A streaming reply reaches the transcript only when it finishes, so it can
   * arrive after a message sent while waiting for it. Placement walks back over
   * anything newer, but stops at a line it cannot compare - and this bubble
   * carried no timestamp at all.
   *
   * So a reply landed underneath a message written after it, and the record
   * read as though the assistant had answered something it never saw.
   */
  it("carries the moment it was written", () => {
    const line = optimisticUserLine("hello", "cm-1", []);

    expect(line.meta?.timestamp).toBeTypeOf("string");
    expect(Date.parse(line.meta?.timestamp ?? "")).not.toBeNaN();
  });
});

describe("queue reconciliation against runtime state", () => {
  const queuedRow: ChatLine = { role: "user", parts: [{ type: "text", text: "steer me" }], meta: { delivery: { clientMessageId: "c-q", state: "queued" } } };

  it("moves a queued row an idle runtime no longer holds to received, leaving read to the transcript", () => {
    const out = applyQueueToDelivery([queuedRow], [], true);
    expect(out[0]?.meta?.delivery?.state).toBe("received");
  });

  it("leaves a queued row alone while the runtime is mid-turn", () => {
    const out = applyQueueToDelivery([queuedRow], [], false);
    expect(out[0]?.meta?.delivery?.state).toBe("queued");
  });

  it("keeps a row the queue still holds", () => {
    const out = applyQueueToDelivery([queuedRow], [{ kind: "steer", text: "steer me", clientMessageId: "c-q" }], true);
    expect(out[0]?.meta?.delivery?.state).toBe("queued");
  });
});
