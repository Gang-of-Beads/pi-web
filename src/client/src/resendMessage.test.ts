import { describe, expect, it } from "vitest";
import type { ChatLine } from "./components/shared";
import { isResendableLine, lastResendablePrompt, recoverPromptFromLine } from "./resendMessage";

/**
 * A turn that fails after delivery leaves the prompt in the transcript and
 * nowhere else. Recovering it — images included — is what makes a retry one
 * click instead of retyping and re-picking every screenshot.
 */
describe("recoverPromptFromLine", () => {
  it("recovers text and images together", () => {
    const recovered = recoverPromptFromLine(userLine([
      { type: "text", text: "look at this" },
      { type: "image", mimeType: "image/png", data: "AAAA" },
    ]));

    expect(recovered).toEqual({
      text: "look at this",
      attachments: [{ kind: "image", mimeType: "image/png", data: "AAAA" }],
    });
  });

  it("recovers an image-only prompt", () => {
    const recovered = recoverPromptFromLine(userLine([{ type: "image", mimeType: "image/jpeg", data: "BBBB" }]));

    expect(recovered?.text).toBe("");
    expect(recovered?.attachments).toHaveLength(1);
  });

  it("keeps every image of a multi-image prompt, in order", () => {
    const recovered = recoverPromptFromLine(userLine([
      { type: "image", mimeType: "image/png", data: "one" },
      { type: "text", text: "compare these" },
      { type: "image", mimeType: "image/webp", data: "two" },
    ]));

    expect(recovered?.attachments.map((attachment) => attachment.kind === "image" ? attachment.data : "")).toEqual(["one", "two"]);
    expect(recovered?.text).toBe("compare these");
  });

  it("joins several text parts into one prompt", () => {
    const recovered = recoverPromptFromLine(userLine([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]));

    expect(recovered?.text).toBe("first\n\nsecond");
  });

  it("ignores parts that are not part of the prompt", () => {
    const recovered = recoverPromptFromLine(userLine([
      { type: "text", text: "run it" },
      { type: "toolCall", toolName: "bash", summary: "ls" },
      { type: "empty" },
    ]));

    expect(recovered).toEqual({ text: "run it", attachments: [] });
  });

  it("skips an image with no payload rather than attaching an empty file", () => {
    const recovered = recoverPromptFromLine(userLine([
      { type: "text", text: "hi" },
      { type: "image", mimeType: "image/png", data: "" },
    ]));

    expect(recovered?.attachments).toEqual([]);
  });

  it("returns nothing for a line with no prompt content", () => {
    expect(recoverPromptFromLine(userLine([{ type: "empty" }]))).toBeUndefined();
    expect(recoverPromptFromLine(userLine([{ type: "text", text: "   " }]))).toBeUndefined();
  });

  it("only recovers user lines", () => {
    const assistant: ChatLine = { role: "assistant", parts: [{ type: "text", text: "hello" }] };
    expect(recoverPromptFromLine(assistant)).toBeUndefined();
    expect(isResendableLine(assistant)).toBe(false);
  });
});

describe("lastResendablePrompt", () => {
  it("finds the most recent user prompt, past the failure that followed it", () => {
    const lines: ChatLine[] = [
      userLine([{ type: "text", text: "older" }]),
      userLine([{ type: "text", text: "newer" }, { type: "image", mimeType: "image/png", data: "IMG" }]),
      { role: "system", parts: [{ type: "text", text: "Model response failed: 429 quota exceeded" }] },
    ];

    const recovered = lastResendablePrompt(lines);

    expect(recovered?.text).toBe("newer");
    expect(recovered?.attachments).toHaveLength(1);
  });

  it("returns nothing when the transcript holds no user prompt", () => {
    expect(lastResendablePrompt([{ role: "assistant", parts: [{ type: "text", text: "hi" }] }])).toBeUndefined();
    expect(lastResendablePrompt([])).toBeUndefined();
  });
});

function userLine(parts: ChatLine["parts"]): ChatLine {
  return { role: "user", parts };
}
