import { describe, expect, it } from "vitest";
import { normalizeMessage } from "./chatMessages";

/**
 * A result the server had to cut says so.
 *
 * Silently showing the first 128 KiB of a 2 MB result is the same failure as
 * an empty list that means "unloaded": the reader is given a stump and no way
 * to know the output continued. The server sends the whole size; the row has
 * to spend it on a sentence.
 */

function toolResult(text: string, truncatedBytes?: number) {
  return normalizeMessage({
    role: "toolResult",
    toolName: "bash",
    content: [{ type: "text", text, ...(truncatedBytes === undefined ? {} : { truncatedBytes }) }],
  });
}

function textOf(lines: ReturnType<typeof normalizeMessage>): string {
  return lines.flatMap((line) => line.parts).map((part) => ("text" in part ? part.text : "")).join("\n");
}

describe("a tool result the server bounded", () => {
  it("says the output was cut", () => {
    const line = toolResult("first bytes", 2_157_046);

    expect(textOf(line)).toContain("truncated");
  });

  it("names the size the whole output had", () => {
    const line = toolResult("first bytes", 2_157_046);

    expect(textOf(line)).toMatch(/2(\.\d+)?\s*MB/u);
  });

  it("keeps the bytes that did arrive", () => {
    expect(textOf(toolResult("first bytes", 2_157_046))).toContain("first bytes");
  });

  it("says nothing extra about a result that arrived whole", () => {
    expect(textOf(toolResult("all of it"))).not.toContain("truncated");
  });
});
