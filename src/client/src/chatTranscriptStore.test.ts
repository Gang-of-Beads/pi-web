import { describe, expect, it } from "vitest";
import { ChatTranscriptStore, type ChatHistoryCacheAdapter } from "./chatTranscriptStore";
import type { RawMessagePage } from "./chatHistoryCache";

class MemoryChatHistoryCache implements ChatHistoryCacheAdapter {
  readonly pages = new Map<string, RawMessagePage>();
  readonly reads: string[] = [];

  read(sessionId: string): RawMessagePage | undefined {
    this.reads.push(sessionId);
    return this.pages.get(sessionId);
  }

  write(sessionId: string, page: RawMessagePage): void {
    this.pages.set(sessionId, page);
  }
}

function page(start: number, total: number, messages: unknown[]): RawMessagePage {
  return { start, total, messages };
}

describe("ChatTranscriptStore", () => {
  it("hydrates a visible transcript from cached raw history", () => {
    const cache = new MemoryChatHistoryCache();
    cache.write("s1", page(0, 2, [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]));

    expect(new ChatTranscriptStore(cache).cachedView("s1")).toEqual({
      messages: [
        { role: "user", parts: [{ type: "text", text: "hi" }] },
        { role: "assistant", parts: [{ type: "text", text: "hello" }] },
      ],
      messagePageStart: 0,
      messagePageEnd: 2,
      messagePageTotal: 2,
    });
  });

  it("tracks the raw page end separately from normalized display messages", () => {
    const store = new ChatTranscriptStore(new MemoryChatHistoryCache());

    const view = store.mergeHistory("s1", page(0, 3, [
      { role: "user", content: "run the tool" },
      { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "src/app.ts" } }] },
      { role: "toolResult", toolCallId: "tool-1", toolName: "read", content: [{ type: "text", text: "ok" }] },
    ]));

    expect(view.messages).toHaveLength(2);
    expect(view.messagePageStart).toBe(0);
    expect(view.messagePageEnd).toBe(3);
    expect(view.messagePageTotal).toBe(3);
  });

  it("evicts the least recently used transcript from memory without deleting persistent history", () => {
    const cache = new MemoryChatHistoryCache();
    const store = new ChatTranscriptStore(cache, { maxInMemoryTranscripts: 2 });
    store.mergeHistory("s1", page(0, 1, ["one"]));
    store.mergeHistory("s2", page(0, 1, ["two"]));
    // A read makes s1 the recent entry, so s2 is the one the next merge evicts.
    store.rawHistoryPage("s1");
    store.mergeHistory("s3", page(0, 1, ["three"]));
    cache.reads.length = 0;

    expect(store.rawHistoryPage("s1")?.messages).toEqual(["one"]);
    expect(cache.reads).toEqual([]);
    expect(store.rawHistoryPage("s2")?.messages).toEqual(["two"]);
    expect(cache.reads).toEqual(["s2"]);
    expect(cache.pages.has("s2")).toBe(true);
  });

  it("never disables the memory cache when configured with a non-positive limit", () => {
    const cache = new MemoryChatHistoryCache();
    const store = new ChatTranscriptStore(cache, { maxInMemoryTranscripts: 0 });
    store.mergeHistory("s1", page(0, 1, ["one"]));
    cache.reads.length = 0;

    expect(store.rawHistoryPage("s1")?.messages).toEqual(["one"]);
    expect(cache.reads).toEqual([]);
  });

  it("keeps live streamed transcript state out of the raw history cache", () => {
    const cache = new MemoryChatHistoryCache();
    const store = new ChatTranscriptStore(cache);
    const initial = page(0, 2, [{ role: "user", content: "hi" }, { role: "assistant", content: "hel" }]);
    const updated = page(1, 3, [{ role: "assistant", content: "hello" }, { role: "user", content: "next" }]);

    let visible = store.mergeHistory("s1", initial).messages;
    visible = store.applyLiveEvent(visible, { type: "assistant.delta", text: "lo" }) ?? visible;

    expect(visible.at(-1)).toEqual({ role: "assistant", parts: [{ type: "text", text: "hello" }] });
    expect(cache.read("s1")?.messages).toEqual(initial.messages);
    expect(store.mergeHistory("s1", updated)).toEqual({
      messages: [
        { role: "user", parts: [{ type: "text", text: "hi" }] },
        { role: "assistant", parts: [{ type: "text", text: "hello" }] },
        { role: "user", parts: [{ type: "text", text: "next" }] },
      ],
      messagePageStart: 0,
      messagePageEnd: 3,
      messagePageTotal: 3,
    });
  });
});
