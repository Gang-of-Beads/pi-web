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

  /** A reader mid-transcript, holding: a session that opens with nothing stored follows the newest (review bbe5adc9 row 7). */
  async function mount(): Promise<ChatView> {
    const view = document.body.querySelector<ChatView>("chat-view");
    if (view === null) throw new Error("chat view did not mount");
    view.messages = [];
    await view.updateComplete;
    Reflect.set(view, "viewportState", { kind: "holding" });
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

  it("says what each boundary holds, and loading only for the page on its way", async () => {
    const view = await mount();
    view.messageStart = 400;
    view.messageEnd = 800;
    view.messageTotal = 1000;
    view.hasMore = true;
    view.hasNewer = true;
    view.newerCount = 200;
    await view.updateComplete;
    expect(view.renderRoot.querySelector(".history-load-button")).toBeNull();
    const caption = (words: string): Element | null | undefined => [...view.renderRoot.querySelectorAll(".history-boundary")]
      .find((element) => element.textContent.toLowerCase().includes(words))?.querySelector("[role='status']");
    expect(caption("newer")?.textContent).toBe("200 newer messages below");
    expect(caption("earlier")?.textContent).toBe("Earlier messages load as you scroll up");

    view.loadingMore = true;
    view.loadingNewer = true;
    await view.updateComplete;
    expect(caption("newer")?.textContent).toBe("Loading 200 newer messages…");
    expect(caption("earlier")?.textContent).toBe("Earlier messages load as you scroll up");

    view.loadingNewer = false;
    await view.updateComplete;
    expect(caption("earlier")?.textContent).toBe("Loading earlier messages…");
    expect(caption("newer")?.textContent).toBe("200 newer messages below");
  });

  it("asks the host for the newer span itself once the reader nears the end", async () => {
    const view = await mount();
    let pages = 0;
    let tails = 0;
    view.onLoadNewer = () => { pages += 1; };
    view.onJumpToNewest = () => { tails += 1; };
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
    // The scroll handler defers one decision per event to a frame (the older end must
    // not measure layout inside the event, and one dispatch serves both ends), so the
    // host is asked on the next frame rather than synchronously. Scrolling forward
    // asks for the next page, never the live tail.
    await nextFrame();
    await view.updateComplete;
    expect({ pages, tails }).toEqual({ pages: 1, tails: 0 });

    const jump: unknown = Reflect.get(view, "jumpToNewest");
    if (typeof jump !== "function") throw new Error("the jump is missing, so this test proves nothing");
    Reflect.set(view, "viewportState", { kind: "holding" });
    Reflect.set(view, "newerRequested", false);
    chat.scrollTop = 0;
    Reflect.apply(jump, view, []);
    await view.updateComplete;
    expect({ pages, tails }).toEqual({ pages: 1, tails: 1 });
  });

});

function nextFrame(): Promise<void> {
  return new Promise((resolve) => { requestAnimationFrame(() => { resolve(); }); });
}
