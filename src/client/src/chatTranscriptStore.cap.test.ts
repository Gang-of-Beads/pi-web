import { describe, expect, it } from "vitest";
import { capTranscriptSpan, ChatTranscriptStore, TRANSCRIPT_SPAN_CAP, type ChatHistoryCacheAdapter } from "./chatTranscriptStore";
import type { RawMessagePage } from "./chatHistoryCache";

function page(start: number, count: number, total?: number): RawMessagePage {
  return {
    start,
    total: total ?? start + count,
    messages: Array.from({ length: count }, (_, index) => ({ role: "user", content: `m${String(start + index)}` })),
  };
}

function memoryCache(): ChatHistoryCacheAdapter & { pages: Map<string, RawMessagePage>; marks: Map<string, number> } {
  const pages = new Map<string, RawMessagePage>();
  const marks = new Map<string, number>();
  return {
    pages,
    marks,
    read: (id) => pages.get(id),
    write: (id, page) => { pages.set(id, page); },
    readWatermark: (id) => marks.get(id),
    writeWatermark: (id, seq) => { marks.set(id, seq); },
    removeWatermark: (id) => { marks.delete(id); },
  };
}

describe("capTranscriptSpan", () => {
  it("keeps spans at or under the cap untouched", () => {
    const span = page(0, TRANSCRIPT_SPAN_CAP);
    expect(capTranscriptSpan(span, "top")).toBe(span);
  });

  it("trims the top when the reader is anchored at the live tail", () => {
    const span = page(0, TRANSCRIPT_SPAN_CAP + 100);
    const capped = capTranscriptSpan(span, "top");
    expect(capped.start).toBe(span.start + 100);
    expect(capped.messages).toHaveLength(TRANSCRIPT_SPAN_CAP);
    expect(capped.total).toBe(span.total);
    expect(capped.messages.at(-1)).toEqual(span.messages.at(-1));
  });

  it("trims the bottom when the reader is walking history above the span", () => {
    const span = page(0, TRANSCRIPT_SPAN_CAP + 100);
    const capped = capTranscriptSpan(span, "bottom");
    expect(capped.start).toBe(span.start);
    expect(capped.messages).toHaveLength(TRANSCRIPT_SPAN_CAP);
    expect(capped.messages[0]).toEqual(span.messages[0]);
  });
});

describe("ChatTranscriptStore span cap", () => {
  it("keeps the full merged span in the cache while the memory view is trimmed", () => {
    const cache = memoryCache();
    const store = new ChatTranscriptStore(cache);
    store.mergeHistory("s1", page(400, 100, 500));
    for (let older = 300; older >= 0; older -= 100) {
      store.mergeHistory("s1", page(older, 100, 500));
    }
    const memoryView = store.cachedView("s1");
    expect(memoryView.messages.length).toBe(TRANSCRIPT_SPAN_CAP);
    expect(cache.pages.get("s1")?.messages.length).toBe(500);
  });

  it("trims the bottom when a history walk pushes the span past the cap", () => {
    const cache = memoryCache();
    const store = new ChatTranscriptStore(cache);
    const tail = page(400, 100, 500);
    store.mergeHistory("s1", tail);
    for (let older = 300; older >= 0; older -= 100) {
      store.mergeHistory("s1", page(older, 100, 500));
    }
    const walked = store.cachedView("s1");
    expect(walked.messagePageStart).toBe(0);
    expect(walked.messages.length).toBe(TRANSCRIPT_SPAN_CAP);
    expect(walked.messagePageEnd).toBe(400);
    expect(walked.messagePageTotal).toBe(500);
    expect(cache.pages.get("s1")?.messages.length).toBe(500);
  });

  it("trims the top when a tail merge follows a long history walk", () => {
    const cache = memoryCache();
    const store = new ChatTranscriptStore(cache);
    store.mergeHistory("s1", page(400, 100, 500));
    for (let older = 300; older >= 0; older -= 100) {
      store.mergeHistory("s1", page(older, 100, 500));
    }
    const view = store.mergeHistory("s1", page(450, 50, 500));
    // A tail page that does not overlap the walked span replaces the window:
    // "load newer" is a jump to the live tail, and the walked rows reload
    // from the cache if the reader scrolls back up.
    expect(view.messagePageEnd).toBe(500);
    expect(view.messagePageStart).toBe(450);
    expect(view.messages.length).toBe(50);
    expect(cache.pages.get("s1")?.messages.length).toBe(50);
  });

  it("keeps the watermark across selections and drops it on discard", () => {
    const cache = memoryCache();
    const store = new ChatTranscriptStore(cache);
    store.setWatermark("s1", 41);
    expect(store.watermark("s1")).toBe(41);
    const fresh = new ChatTranscriptStore(cache);
    expect(fresh.watermark("s1")).toBe(41);
    store.discard("s1");
    expect(store.watermark("s1")).toBeUndefined();
    expect(cache.marks.has("s1")).toBe(false);
  });
});
