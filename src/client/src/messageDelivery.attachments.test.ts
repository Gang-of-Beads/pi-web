import { describe, expect, it } from "vitest";
import { splitTranscriptAndPending } from "./messageDelivery.js";
import type { ChatLine } from "./components/shared.js";

/**
 * A message whose payload is a picture carries no words to match on.
 *
 * A queued entry is claimed by the bubble that sent it, by id when the id
 * survived and by text when it did not. An attachment-only prompt has an empty
 * text on both sides, and an empty string matches every other empty string - so
 * the fallback claimed whichever waiting bubble came first and left the real one
 * unclaimed, which the transcript then drew a second time. On screen that read
 * as the same screenshot sent twice with the reply in between.
 *
 * Empty text is now never matched on: without words, only the id can speak.
 */

function bubble(clientMessageId: string, text: string): ChatLine {
  return {
    role: "user",
    parts: text === "" ? [] : [{ type: "text", text }],
    meta: { delivery: { clientMessageId, state: "sending", kind: "followUp" } },
  };
}

describe("claiming a queued attachment-only prompt", () => {
  it("claims by id when the id survived", () => {
    const { settled, pending } = splitTranscriptAndPending([bubble("c1", "")], [{ kind: "followUp", text: "", clientMessageId: "c1" }]);

    expect(pending).toHaveLength(1);
    expect(settled).toHaveLength(0);
  });

  /** The duplicate: an idless empty entry must not seize another bubble. */
  it("does not claim an unrelated bubble when it has no id and no words", () => {
    const lines = [bubble("c1", "")];

    const { pending } = splitTranscriptAndPending(lines, [{ kind: "followUp", text: "" }]);

    expect(pending).toHaveLength(1);
    expect(pending[0]?.meta?.delivery?.clientMessageId).not.toBe("c1");
  });

  it("still matches by words when there are words", () => {
    const { settled, pending } = splitTranscriptAndPending([bubble("c1", "hello")], [{ kind: "followUp", text: "hello" }]);

    expect(pending).toHaveLength(1);
    expect(settled).toHaveLength(0);
  });

  it("leaves an unrelated bubble alone", () => {
    const { settled } = splitTranscriptAndPending([bubble("c1", "keep me")], [{ kind: "followUp", text: "" }]);

    expect(settled).toHaveLength(1);
  });
});
