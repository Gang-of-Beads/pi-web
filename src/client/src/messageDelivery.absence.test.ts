import { describe, expect, it } from "vitest";
import type { QueuedSessionMessage } from "../../shared/apiTypes";
import type { ChatLine } from "./components/shared";
import { applyQueueToDelivery, carryDeliveryForward, splitTranscriptAndPending } from "./messageDelivery";

/**
 * A queue snapshot says what is queued right now. It does not say what was
 * delivered, and it cannot: a message is missing from it while it is being
 * expanded, while it sits between "taken from the queue" and "written to the
 * transcript", and whenever its identity failed to be stamped at all.
 *
 * Reading that absence as delivery is what produced both owner-reported
 * defects. The bubble lost its queued mark and turned into an ordinary blue
 * card, and the queue entry - now unclaimable, because claiming only considers
 * bubbles that are still waiting - was drawn a second time as an amber row.
 * When the entry did not come back, the row vanished instead.
 *
 * Delivery has its own positive evidence: the agent's committed copy of the
 * message, carried by carryDeliveryForward. These tests pin that only that
 * evidence settles a message.
 */

function tracked(id: string, text: string, state: "sending" | "received" | "queued" | "delivered"): ChatLine {
  return { role: "user", parts: [{ type: "text", text }], meta: { delivery: { clientMessageId: id, state } } };
}

function queuedEntry(over: Partial<QueuedSessionMessage> & { text: string }): QueuedSessionMessage {
  return { kind: "steer", ...over };
}

describe("absence from a queue snapshot", () => {
  it("does not settle a queued message that the snapshot omits", () => {
    const messages = [tracked("id-a", "make them smaller", "queued")];

    const next = applyQueueToDelivery(messages, []);

    expect(next[0]?.meta?.delivery?.state).toBe("queued");
  });

  it("does not settle a received message that the snapshot omits", () => {
    const messages = [tracked("id-a", "make them smaller", "received")];

    const next = applyQueueToDelivery(messages, []);

    expect(next[0]?.meta?.delivery?.state).toBe("received");
  });

  /**
   * The stamping of clientId onto a queue entry matches on text, and the agent
   * expands a prompt before queueing it, so an entry can be present under text
   * the browser never sent. The bubble must not be settled by that either.
   */
  it("does not settle a message when the queue holds it under expanded text", () => {
    const messages = [tracked("id-a", "/tidy", "queued")];

    const next = applyQueueToDelivery(messages, [queuedEntry({ text: "tidy the imports in src/" })]);

    expect(next[0]?.meta?.delivery?.state).toBe("queued");
  });

  it("still marks a message queued when the snapshot claims it by id", () => {
    const messages = [tracked("id-a", "make them smaller", "sending")];

    const next = applyQueueToDelivery(messages, [queuedEntry({ text: "make them smaller", clientMessageId: "id-a" })]);

    expect(next[0]?.meta?.delivery?.state).toBe("queued");
  });

  it("settles a message only on the agent's committed copy", () => {
    const previous = tracked("id-a", "make them smaller", "queued");
    const committed: ChatLine = { role: "user", parts: [{ type: "text", text: "make them smaller" }] };

    const carried = carryDeliveryForward(previous, committed);

    expect(carried.meta?.delivery?.state).toBe("delivered");
  });

  it("leaves a failed message failed when its committed copy arrives", () => {
    const previous = tracked("id-a", "make them smaller", "sending");
    const failed: ChatLine = { ...previous, meta: { delivery: { clientMessageId: "id-a", state: "failed" } } };

    const carried = carryDeliveryForward(failed, { role: "user", parts: [{ type: "text", text: "make them smaller" }] });

    expect(carried.meta?.delivery?.state).toBe("failed");
  });
});

describe("one message renders on exactly one row", () => {
  /** The owner's screenshot: a blue transcript card and an amber queued card. */
  it("claims the waiting bubble instead of synthesizing a second row", () => {
    const messages = [tracked("id-a", "make them smaller", "queued")];

    const split = splitTranscriptAndPending(messages, [queuedEntry({ text: "make them smaller", clientMessageId: "id-a" })]);

    expect(split.pending).toHaveLength(1);
    expect(split.settled).toHaveLength(0);
  });

  /**
   * The regression itself: once absence had settled the bubble, the entry could
   * no longer claim it, because claiming only looks at bubbles still waiting.
   */
  it("still claims its bubble after a snapshot that omitted it", () => {
    const messages = applyQueueToDelivery([tracked("id-a", "make them smaller", "queued")], []);

    const split = splitTranscriptAndPending(messages, [queuedEntry({ text: "make them smaller", clientMessageId: "id-a" })]);

    expect(split.pending).toHaveLength(1);
    expect(split.settled).toHaveLength(0);
  });

  it("does not draw a queued row for a message the agent has committed", () => {
    const messages = [tracked("id-a", "make them smaller", "delivered")];

    const split = splitTranscriptAndPending(messages, []);

    expect(split.pending).toHaveLength(0);
    expect(split.settled).toHaveLength(1);
  });
});
