import { describe, expect, it } from "vitest";

import { newClientMessageId, optimisticUserLine } from "./messageDelivery";
import { carryUnsettledForward, hasWaitingDelivery } from "./transcriptReconcile";
import { applyTranscriptEvent } from "./chatTranscript";
import type { ChatLine } from "./components/shared";

/**
 * A dropped push frame leaves the screen wrong in two ways at once: the
 * sender's card waits forever for a confirmation that already happened, and a
 * reply that was written to disk never appears. The disk is the account of
 * record, so re-reading it must heal both without duplicating anything the
 * pushes did deliver.
 */
describe("rebuilding the transcript from disk while a send is still in flight", () => {
  /**
   * The refresh replaces the transcript with the disk view, and a send that
   * has not reached disk yet is not in that view: the sender watched their
   * own message vanish with no failure anywhere. Waiting cards ride across
   * the rebuild; the disk answers for everything else.
   */
  it("carries the waiting card across the rebuild", () => {
    const clientMessageId = newClientMessageId();
    const previous: ChatLine[] = [
      ...(applyTranscriptEvent([], { type: "message.append", message: { role: "user", content: "earlier", timestamp: 500 } }) ?? []),
      optimisticUserLine("still sending", clientMessageId),
    ];
    const rebuilt = applyTranscriptEvent([], { type: "message.append", message: { role: "user", content: "earlier", timestamp: 500 } }) ?? [];

    const healed = carryUnsettledForward(previous, rebuilt);

    expect(healed.some((line) => line.meta?.delivery?.clientMessageId === clientMessageId)).toBe(true);
  });

  it("does not duplicate a send the disk already has", () => {
    const clientMessageId = newClientMessageId();
    const pending = optimisticUserLine("ship it", clientMessageId);
    const committed: ChatLine = { ...pending, meta: { ...pending.meta, delivery: { clientMessageId, state: "delivered" } } };

    const healed = carryUnsettledForward([pending], [committed]);

    expect(healed.filter((line) => line.meta?.delivery?.clientMessageId === clientMessageId)).toHaveLength(1);
  });
});

describe("noticing a confirmation the pushes may have dropped", () => {
  it("sees a waiting card and stops seeing it once settled", () => {
    const pending = optimisticUserLine("ship it", newClientMessageId());

    expect(hasWaitingDelivery([pending])).toBe(true);
    expect(hasWaitingDelivery([])).toBe(false);
  });
});
