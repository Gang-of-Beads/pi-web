import { describe, expect, it } from "vitest";
import { discardableDeliveryId, retryableDeliveryId, rowedClientMessageIds } from "./messageDelivery";
import type { ChatLine, MessageDeliveryState } from "./components/shared";

function tracked(state: MessageDeliveryState, id = "cm-1"): ChatLine {
  return { role: "user", parts: [{ type: "text", text: "hello" }], meta: { delivery: { clientMessageId: id, state } } };
}

describe("discardableDeliveryId", () => {
  const expected: Record<MessageDeliveryState, boolean> = {
    sending: true,
    failed: true,
    unverifiable: true,
    received: false,
    queued: false,
    delivered: false,
  };

  const states: MessageDeliveryState[] = ["sending", "failed", "unverifiable", "received", "queued", "delivered"];
  for (const state of states) {
    it(`${expected[state] ? "offers" : "withholds"} Discard on a ${state} row`, () => {
      expect(discardableDeliveryId(tracked(state))).toBe(expected[state] ? "cm-1" : undefined);
    });
  }

  it("offers nothing on a line this browser did not send", () => {
    expect(discardableDeliveryId({})).toBeUndefined();
  });
});

describe("retryableDeliveryId", () => {
  it("offers Retry only where the outbox kept the message under its identity", () => {
    const states: MessageDeliveryState[] = ["sending", "failed", "unverifiable", "received", "queued", "delivered"];
    const offered = states.filter((state) => retryableDeliveryId(tracked(state)) !== undefined);
    expect(offered).toEqual(["unverifiable"]);
  });
});

describe("rowedClientMessageIds", () => {
  it("names every identity the transcript or the queue already draws, so the tray cannot repeat it", () => {
    const echo: ChatLine = { role: "user", parts: [], meta: { echo: true, echoClientMessageId: "cm-echo" } };
    const ids = rowedClientMessageIds([tracked("sending", "cm-bubble"), echo], [{ kind: "followUp", text: "q", clientMessageId: "cm-queued" }, { kind: "steer", text: "legacy" }]);
    expect([...ids].sort()).toEqual(["cm-bubble", "cm-echo", "cm-queued"]);
  });

  it("leaves an outbox entry with no row unnamed, so a message recovered after a reload still has its one row", () => {
    expect(rowedClientMessageIds([], []).has("cm-recovered")).toBe(false);
  });
});
