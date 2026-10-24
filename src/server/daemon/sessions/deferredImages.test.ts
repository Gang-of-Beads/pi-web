import { describe, expect, it } from "vitest";
import { INLINE_IMAGE_BYTES, deferImages, deferredImageVerdict, findDeferredImage, toolCallOwner } from "./deferredImages.js";

function base64OfBytes(count: number): string {
  return Buffer.alloc(count, 1).toString("base64");
}

const big = base64OfBytes(INLINE_IMAGE_BYTES + 1);
const small = base64OfBytes(INLINE_IMAGE_BYTES);

describe("deferredImageVerdict", () => {
  it("enumerates every verdict", () => {
    expect(deferredImageVerdict({ type: "text", text: "x" }, 0, { toolCallId: "call-1" })).toEqual({ kind: "inline", reason: "not-image" });
    expect(deferredImageVerdict({ type: "image", mimeType: "image/png" }, 0, { toolCallId: "call-1" })).toEqual({ kind: "inline", reason: "not-image" });
    expect(deferredImageVerdict({ type: "image", mimeType: "image/png", data: big }, 0, undefined)).toEqual({ kind: "inline", reason: "no-owner" });
    expect(deferredImageVerdict({ type: "image", mimeType: "image/png", data: big }, 0, { entryId: "" })).toEqual({ kind: "inline", reason: "no-owner" });
    expect(deferredImageVerdict({ type: "image", mimeType: "image/png", data: small }, 0, { toolCallId: "call-1" })).toEqual({ kind: "inline", reason: "small" });
    expect(deferredImageVerdict({ type: "image", mimeType: "image/png", data: big }, 2, { toolCallId: "call-1" })).toEqual({ kind: "deferred", index: 2 });
    expect(deferredImageVerdict({ type: "image", mimeType: "image/png", data: big }, 1, { entryId: "entry-1" })).toEqual({ kind: "deferred", index: 1 });
  });
});

describe("deferImages", () => {
  it("replaces large images with their reference and keeps everything else by reference", () => {
    const content = [{ type: "text", text: "shot" }, { type: "image", mimeType: "image/png", data: big }, { type: "image", mimeType: "image/png", data: small }];
    expect(deferImages(content, toolCallOwner("call-1"))).toEqual([
      { type: "text", text: "shot" },
      { type: "image", mimeType: "image/png", ref: { toolCallId: "call-1", index: 1 } },
      { type: "image", mimeType: "image/png", data: small },
    ]);
    expect(deferImages(content, { entryId: "entry-1" })).toEqual([
      { type: "text", text: "shot" },
      { type: "image", mimeType: "image/png", ref: { entryId: "entry-1", index: 1 } },
      { type: "image", mimeType: "image/png", data: small },
    ]);
  });

  it("returns the same array when nothing is deferred", () => {
    const content = [{ type: "text", text: "plain" }];
    expect(deferImages(content, toolCallOwner("call-1"))).toBe(content);
    expect(deferImages("string content", toolCallOwner("call-1"))).toBe("string content");
  });

  it("keeps images inline when the tool call has no id to address them by", () => {
    const content = [{ type: "image", mimeType: "image/png", data: big }];
    expect(deferImages(content, toolCallOwner(undefined))).toBe(content);
    expect(deferImages(content, toolCallOwner(""))).toBe(content);
  });
});

describe("findDeferredImage", () => {
  const entries = [
    { type: "message", id: "entry-1", message: { role: "user", content: [{ type: "text", text: "see" }, { type: "image", mimeType: "image/jpeg", data: big }] } },
    { type: "message", id: "entry-2", message: { role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "t" }, { type: "image", mimeType: "image/png", data: big }] } },
  ];

  it("reads the addressed block from the session file", () => {
    expect(findDeferredImage(entries, { toolCallId: "call-1", index: 1 })).toEqual({ mimeType: "image/png", data: big });
    expect(findDeferredImage(entries, { entryId: "entry-1", index: 1 })).toEqual({ mimeType: "image/jpeg", data: big });
  });

  it("answers undefined for an unknown owner, a non-image index, an index past the end, or an entry that is not the reader's message", () => {
    expect(findDeferredImage(entries, { toolCallId: "call-9", index: 1 })).toBeUndefined();
    expect(findDeferredImage(entries, { toolCallId: "call-1", index: 0 })).toBeUndefined();
    expect(findDeferredImage(entries, { toolCallId: "call-1", index: 7 })).toBeUndefined();
    expect(findDeferredImage(entries, { entryId: "entry-9", index: 1 })).toBeUndefined();
    expect(findDeferredImage(entries, { entryId: "entry-1", index: 0 })).toBeUndefined();
    expect(findDeferredImage(entries, { entryId: "entry-2", index: 1 })).toBeUndefined();
  });
});
