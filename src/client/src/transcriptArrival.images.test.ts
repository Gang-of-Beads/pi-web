import { describe, expect, it } from "vitest";
import { resolveArrival } from "./transcriptArrival";
import { messageContentKey } from "./chatTranscript";
import type { ChatLine } from "./components/shared";

/**
 * The eleventh duplicate report was a message with images rendered twice.
 * Every supersession rule compared words alone and gave up on a message that
 * had none, so a photo without a caption could never replace its own echo -
 * and, in the other direction, two different photos sharing a caption read as
 * one message. Content identity covers both.
 */
function image(data: string): ChatLine["parts"][number] {
  return { type: "image", mimeType: "image/png", data };
}

function userLine(parts: ChatLine["parts"], meta?: ChatLine["meta"]): ChatLine {
  return { role: "user", parts, ...(meta === undefined ? {} : { meta }) };
}

const PHOTO_A = "A".repeat(120);
const PHOTO_B = "B".repeat(120);

describe("messages that speak in images", () => {
  it("lets a captionless photo supersede its own echo", () => {
    const echo = userLine([image(PHOTO_A)], { echo: true });
    const committed = userLine([image(PHOTO_A)]);
    const outcome = resolveArrival({ transcript: [echo], lines: [committed], clientMessageId: undefined });
    expect(outcome.kind).toBe("replace");
  });

  it("recognises a committed photo the sender already tracks", () => {
    const optimistic = userLine([image(PHOTO_A)], { delivery: { clientMessageId: "c-1", state: "queued" } });
    const committed = userLine([image(PHOTO_A)]);
    const outcome = resolveArrival({ transcript: [optimistic], lines: [committed], clientMessageId: undefined });
    expect(outcome.kind).toBe("ignore");
  });

  it("never merges two different photos just because neither has a caption", () => {
    const echo = userLine([image(PHOTO_A)], { echo: true });
    const committed = userLine([image(PHOTO_B)]);
    const outcome = resolveArrival({ transcript: [echo], lines: [committed], clientMessageId: undefined });
    expect(outcome.kind).toBe("place");
  });

  it("never merges two messages that share words but not images", () => {
    const optimistic = userLine([{ type: "text", text: "look at this" }, image(PHOTO_A)], { delivery: { clientMessageId: "c-1", state: "queued" } });
    const committed = userLine([{ type: "text", text: "look at this" }, image(PHOTO_B)]);
    const outcome = resolveArrival({ transcript: [optimistic], lines: [committed], clientMessageId: undefined });
    expect(outcome.kind).toBe("place");
  });

  it("still treats a message with nothing at all as having no identity", () => {
    expect(messageContentKey(userLine([]))).toBeUndefined();
    expect(messageContentKey(userLine([image(PHOTO_A)]))).toBeDefined();
    expect(messageContentKey(userLine([image(PHOTO_A)]))).not.toBe(messageContentKey(userLine([image(PHOTO_B)])));
  });
});
