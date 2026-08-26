import { describe, expect, it } from "vitest";
import { placeByTimestamp } from "./transcriptOrder";
import type { ChatLine } from "./components/shared";

/**
 * A reply that was already being written when you typed must still read as
 * having come first.
 *
 * Every message is appended as it arrives, and a streaming reply arrives only
 * once it is finished. Send something while one is in flight and your own
 * bubble is appended first, so the reply that started before you typed lands
 * underneath it: the transcript says you spoke first when the record says you
 * did not.
 */
describe("placing a message that arrived late", () => {
  it("puts an older message above a newer one already on screen", () => {
    const transcript = [line("user", "16:16:20"), line("user", "16:16:40")];

    const placed = placeByTimestamp(transcript, line("assistant", "16:16:34"));

    expect(placed.map(stampOf)).toEqual(["16:16:20", "16:16:34", "16:16:40"]);
  });

  it("appends when it is the newest, which is the ordinary case", () => {
    const transcript = [line("user", "16:16:20"), line("assistant", "16:16:34")];

    const placed = placeByTimestamp(transcript, line("user", "16:16:40"));

    expect(placed.map(stampOf)).toEqual(["16:16:20", "16:16:34", "16:16:40"]);
  });

  it("keeps arrival order for messages that share a timestamp", () => {
    // A second is coarse enough that two messages land in the same one; the
    // one that arrived first stays first rather than shuffling on each render.
    const transcript = [line("assistant", "16:16:34", "first")];

    const placed = placeByTimestamp(transcript, line("user", "16:16:34", "second"));

    expect(placed.map(textOf)).toEqual(["first", "second"]);
  });

  it("appends a message with no timestamp rather than guessing where it goes", () => {
    const transcript = [line("user", "16:16:20"), line("assistant", "16:16:34")];

    const placed = placeByTimestamp(transcript, { role: "user", parts: [{ type: "text", text: "no stamp" }] });

    expect(placed.map(textOf).at(-1)).toBe("no stamp");
  });

  it("appends when the transcript holds no timestamps to compare against", () => {
    const transcript = [{ role: "user" as const, parts: [{ type: "text" as const, text: "old" }] }];

    const placed = placeByTimestamp(transcript, line("assistant", "16:16:34", "new"));

    expect(placed.map(textOf)).toEqual(["old", "new"]);
  });
});

function line(role: ChatLine["role"], clock: string, text = clock): ChatLine {
  return {
    role,
    parts: [{ type: "text", text }],
    meta: { timestamp: `2026-08-26T${clock}.000Z` },
  };
}

function stampOf(entry: ChatLine): string {
  return (entry.meta?.timestamp ?? "").slice(11, 19);
}

function textOf(entry: ChatLine): string {
  const part = entry.parts[0];
  return part?.type === "text" ? part.text : "";
}
