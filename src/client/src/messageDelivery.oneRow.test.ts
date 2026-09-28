import { describe, expect, it } from "vitest";
import { discardAction, retryableDeliveryId, rowedClientMessageIds } from "./messageDelivery";
import type { ChatLine, MessageDeliveryState } from "./components/shared";

function tracked(state: MessageDeliveryState, id = "cm-1"): ChatLine {
  return { role: "user", parts: [{ type: "text", text: "hello" }], meta: { delivery: { clientMessageId: id, state } } };
}

describe("discardAction", () => {
  const expected: Record<MessageDeliveryState, boolean> = {
    sending: false,
    failed: true,
    unverifiable: true,
    received: false,
    queued: false,
    delivered: false,
  };

  const states: MessageDeliveryState[] = ["sending", "failed", "unverifiable", "received", "queued", "delivered"];
  for (const state of states) {
    it(`${expected[state] ? "offers" : "withholds"} Discard on a ${state} row`, () => {
      expect(discardAction(tracked(state))?.clientMessageId).toBe(expected[state] ? "cm-1" : undefined);
    });
  }

  it("offers nothing on a line this browser did not send", () => {
    expect(discardAction({})).toBeUndefined();
  });

  it("names what Discard does in the row's own terms, so the button never contradicts the mark beside it", () => {
    expect(discardAction(tracked("failed"))?.label).toContain("unsent");
    expect(discardAction(tracked("unverifiable"))?.label).not.toContain("unsent");
    expect(discardAction(tracked("unverifiable"))?.label).toContain("may already have arrived");
  });
});

describe("retryableDeliveryId", () => {
  it("offers Retry only where the outbox kept the message under its identity", () => {
    const states: MessageDeliveryState[] = ["sending", "failed", "unverifiable", "received", "queued", "delivered"];
    const offered = states.filter((state) => retryableDeliveryId(tracked(state)) !== undefined);
    expect(offered).toEqual(["failed", "unverifiable"]);
  });
});

describe("rowedClientMessageIds", () => {
  it("names every identity the transcript or the queue already draws, so the tray cannot repeat it", () => {
    const echo: ChatLine = { role: "user", parts: [], meta: { echo: true, echoClientMessageId: "cm-echo" } };
    const reloaded: ChatLine = { role: "user", parts: [], meta: { clientMessageId: "cm-reloaded" } };
    const ids = rowedClientMessageIds([tracked("sending", "cm-bubble"), echo, reloaded], [{ kind: "followUp", text: "q", clientMessageId: "cm-queued" }, { kind: "steer", text: "legacy" }]);
    expect([...ids].sort()).toEqual(["cm-bubble", "cm-echo", "cm-queued", "cm-reloaded"]);
  });

  it("leaves an outbox entry with no row unnamed, so a message recovered after a reload still has its one row", () => {
    expect(rowedClientMessageIds([], []).has("cm-recovered")).toBe(false);
  });
});
