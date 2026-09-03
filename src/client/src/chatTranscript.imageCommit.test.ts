import { describe, expect, it } from "vitest";
import { applyTranscriptEvent } from "./chatTranscript";
import { normalizeMessage } from "./chatMessages";
import { oneRowPerIdentity } from "./transcriptInvariant";
import type { SessionUiEvent } from "./sessionSocket";
import type { ChatLine } from "./components/shared";

/**
 * The eleventh duplicate report survived the arrival-rule fix on a fifth
 * producer: the committed copy arriving as message.end went through a
 * text-only lookup that bails on a captionless photo. The daemon now stamps
 * the sender's clientMessageId onto the committed copy, and this path claims
 * by id first, then by content, and merges its tail by content instead of by
 * words alone.
 */
const PHOTO_A = "A".repeat(120);
const PHOTO_B = "B".repeat(120);

function trackedPhoto(id: string, data: string, text?: string): ChatLine {
  return {
    role: "user",
    parts: [...(text === undefined ? [] : [{ type: "text" as const, text }]), { type: "image" as const, mimeType: "image/png", data }],
    meta: { delivery: { clientMessageId: id, state: "queued" } },
  };
}

function committedEnd(data: string, options: { clientMessageId?: string; text?: string; mimeType?: string } = {}): SessionUiEvent {
  const event: SessionUiEvent = {
    type: "message.end",
    message: {
      role: "user",
      content: [
        ...(options.text === undefined ? [] : [{ type: "text", text: options.text }]),
        { type: "image", mimeType: options.mimeType ?? "image/png", data },
      ],
      ...(options.clientMessageId === undefined ? {} : { clientMessageId: options.clientMessageId }),
    },
  };
  return event;
}

function photoCount(lines: readonly ChatLine[], data: string): number {
  return lines.filter((line) => line.parts.some((part) => part.type === "image" && part.data === data)).length;
}

describe("a committed photo claims its bubble", () => {
  it("by the stamped id even when the runtime re-encoded every byte", () => {
    const resized = "R".repeat(80);
    const next = applyTranscriptEvent([trackedPhoto("c-1", PHOTO_A)], committedEnd(resized, { clientMessageId: "c-1", mimeType: "image/jpeg" }));
    expect(next).toHaveLength(1);
    expect(next?.[0]?.meta?.delivery?.clientMessageId).toBe("c-1");
  });

  it("by content when no id was stamped and the bytes survived", () => {
    const next = applyTranscriptEvent([trackedPhoto("c-1", PHOTO_A)], committedEnd(PHOTO_A));
    expect(next).toHaveLength(1);
  });

  it("claims the right bubble when two photos share a caption", () => {
    const transcript = [trackedPhoto("c-1", PHOTO_A, "look"), trackedPhoto("c-2", PHOTO_B, "look")];
    const next = applyTranscriptEvent(transcript, committedEnd(PHOTO_B, { clientMessageId: "c-2", text: "look" }));
    expect(next).toHaveLength(2);
    expect(photoCount(next ?? [], PHOTO_A)).toBe(1);
    expect(photoCount(next ?? [], PHOTO_B)).toBe(1);
  });

  it("never lets one captionless photo's commit consume a different photo", () => {
    const tail = applyTranscriptEvent([trackedPhoto("c-1", PHOTO_A)], committedEnd(PHOTO_B));
    expect(photoCount(tail ?? [], PHOTO_A)).toBe(1);
    expect(photoCount(tail ?? [], PHOTO_B)).toBe(1);
  });

  it("does not duplicate a photo whose committed copy lands behind a queued text", () => {
    const queuedText: ChatLine = { role: "user", parts: [{ type: "text", text: "and this too" }], meta: { delivery: { clientMessageId: "c-2", state: "queued" } } };
    const next = applyTranscriptEvent([trackedPhoto("c-1", PHOTO_A), queuedText], committedEnd(PHOTO_A, { clientMessageId: "c-1" }));
    expect(next).toHaveLength(2);
    expect(photoCount(next ?? [], PHOTO_A)).toBe(1);
  });
});

/**
 * The thirteenth report, root found: after a reconnect refetch rebuilds rows
 * without delivery meta, the ring replays message.end for a message already
 * on screen. Nothing could claim it - no delivery id, no echo mark, an
 * assistant at the tail - so the final fallback appended a twin. The end
 * path now dedupes against the whole transcript like the append path always
 * did.
 */
describe("a replayed commit against a refetched transcript", () => {
  it("never appends a user message that is already there, by id", () => {
    const plain: ChatLine = { role: "user", parts: [{ type: "text", text: "steer me" }], meta: { clientMessageId: "c-9" } };
    const reply: ChatLine = { role: "assistant", parts: [{ type: "text", text: "done" }] };
    const replay: SessionUiEvent = { type: "message.end", message: { role: "user", clientMessageId: "c-9", content: "steer me" } };
    const next = oneRowPerIdentity(applyTranscriptEvent([plain, reply], replay) ?? []);
    expect(next.filter((line) => line.role === "user")).toHaveLength(1);
  });

  it("never appends a user message whose echo is already there", () => {
    const echo: ChatLine = { role: "user", parts: [{ type: "text", text: "steer me" }], meta: { echo: true } };
    const reply: ChatLine = { role: "assistant", parts: [{ type: "text", text: "done" }] };
    const replay: SessionUiEvent = { type: "message.end", message: { role: "user", content: "steer me" } };
    const next = oneRowPerIdentity(applyTranscriptEvent([echo, reply], replay) ?? []);
    expect(next.filter((line) => line.role === "user")).toHaveLength(1);
  });

  it("keeps the refetched row's identity so the replay can claim it", () => {
    const raw = { role: "user", clientMessageId: "c-9", content: "steer me" };
    const [line] = normalizeMessage(raw);
    expect(line?.meta?.clientMessageId).toBe("c-9");
  });
});
