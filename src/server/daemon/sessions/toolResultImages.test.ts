import { describe, expect, it } from "vitest";
import { INLINE_IMAGE_BYTES, deferToolResultImages, deferredImageVerdict, findToolResultImage } from "./toolResultImages.js";

function base64OfBytes(count: number): string {
  return Buffer.alloc(count, 1).toString("base64");
}

const big = base64OfBytes(INLINE_IMAGE_BYTES + 1);
const small = base64OfBytes(INLINE_IMAGE_BYTES);

describe("deferredImageVerdict", () => {
  it("enumerates every verdict", () => {
    expect(deferredImageVerdict({ type: "text", text: "x" }, 0, "call-1")).toEqual({ kind: "inline", reason: "not-image" });
    expect(deferredImageVerdict({ type: "image", mimeType: "image/png" }, 0, "call-1")).toEqual({ kind: "inline", reason: "not-image" });
    expect(deferredImageVerdict({ type: "image", mimeType: "image/png", data: big }, 0, undefined)).toEqual({ kind: "inline", reason: "no-tool-call-id" });
    expect(deferredImageVerdict({ type: "image", mimeType: "image/png", data: small }, 0, "call-1")).toEqual({ kind: "inline", reason: "small" });
    expect(deferredImageVerdict({ type: "image", mimeType: "image/png", data: big }, 2, "call-1")).toEqual({ kind: "deferred", index: 2 });
  });
});

describe("deferToolResultImages", () => {
  it("replaces large images with their reference and keeps everything else by reference", () => {
    const content = [{ type: "text", text: "shot" }, { type: "image", mimeType: "image/png", data: big }, { type: "image", mimeType: "image/png", data: small }];
    const out = deferToolResultImages(content, "call-1");
    expect(out).toEqual([
      { type: "text", text: "shot" },
      { type: "image", mimeType: "image/png", ref: { toolCallId: "call-1", index: 1 } },
      { type: "image", mimeType: "image/png", data: small },
    ]);
  });

  it("returns the same array when nothing is deferred", () => {
    const content = [{ type: "text", text: "plain" }];
    expect(deferToolResultImages(content, "call-1")).toBe(content);
    expect(deferToolResultImages("string content", "call-1")).toBe("string content");
  });

  it("keeps images inline when the tool call has no id to address them by", () => {
    const content = [{ type: "image", mimeType: "image/png", data: big }];
    expect(deferToolResultImages(content, undefined)).toBe(content);
  });
});

describe("findToolResultImage", () => {
  const entries = [
    { type: "message", message: { role: "user", content: "hi" } },
    { type: "message", message: { role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "t" }, { type: "image", mimeType: "image/png", data: big }] } },
  ];

  it("reads the addressed block from the session file", () => {
    expect(findToolResultImage(entries, "call-1", 1)).toEqual({ mimeType: "image/png", data: big });
  });

  it("answers undefined for an unknown call, a non-image index, or an index past the end", () => {
    expect(findToolResultImage(entries, "call-9", 1)).toBeUndefined();
    expect(findToolResultImage(entries, "call-1", 0)).toBeUndefined();
    expect(findToolResultImage(entries, "call-1", 7)).toBeUndefined();
  });
});
