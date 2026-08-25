// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
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
