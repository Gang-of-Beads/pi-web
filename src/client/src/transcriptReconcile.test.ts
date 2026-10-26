import { describe, expect, it } from "vitest";

import { newClientMessageId, optimisticUserLine } from "./messageDelivery";
import { carryUnsettledForward } from "./transcriptReconcile";
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
  it("carries the waiting cards across the rebuild, in the order they were sent, the machine's answer or not", () => {
    const clientMessageId = newClientMessageId();
    const confirmed = optimisticUserLine("said, and confirmed", newClientMessageId());
    const previous: ChatLine[] = [
      ...(applyTranscriptEvent([], { type: "message.append", message: { role: "user", content: "earlier", timestamp: 500 } }) ?? []),
      { ...confirmed, meta: { ...confirmed.meta, delivery: { clientMessageId: confirmed.meta?.delivery?.clientMessageId ?? "", state: "received" } } },
      optimisticUserLine("still sending", clientMessageId),
    ];
    const rebuilt = applyTranscriptEvent([], { type: "message.append", message: { role: "user", content: "earlier", timestamp: 500 } }) ?? [];

    const healed = carryUnsettledForward(previous, rebuilt);

    expect(healed.map((line) => line.parts[0]?.type === "text" ? line.parts[0].text : "")).toEqual(["earlier", "said, and confirmed", "still sending"]);
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

/**
 * The rebuilt forms of a waiting message as the transcript itself builds them: a page line
 * carries the id as `meta.clientMessageId` and no delivery, and the daemon's echo carries it as
 * `echoClientMessageId`. The fixture above hands the rebuild a line with a delivery, which no
 * page line has, so it could not see a waiting row duplicated beside its committed copy.
 */
describe("a waiting message the rebuild already holds in another form", () => {
  const waiting = (clientMessageId: string): ChatLine => ({ ...optimisticUserLine("second thought", clientMessageId), meta: { ...optimisticUserLine("second thought", clientMessageId).meta, delivery: { clientMessageId, state: "queued", kind: "steer" } } });

  it("takes the place of its echo and keeps its state: acceptance is not reading", () => {
    const clientMessageId = newClientMessageId();
    const rebuilt = applyTranscriptEvent([], { type: "message.append", message: { role: "user", content: "second thought", timestamp: 900 }, echo: true, clientMessageId }) ?? [];

    const healed = carryUnsettledForward([waiting(clientMessageId)], rebuilt);

    expect(healed.map((line) => ({ state: line.meta?.delivery?.state, echo: line.meta?.echo === true }))).toEqual([{ state: "queued", echo: false }]);
  });

  it("becomes its committed copy, delivered, instead of standing beside it", () => {
    const clientMessageId = newClientMessageId();
    const rebuilt = applyTranscriptEvent([], { type: "message.append", message: { role: "user", content: "second thought", timestamp: 900, clientMessageId } }) ?? [];
    const committedHasNoDelivery = rebuilt[0]?.meta?.delivery === undefined && rebuilt[0]?.meta?.clientMessageId === clientMessageId;

    const healed = carryUnsettledForward([waiting(clientMessageId)], rebuilt);

    expect({ committedHasNoDelivery, states: healed.map((line) => line.meta?.delivery?.state) }).toEqual({ committedHasNoDelivery: true, states: ["delivered"] });
  });
});
