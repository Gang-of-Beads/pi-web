// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "./ChatView";
import type { ChatView } from "./ChatView";

describe("ChatView earlier-messages boundary", () => {
  beforeEach(() => {
    document.body.innerHTML = "<chat-view></chat-view>";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mount(): Promise<ChatView> {
    const view = document.body.querySelector<ChatView>("chat-view");
    if (view === null) throw new Error("chat view did not mount");
    view.messages = [{ role: "user", parts: [{ type: "text", text: "one" }] }];
    await view.updateComplete;
    Reflect.set(view, "viewportState", { kind: "holding" });
    return view;
  }

  function boundary(view: ChatView): Element | undefined {
    return [...view.renderRoot.querySelectorAll(".history-boundary")]
      .find((element) => {
        const text = element.textContent;
        return text.includes("Earlier messages") || text.includes("Loading earlier");
      });
  }

  it("does not claim to be loading an earlier page that nobody asked for", async () => {
    const view = await mount();
    view.messageStart = 400;
    view.messageEnd = 800;
    view.messageTotal = 800;
    view.hasMore = true;
    view.loadingMore = false;
    await view.updateComplete;
    const caption = boundary(view);
    // A window that merely has rows above it read "Loading earlier messages…"
    // forever: the reader waited for a page no render had asked for.
    expect(caption?.textContent).toContain("Earlier messages load as you scroll up");
    expect(caption?.textContent).not.toContain("Loading earlier");
    expect(caption?.querySelector("[role='status']")).toBeNull();
  });

  it("says it is loading the earlier page while one is on its way", async () => {
    const view = await mount();
    view.messageStart = 400;
    view.messageEnd = 800;
    view.messageTotal = 800;
    view.hasMore = true;
    view.loadingMore = true;
    await view.updateComplete;
    expect(boundary(view)?.textContent).toContain("Loading earlier messages…");
  });

  it("keeps the earlier caption off a newer read in flight", async () => {
    const view = await mount();
    view.messageStart = 400;
    view.messageEnd = 800;
    view.messageTotal = 1000;
    view.hasMore = true;
    view.hasNewer = true;
    view.newerCount = 200;
    view.loadingMore = true;
    view.loadingNewer = true;
    await view.updateComplete;
    // The page on its way is the newer one; the top of the window is still
    // waiting for a page nobody asked for, and saying so made the two ends read
    // as loading each other's spans.
    expect(boundary(view)?.textContent).toContain("Earlier messages load as you scroll up");
    expect(boundary(view)?.textContent).not.toContain("Loading earlier");
  });
});
