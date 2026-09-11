import { describe, expect, it } from "vitest";
import { capTranscriptSpan, TRANSCRIPT_SPAN_CAP } from "./chatTranscriptStore";
import type { RawMessagePage } from "./chatHistoryCache";

function span(start: number, count: number, total?: number): RawMessagePage {
  return {
    start,
    total: total ?? start + count,
    messages: Array.from({ length: count }, (_, index) => ({ role: "user", content: `m${String(start + index)}` })),
  };
}

describe("capTranscriptSpan", () => {
  it("keeps spans at or under the cap untouched", () => {
    const page = span(0, TRANSCRIPT_SPAN_CAP);
    expect(capTranscriptSpan(page, "top")).toBe(page);
  });

  it("trims the top when the reader is anchored at the live tail", () => {
    const page = span(0, TRANSCRIPT_SPAN_CAP + 100);
    const capped = capTranscriptSpan(page, "top");
    expect(capped.start).toBe(page.start + 100);
    expect(capped.messages).toHaveLength(TRANSCRIPT_SPAN_CAP);
    expect(capped.total).toBe(page.total);
    expect(capped.messages.at(-1)).toEqual(page.messages.at(-1));
  });

  it("trims the bottom when the reader is walking history above the span", () => {
    const page = span(0, TRANSCRIPT_SPAN_CAP + 100);
    const capped = capTranscriptSpan(page, "bottom");
    expect(capped.start).toBe(page.start);
    expect(capped.messages).toHaveLength(TRANSCRIPT_SPAN_CAP);
    expect(capped.messages[0]).toEqual(page.messages[0]);
  });
});
