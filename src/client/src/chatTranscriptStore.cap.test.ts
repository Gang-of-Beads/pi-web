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

function memoryCache(): ChatHistoryCacheAdapter & { pages: Map<string, RawMessagePage> } {
  const pages = new Map<string, RawMessagePage>();
  return {
    pages,
    read: (id) => pages.get(id),
    write: (id, page) => { pages.set(id, page); },
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
  const span = TRANSCRIPT_SPAN_CAP + 100;

  it("keeps the full merged span in the cache while the memory view is trimmed", () => {
    const cache = memoryCache();
    const store = new ChatTranscriptStore(cache);
    store.mergeHistory("s1", page(span - 100, 100, span));
    for (let older = span - 200; older >= 0; older -= 100) {
      store.mergeHistory("s1", page(older, 100, span));
    }
    const memoryView = store.cachedView("s1");
    expect(memoryView.messages.length).toBe(TRANSCRIPT_SPAN_CAP);
    expect(cache.pages.get("s1")?.messages.length).toBe(span);
  });

  it("trims the bottom when a history walk pushes the span past the cap", () => {
    const cache = memoryCache();
    const store = new ChatTranscriptStore(cache);
    store.mergeHistory("s1", page(span - 100, 100, span));
    for (let older = span - 200; older >= 0; older -= 100) {
      store.mergeHistory("s1", page(older, 100, span));
    }
    const walked = store.cachedView("s1");
    expect(walked.messagePageStart).toBe(0);
    expect(walked.messages.length).toBe(TRANSCRIPT_SPAN_CAP);
    expect(walked.messagePageEnd).toBe(TRANSCRIPT_SPAN_CAP);
    expect(walked.messagePageTotal).toBe(span);

    store.noteTotal("s1", span + 60);
    const noted = store.cachedView("s1");
    expect([noted.messagePageStart, noted.messagePageEnd, noted.messagePageTotal, noted.messages.length]).toEqual([0, TRANSCRIPT_SPAN_CAP, span + 60, TRANSCRIPT_SPAN_CAP]);

    const late = store.mergeHistory("s1", page(span + 300, 100, span + 400), "neighbour");
    expect([late.messagePageStart, late.messagePageEnd, late.messages.length]).toEqual([0, TRANSCRIPT_SPAN_CAP, TRANSCRIPT_SPAN_CAP]);

    store.noteTotal("s1", 300);
    expect(store.cachedView("s1").messagePageTotal).toBe(span + 60);
    expect([cache.pages.get("s1")?.messages.length, cache.pages.get("s1")?.total]).toEqual([300, 300]);
  });

  it("keeps walking into a span shorter than the cap whole", () => {
    const cache = memoryCache();
    const store = new ChatTranscriptStore(cache);
    store.mergeHistory("s1", page(400, 100, 500));
    for (let older = 300; older >= 0; older -= 100) {
      store.mergeHistory("s1", page(older, 100, 500));
    }
    const view = store.cachedView("s1");
    // A span below the cap is never trimmed, so a window that reached both ends
    // stops asking for either - the case that kept a phone replacing its window
    // with its own complement (8504, 2026-11-20).
    expect([view.messagePageStart, view.messagePageEnd, view.messages.length]).toEqual([0, 500, 500]);
    expect(cache.pages.get("s1")?.messages.length).toBe(500);
  });

  it("extends a walked span that a tail page overlaps", () => {
    const cache = memoryCache();
    const store = new ChatTranscriptStore(cache);
    store.mergeHistory("s1", page(400, 100, 500));
    for (let older = 300; older >= 0; older -= 100) {
      store.mergeHistory("s1", page(older, 100, 500));
    }
    const view = store.mergeHistory("s1", page(450, 50, 500), "neighbour");
    // A page overlapping the span joins it instead of replacing it, so the
    // forward prefetch does not throw away the rows behind the reader.
    expect([view.messagePageStart, view.messagePageEnd, view.messages.length]).toEqual([0, 500, 500]);
    expect(cache.pages.get("s1")?.messages.length).toBe(500);
  });

});
