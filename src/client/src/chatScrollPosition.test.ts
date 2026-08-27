import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { showsJumpToBottom } from "./chatScrollPosition";
import { ChatScrollController, captureScrollPosition, chatScrollStorageKey, findFirstVisibleArticle, findVisibleScrollAnchor, type ChatScrollElement, type ChatScrollScheduler, type ChatScrollStorage, type ChatScrollViewport } from "./chatScrollPosition";

class MemoryScrollStorage implements ChatScrollStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class ManualScheduler implements ChatScrollScheduler {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();

  setTimeout(callback: () => void): number {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    return id;
  }

  clearTimeout(id: number): void {
    this.callbacks.delete(id);
  }

  run(id: number): void {
    const callback = this.callbacks.get(id);
    if (callback === undefined) return;
    this.callbacks.delete(id);
    callback();
  }

  runAll(): void {
    const ids = [...this.callbacks.keys()];
    for (const id of ids) this.run(id);
  }
}

class FakeScroller implements ChatScrollViewport {
  constructor(
    public scrollTop: number,
    public scrollHeight: number,
    public clientHeight: number,
    private readonly top: number,
    private readonly bottom: number,
  ) {}

  getBoundingClientRect(): Pick<DOMRectReadOnly, "top" | "bottom"> {
    return { top: this.top, bottom: this.bottom };
  }
}

class FakeArticle implements ChatScrollElement {
  readonly dataset: { readonly scrollAnchorId?: string | undefined };

  constructor(
    private readonly top: number,
    private readonly bottom: number,
    anchorId?: string,
  ) {
    this.dataset = {
      ...(anchorId === undefined ? {} : { scrollAnchorId: anchorId }),
    };
  }

  getBoundingClientRect(): Pick<DOMRectReadOnly, "top" | "bottom"> {
    return { top: this.top, bottom: this.bottom };
  }
}

describe("ChatScrollController", () => {
  it("skips saving while the scroll viewport is hidden", () => {
    const storage = new MemoryScrollStorage();
    const controller = new ChatScrollController(storage, new ManualScheduler());
    const key = chatScrollStorageKey("s1");
    storage.setItem(key, "old");

    const result = controller.savePosition("s1", new FakeScroller(0, 0, 0, 0, 0), [new FakeArticle(0, 10, "m:0")]);

    expect(result).toBe("skipped");
    expect(storage.getItem(key)).toBe("old");
  });

  it("saves and restores the visible anchor nearest the viewport top", () => {
    const storage = new MemoryScrollStorage();
    const controller = new ChatScrollController(storage, new ManualScheduler());
    const scroller = new FakeScroller(200, 1000, 300, 100, 400);
    const anchors = [
      new FakeArticle(-600, 350, "g:1"),
      new FakeArticle(80, 170, "e:6"),
      new FakeArticle(220, 280, "m:7"),
    ];

    expect(controller.savePosition("s1", scroller, anchors)).toBe("saved");
    expect(JSON.parse(storage.getItem(chatScrollStorageKey("s1")) ?? "{}")).toEqual({ mode: "anchor", anchorId: "e:6", offset: -20 });

    scroller.scrollTop = 500;
    const rerenderedAnchors = [
      new FakeArticle(-500, 360, "g:1"),
      new FakeArticle(130, 210, "e:6"),
      new FakeArticle(250, 310, "m:7"),
    ];

    expect(controller.restorePosition("s1", scroller, rerenderedAnchors)).toEqual({ status: "restored" });
    expect(scroller.scrollTop).toBe(550);
  });

  it("reports missing stored anchors instead of forcing bottom when requested", () => {
    const storage = new MemoryScrollStorage();
    const controller = new ChatScrollController(storage, new ManualScheduler());
    const position = { mode: "anchor", anchorId: "m:4", offset: 20 };
    storage.setItem(chatScrollStorageKey("s1"), JSON.stringify(position));
    const scroller = new FakeScroller(100, 900, 300, 0, 300);

    expect(controller.restorePosition("s1", scroller, [new FakeArticle(10, 40, "m:9")], { fallbackToBottom: false })).toEqual({ status: "missing", position });
    expect(scroller.scrollTop).toBe(100);
  });

  it("saves explicit bottom mode when the user is at the bottom", () => {
    const storage = new MemoryScrollStorage();
    const controller = new ChatScrollController(storage, new ManualScheduler());
    const key = chatScrollStorageKey("s1");
    storage.setItem(key, "old");

    expect(controller.savePosition("s1", new FakeScroller(699, 1000, 300, 0, 300), [new FakeArticle(0, 30, "m:0")])).toBe("saved");
    expect(JSON.parse(storage.getItem(key) ?? "{}")).toEqual({ mode: "bottom" });
  });

  it("cancels the previous delayed save and passes the latest session id", () => {
    const scheduler = new ManualScheduler();
    const controller = new ChatScrollController(new MemoryScrollStorage(), scheduler);
    const saved: string[] = [];

    controller.scheduleSave("s1", (sessionId) => { saved.push(sessionId); });
    controller.scheduleSave("s2", (sessionId) => { saved.push(sessionId); });
    scheduler.runAll();

    expect(saved).toEqual(["s2"]);
  });
});

describe("chat scroll helpers", () => {
  it("finds the first article intersecting the viewport", () => {
    const scroller = new FakeScroller(0, 1000, 100, 100, 200);
    const first = new FakeArticle(20, 80, "m:0");
    const second = new FakeArticle(150, 180, "m:1");

    expect(findFirstVisibleArticle(scroller, [first, second])).toBe(second);
  });

  it("finds the visible scroll anchor nearest the viewport top", () => {
    const scroller = new FakeScroller(0, 1000, 100, 100, 200);
    const wrapper = new FakeArticle(-500, 180, "g:0");
    const firstChild = new FakeArticle(90, 130, "e:0");
    const secondChild = new FakeArticle(140, 180, "e:1");

    expect(findVisibleScrollAnchor(scroller, [wrapper, firstChild, secondChild])).toBe(firstChild);
  });

  it("captures an anchor-relative scroll position", () => {
    expect(captureScrollPosition(new FakeScroller(0, 1000, 100, 100, 200), new FakeArticle(140, 180, "m:3"))).toEqual({ mode: "anchor", anchorId: "m:3", offset: 40 });
  });
});

describe("offering a way back to the newest message", () => {
  /**
   * A long transcript can be thousands of messages deep, and returning to the
   * newest one meant dragging the whole way back. A button does it in one tap.
   *
   * It only earns its place while the newest message is genuinely out of
   * reach. Near the bottom the reader can see it, so a button pointing at it
   * would be covering the transcript to offer a scroll they no longer need.
   */
  it("stays hidden while the newest message is within reach", () => {
    expect(showsJumpToBottom({ scrollHeight: 2000, scrollTop: 1200, clientHeight: 800 })).toBe(false);
  });

  it("appears once the newest message is a screenful or more away", () => {
    expect(showsJumpToBottom({ scrollHeight: 4000, scrollTop: 1200, clientHeight: 800 })).toBe(true);
  });

  /**
   * A transcript that does not scroll has nothing to return to.
   */
  it("stays hidden when the transcript fits the screen", () => {
    expect(showsJumpToBottom({ scrollHeight: 800, scrollTop: 0, clientHeight: 800 })).toBe(false);
  });
});

describe("when the button to reach the newest message is decided", () => {
  /**
   * Visibility was recomputed only while scrolling. A reply that grows the
   * transcript produces no scroll event, so a reader who sent a prompt and
   * stopped following ended up far from the newest content with no way back:
   * measured on a phone, 2953px - four and a half screens - from the newest
   * message, with the button never rendered.
   *
   * Growth is exactly when it is needed, so growth has to recompute it.
   */
  it("is recomputed when the transcript grows, not only when the reader scrolls", () => {
    const source = readFileSync(join(process.cwd(), "src/client/src/components/ChatView.ts"), "utf8");
    const updated = /override updated\([\s\S]*?\n {2}\}/u.exec(source)?.[0] ?? "";

    expect(updated).toMatch(/showsJumpToBottom|refreshJumpToBottom/u);
  });
});
