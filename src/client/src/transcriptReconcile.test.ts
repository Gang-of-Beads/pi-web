import { describe, expect, it } from "vitest";

import { newClientMessageId, optimisticUserLine } from "./messageDelivery";
import { applyReplayedOutcomes, carryUnsettledForward, hasWaitingDelivery } from "./transcriptReconcile";
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

describe("a committed message with the same words as a refused one", () => {
  const failed = (clientMessageId: string): ChatLine => ({ ...optimisticUserLine("continue", clientMessageId), meta: { ...optimisticUserLine("continue", clientMessageId).meta, delivery: { clientMessageId, state: "failed" } } });

  it("leaves the refused message failed when the committed copy carries no id: they are two messages", () => {
    const clientMessageId = newClientMessageId();

    const next = applyTranscriptEvent([failed(clientMessageId)], { type: "message.end", message: { role: "user", content: "continue", timestamp: 900 } }) ?? [];

    expect(next.map((line) => line.meta?.delivery?.state ?? "transcript")).toEqual(["failed", "transcript"]);
  });

  it("lets the committed copy stamped with the refused message's own id overturn the failure", () => {
    const clientMessageId = newClientMessageId();

    const next = applyTranscriptEvent([failed(clientMessageId)], { type: "message.end", message: { role: "user", content: "continue", timestamp: 900, clientMessageId } }) ?? [];

    expect(next.map((line) => line.meta?.delivery?.state ?? "transcript")).toEqual(["delivered"]);
  });
});

describe("a failed send across a rebuild", () => {
  it("keeps its bubble and its Retry when the rebuild has no copy of it", () => {
    const clientMessageId = newClientMessageId();
    const failedRow: ChatLine = { ...optimisticUserLine("try again later", clientMessageId), meta: { ...optimisticUserLine("try again later", clientMessageId).meta, delivery: { clientMessageId, state: "failed" } } };

    expect(carryUnsettledForward([failedRow], []).map((line) => line.meta?.delivery?.state)).toEqual(["failed"]);
  });
});

describe("a replay's withdrawals and refusals", () => {
  it("take a recalled message's echo out of the rebuild and its row out of the view, and mark a refused row failed", () => {
    const recalled = newClientMessageId();
    const refused = newClientMessageId();
    const view: ChatLine[] = [optimisticUserLine("never mind", recalled), optimisticUserLine("not allowed", refused)];
    const rebuilt = applyTranscriptEvent([], { type: "message.append", message: { role: "user", content: "never mind", timestamp: 900 }, echo: true, clientMessageId: recalled }) ?? [];
    const outcomes = { withdrawn: [recalled], refused: [refused] };

    const healed = carryUnsettledForward(applyReplayedOutcomes(view, outcomes), applyReplayedOutcomes(rebuilt, outcomes));

    expect(healed.map((line) => ({ text: line.parts.map((part) => ("text" in part ? part.text : "")).join(""), state: line.meta?.delivery?.state }))).toEqual([{ text: "not allowed", state: "failed" }]);
  });
});

describe("noticing a confirmation the pushes may have dropped", () => {
  it("sees a waiting card and stops seeing it once settled", () => {
    const pending = optimisticUserLine("ship it", newClientMessageId());

    expect(hasWaitingDelivery([pending])).toBe(true);
    expect(hasWaitingDelivery([])).toBe(false);
  });
});
