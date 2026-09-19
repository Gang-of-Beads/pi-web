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

  it("says it is loading the parked count instead of offering a button", async () => {
    const view = await mount();
    view.messageEnd = 300;
    view.messageTotal = 700;
    view.hasNewer = true;
    view.newerCount = 400;
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".history-load-button")).toBeNull();
    const boundary = [...view.renderRoot.querySelectorAll(".history-boundary")]
      .find((element) => element.textContent.includes("newer"));
    expect(boundary?.textContent).toContain("400");
    expect(boundary?.querySelector("[role='status']")).not.toBeNull();
  });

  it("asks the host for the newer span itself once the reader nears the end", async () => {
    const view = await mount();
    let asks = 0;
    view.onLoadNewer = () => { asks += 1; };
    view.messageEnd = 300;
    view.messageTotal = 700;
    view.hasNewer = true;
    view.newerCount = 400;
    await view.updateComplete;
    const chat = view.renderRoot.querySelector(".chat");
    if (chat === null) throw new Error("the transcript scroller is missing, so this test proves nothing");
    Object.defineProperty(chat, "scrollHeight", { value: 4000, configurable: true });
    Object.defineProperty(chat, "clientHeight", { value: 800, configurable: true });
    chat.scrollTop = 3000;
    chat.dispatchEvent(new Event("scroll"));
    await view.updateComplete;
    expect(asks).toBe(1);
  });

});
