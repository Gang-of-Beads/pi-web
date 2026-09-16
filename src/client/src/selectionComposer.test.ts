import { describe, expect, it } from "vitest";
import { quotedPrompt } from "./selectionComposer";

describe("quotedPrompt", () => {
  it("quotes every line and closes with one empty line", () => {
    expect(quotedPrompt("line one\nline two")).toBe("> line one\n> line two\n\n");
  });

  it("normalises carriage returns and drops trailing blank lines", () => {
    expect(quotedPrompt("a\r\nb\r\n\r\n")).toBe("> a\n> b\n\n");
    expect(quotedPrompt("  \n")).toBe("");
  });
});
