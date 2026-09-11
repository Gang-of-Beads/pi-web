// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "./ChatView";
import type { ChatView } from "./ChatView";

describe("ChatView newer-messages boundary", () => {
  beforeEach(() => {
    document.body.innerHTML = "<chat-view></chat-view>";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mount(): Promise<ChatView> {
    const view = document.body.querySelector<ChatView>("chat-view");
    if (view === null) throw new Error("chat view did not mount");
    view.messages = [];
    await view.updateComplete;
    return view;
  }

  it("renders no newer boundary when the span reaches the transcript total", async () => {
    const view = await mount();
    view.messageEnd = 400;
    view.messageTotal = 400;
    view.hasNewer = false;
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".history-boundary:last-of-type")).toBeNull();
  });

  it("renders a newer boundary with the parked count when the span is trimmed at the bottom", async () => {
    const view = await mount();
    view.messageEnd = 300;
    view.messageTotal = 700;
    view.hasNewer = true;
    view.newerCount = 400;
    await view.updateComplete;
    const buttons = [...view.renderRoot.querySelectorAll(".history-load-button")];
    const newer = buttons.find((button) => button.textContent.includes("newer"));
    expect(newer).toBeDefined();
    expect(newer?.textContent).toContain("400");
  });

  it("invokes onLoadNewer when the boundary is tapped", async () => {
    const view = await mount();
    let taps = 0;
    view.messageEnd = 300;
    view.messageTotal = 700;
    view.hasNewer = true;
    view.newerCount = 400;
    view.onLoadNewer = () => { taps += 1; };
    await view.updateComplete;
    const buttons = [...view.renderRoot.querySelectorAll(".history-load-button")];
    const newer = buttons.find((button) => button.textContent.includes("newer"));
    newer?.dispatchEvent(new Event("click", { bubbles: true, composed: true }));
    expect(taps).toBe(1);
  });
});
