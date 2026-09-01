// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { PendingAskUser } from "../../../shared/apiTypes";
import type { ChatLine } from "./shared";
import { ChatView } from "./ChatView";

/**
 * A waiting card is a transcript row that sticks.
 *
 * Held outside the scroller it could not be pushed away, but it claimed a
 * third of a phone's height and refused to give any of it back, so its own
 * confirm buttons fell past the fold and the page would not scroll. Placed in
 * the transcript it scrolls and can be read in full at any length - and
 * `position: sticky` keeps it against the bottom edge while it is unanswered,
 * so the reply that arrives after it still cannot carry it out of reach.
 */

function ask(): PendingAskUser {
  return {
    askId: "ask-1",
    askedAt: "2026-09-01T00:00:00.000Z",
    questions: [{ id: "q1", question: "Which one?", options: [{ value: "a", label: "A" }] }],
  };
}

function userLine(text: string): ChatLine {
  return { role: "user", parts: [{ type: "text", text }] };
}

async function mount(patch: Partial<ChatView>): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "s";
  view.messages = [userLine("hello")];
  Object.assign(view, patch);
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function scroller(view: ChatView): Element | null {
  return view.renderRoot.querySelector(".chat");
}

function slotRule(): string {
  const sheets = Array.isArray(ChatView.styles) ? ChatView.styles : [ChatView.styles];
  const css = sheets.map((sheet) => String(sheet)).join("\n");
  const match = /\.waiting-slot\s*\{([^}]*)\}/u.exec(css);
  return match?.[1] ?? "";
}

afterEach(() => { document.body.replaceChildren(); });

describe("a waiting question lives in the transcript", () => {
  it("renders the question inside the scroller", async () => {
    const view = await mount({ pendingAsk: ask() });

    expect(scroller(view)?.querySelector("ask-user-card")).not.toBeNull();
  });

  it("keeps the slot inside the scroller rather than beside it", async () => {
    const view = await mount({ pendingAsk: ask() });

    expect(view.renderRoot.querySelector(".waiting-slot")?.closest(".chat")).not.toBeNull();
  });

  it("does not cap the card's height, so a long question can be read in full", () => {
    expect(slotRule()).not.toContain("max-height");
  });

  it("does not refuse to shrink, which is what pushed its actions past the fold", () => {
    expect(slotRule()).not.toContain("flex: 0 0 auto");
  });
});

describe("an unanswered question is what the bottom of the transcript reaches", () => {
  it("renders after every settled message, the way a queued message does", async () => {
    const view = await mount({ pendingAsk: ask() });
    const chat = scroller(view);
    const rows = [...(chat?.children ?? [])];
    const slotIndex = rows.findIndex((row) => row.classList.contains("waiting-slot"));

    expect(slotIndex).toBe(rows.length - 1);
  });

  it("pins nothing, so the transcript still scrolls at any card height", () => {
    expect(slotRule()).not.toContain("position: sticky");
  });

  it("covers nothing, so no option sits under the card's own footer", async () => {
    const view = await mount({ pendingAsk: ask() });
    const chat = scroller(view);

    expect(chat?.querySelector(".waiting-slot [style*='position: fixed']")).toBeNull();
  });
});
