import { describe, expect, it } from "vitest";
import { TOOL_RESULT_TEXT_BYTES, boundToolResultText } from "./toolResultBounds.js";

/**
 * A transcript page must be bounded too, and it was not.
 *
 * The measurement that motivated the bound was taken on a page: one request
 * for a hundred messages answered with 15.6 MB, five tool results being two
 * thirds of it. The bound was then wired into the live event path only, so the
 * page - the thing that was actually measured - still weighed what it always
 * had.
 *
 * These assert the property a page must hold, against the same helper the
 * server now applies while assembling one.
 */

/** What the server does to a stored tool-result message before sending it. */
function boundHistoryContent(content: readonly unknown[]): unknown[] {
  return content.map((part) => {
    if (!isRecord(part)) return part;
    const text = part["text"];
    if (part["type"] !== "text" || typeof text !== "string") return part;
    const limited = boundToolResultText(text);
    return limited.truncated ? { ...part, text: limited.text, truncatedBytes: limited.totalBytes } : part;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads one field of the single bounded part, without asserting its type. */
function boundedPart(content: readonly unknown[]): Record<string, unknown> {
  const [part] = boundHistoryContent(content);
  if (!isRecord(part)) throw new Error("expected a record part");
  return part;
}

function boundedText(content: readonly unknown[]): string {
  const text = boundedPart(content)["text"];
  if (typeof text !== "string") throw new Error("expected text");
  return text;
}

describe("a tool result inside a transcript page", () => {
  it("is cut to the same bound the live path applies", () => {
    const huge = "x".repeat(TOOL_RESULT_TEXT_BYTES * 3);

    expect(Buffer.byteLength(boundedText([{ type: "text", text: huge }]), "utf8")).toBeLessThanOrEqual(TOOL_RESULT_TEXT_BYTES);
  });

  it("says how much the whole output weighed, so the stump is not read as the end", () => {
    const huge = "x".repeat(TOOL_RESULT_TEXT_BYTES * 3);

    expect(boundedPart([{ type: "text", text: huge }])["truncatedBytes"]).toBe(Buffer.byteLength(huge, "utf8"));
  });

  it("leaves a result that already fits exactly as it was", () => {
    const small = { type: "text", text: "ok" };

    expect(boundHistoryContent([small])[0]).toBe(small);
  });

  it("bounds every oversized result on the page, not just the first", () => {
    const huge = "x".repeat(TOOL_RESULT_TEXT_BYTES * 2);

    const parts = boundHistoryContent([{ type: "text", text: huge }, { type: "text", text: huge }]);

    for (const part of parts) {
      expect(isRecord(part) && part["truncatedBytes"] !== undefined).toBe(true);
    }
  });

  it("does not disturb a part that carries no text", () => {
    const image = { type: "image", data: "..." };

    expect(boundHistoryContent([image])[0]).toBe(image);
  });
});
