import { describe, expect, it } from "vitest";
import { boundToolResultText, TOOL_RESULT_TEXT_BYTES } from "./toolResultBounds.js";

/**
 * A transcript page is read by a phone.
 *
 * Measured on a live session: a request for 100 messages answered with 238
 * messages and 15.6 MB, of which five tool results were 65% - the largest a
 * single 2.16 MB row. Parsing and laying that out is what "the session never
 * loads" looked like. Notifications in this same codebase have carried a byte
 * bound for exactly this reason; transcripts carried none.
 *
 * The bound is on what is sent, not on what is stored: the session file keeps
 * the whole result, and the row says how much of it the reader is seeing so an
 * absent tail is never mistaken for the end of the output.
 */

describe("bounding a tool result for the wire", () => {
  it("passes a small result through untouched", () => {
    const result = boundToolResultText("ok");

    expect(result.text).toBe("ok");
    expect(result.truncated).toBe(false);
  });

  it("keeps a result exactly at the bound whole", () => {
    const exact = "a".repeat(TOOL_RESULT_TEXT_BYTES);

    expect(boundToolResultText(exact).truncated).toBe(false);
  });

  it("cuts a result past the bound", () => {
    const result = boundToolResultText("a".repeat(TOOL_RESULT_TEXT_BYTES + 1));

    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(result.text).byteLength).toBeLessThanOrEqual(TOOL_RESULT_TEXT_BYTES);
  });

  /** Cutting mid-character would hand the browser a broken string. */
  it("never splits a multi-byte character", () => {
    const result = boundToolResultText("的".repeat(TOOL_RESULT_TEXT_BYTES));

    expect(result.text.endsWith("的")).toBe(true);
    expect(Array.from(result.text).every((character) => character === "的")).toBe(true);
  });

  it("reports how many bytes the whole result had, so the row can say so", () => {
    const whole = "a".repeat(TOOL_RESULT_TEXT_BYTES * 2);

    expect(boundToolResultText(whole).totalBytes).toBe(TOOL_RESULT_TEXT_BYTES * 2);
  });

  it("reports the original size even when nothing was cut", () => {
    expect(boundToolResultText("ok").totalBytes).toBe(2);
  });
});
