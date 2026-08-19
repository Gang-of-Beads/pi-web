// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormattedText, STREAM_SETTLE_MS } from "./FormattedText";
import * as markdownModule from "../formatting/markdown";

describe("FormattedText streaming markdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  async function renderText(text: string): Promise<FormattedText> {
    const el = new FormattedText();
    el.text = text;
    document.body.append(el);
    await el.updateComplete;
    return el;
  }

  it("re-renders fully when the text is replaced rather than appended", async () => {
    const parseSpy = vi.spyOn(markdownModule, "toSafeMarkdownHtml");
    const el = await renderText("one");
    const firstCalls = parseSpy.mock.calls.length;
    el.text = "two";
    await el.updateComplete;
    expect(parseSpy.mock.calls.length).toBeGreaterThan(firstCalls);
    expect(el.shadowRoot?.querySelector(".stream-suffix")).toBeNull();
  });

  it("appends plain-text suffix while the stream grows without re-parsing the prefix", async () => {
    const parseSpy = vi.spyOn(markdownModule, "toSafeMarkdownHtml");
    const el = await renderText("**hello** world");
    const parsedOnce = parseSpy.mock.calls.length;

    el.text = "**hello** world and";
    await el.updateComplete;
    expect(parseSpy.mock.calls.length).toBe(parsedOnce);

    const suffix = el.shadowRoot?.querySelector(".stream-suffix");
    expect(suffix?.textContent).toBe(" and");
    // The committed prefix is still the parsed markdown.
    expect(el.shadowRoot?.querySelector("strong")?.textContent).toBe("hello");
  });

  it("commits a full markdown render after the stream settles", async () => {
    const parseSpy = vi.spyOn(markdownModule, "toSafeMarkdownHtml");
    const el = await renderText("**hello**");
    const parsesBeforeStream = parseSpy.mock.calls.length;

    el.text = "**hello** world";
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".stream-suffix")?.textContent).toBe(" world");

    vi.advanceTimersByTime(STREAM_SETTLE_MS + 10);
    await el.updateComplete;

    // Settled: full parse committed, suffix gone, markdown rendered.
    expect(parseSpy.mock.calls.length).toBeGreaterThan(parsesBeforeStream);
    expect(el.shadowRoot?.querySelector(".stream-suffix")).toBeNull();
    expect(el.shadowRoot?.querySelector("strong")?.textContent).toBe("hello");
    expect(el.shadowRoot?.textContent).toContain("world");
  });

  it("keeps receiving deltas while the settle timer is pending without extra parses", async () => {
    const parseSpy = vi.spyOn(markdownModule, "toSafeMarkdownHtml");
    const el = await renderText("a");
    const parsedCount = parseSpy.mock.calls.length;

    el.text = "ab";
    await el.updateComplete;
    vi.advanceTimersByTime(STREAM_SETTLE_MS / 2);
    await el.updateComplete;
    el.text = "abcde";
    await el.updateComplete;
    // Mid-stream: still no full parse, suffix has accumulated both deltas.
    expect(parseSpy.mock.calls.length).toBe(parsedCount);
    expect(el.shadowRoot?.querySelector(".stream-suffix")?.textContent).toBe("bcde");
  });
});