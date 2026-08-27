// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
import { chatDeliveryMarkerVisible } from "./ChatView";
import type { ChatLine } from "./shared";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

async function mount(messages: ChatLine[]): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-meta";
  view.messages = messages;
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function metaSpans(view: ChatView): HTMLElement[] {
  return [...(view.shadowRoot?.querySelectorAll<HTMLElement>(".msg-meta") ?? [])];
}

describe("the message header's metadata", () => {
  it("is shown for a message the server has described", async () => {
    const view = await mount([{
      role: "assistant",
      parts: [{ type: "text", text: "answer" }],
      meta: { timestamp: "2026-07-10T19:15:30.000Z", model: { provider: "anthropic", id: "claude-opus-5" } },
    }]);

    const [span] = metaSpans(view);
    expect(span?.textContent).toContain("anthropic/claude-opus-5");
  });

  // A message just typed here has no server metadata, which is its ordinary
  // state: the header used to announce that in the place a timestamp sits.
  it("is left out entirely for a message that has none", async () => {
    const view = await mount([{ role: "user", parts: [{ type: "text", text: "just typed" }] }]);

    expect(metaSpans(view).length).toBe(0);
    expect(view.shadowRoot?.textContent ?? "").not.toContain("No Pi message metadata");
  });

  it("keeps the described message's header when an undescribed one sits beside it", async () => {
    const view = await mount([
      { role: "user", parts: [{ type: "text", text: "just typed" }] },
      {
        role: "assistant",
        parts: [{ type: "text", text: "answer" }],
        meta: { timestamp: "2026-07-10T19:15:30.000Z", model: { provider: "anthropic", id: "claude-opus-5" } },
      },
    ]);

    expect(metaSpans(view).length).toBe(1);
  });
});

describe("which messages carry a delivery marker", () => {
  /**
   * Messages read back from the transcript have no delivery record and showed
   * nothing, while messages sent this session kept a double tick forever. The
   * same settled message therefore looked one way before a reload and another
   * way after, and the transcript was a mix of ticks, yellow queue chips and
   * bare bubbles with no rule connecting them.
   *
   * A marker says the outcome is not settled yet. Once the agent has taken the
   * message, there is nothing left to report, and the bubble looks like every
   * other message the agent has taken - including the ones from before the
   * reload.
   */
  it("marks a message whose outcome is still open", () => {
    expect(chatDeliveryMarkerVisible({ state: "queued", kind: "steer", clientMessageId: "m1" })).toBe(true);
    expect(chatDeliveryMarkerVisible({ state: "sending", clientMessageId: "m1" })).toBe(true);
    expect(chatDeliveryMarkerVisible({ state: "failed", clientMessageId: "m1" })).toBe(true);
    expect(chatDeliveryMarkerVisible({ state: "received", clientMessageId: "m1" })).toBe(true);
  });

  it("says nothing once the agent has taken the message", () => {
    expect(chatDeliveryMarkerVisible({ state: "delivered", clientMessageId: "m1" })).toBe(false);
  });

  it("says nothing about a message with no delivery record", () => {
    expect(chatDeliveryMarkerVisible(undefined)).toBe(false);
  });
});
