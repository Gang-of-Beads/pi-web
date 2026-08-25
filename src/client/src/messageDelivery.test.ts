import { describe, expect, it } from "vitest";
import { applyQueueToDelivery, transcriptWithPendingInQueueOrder, carryDeliveryForward, findDeliveryLineIndex, findTrackedUserLineIndex, isEchoOfTrackedMessage, markDelivery, newClientMessageId, optimisticUserLine, removeDeliveryLine } from "./messageDelivery";
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

describe("transcriptWithPendingInQueueOrder", () => {
  it("puts a locally sent message after one queued earlier elsewhere", () => {
    // The reported symptom: a message sent seconds ago rendered above one
    // queued minutes earlier, because the first had a bubble in the transcript
    // and the second was drawn in a panel below the whole transcript.
    const mine = { role: "user" as const, parts: [{ type: "text" as const, text: "mine, just now" }], meta: { delivery: { clientMessageId: "c1", state: "queued" as const, kind: "steer" as const } } };
    const ordered = transcriptWithPendingInQueueOrder([mine], [
      { kind: "steer", text: "queued earlier, from my phone" },
      { kind: "steer", text: "mine, just now", clientMessageId: "c1" },
    ]);

    expect(ordered.map(firstText)).toEqual(["queued earlier, from my phone", "mine, just now"]);
  });

  it("leaves delivered history alone and keeps it before the pending tail", () => {
    const delivered = { role: "assistant" as const, parts: [{ type: "text" as const, text: "an answer" }] };
    const ordered = transcriptWithPendingInQueueOrder([delivered], [{ kind: "followUp", text: "waiting" }]);
    expect(ordered.map(firstText)).toEqual(["an answer", "waiting"]);
  });

  it("is a no-op with an empty queue", () => {
    const line = { role: "user" as const, parts: [{ type: "text" as const, text: "said" }] };
    expect(transcriptWithPendingInQueueOrder([line], [])).toEqual([line]);
  });
});

function firstText(line: ChatLine): string {
  const part = line.parts[0];
  return part?.type === "text" ? part.text : "";
}

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
