import { describe, expect, it } from "vitest";
import { applyTranscriptEvent } from "./chatTranscript";
import type { ChatLine } from "./components/shared";

/** An assistant reply that failed, as pi sends it at `message.end`. */
const failure = (errorMessage: string, timestamp: number) => ({ role: "assistant", content: [], stopReason: "error", errorMessage, timestamp });
const retry = { type: "pi.event", eventType: "auto_retry_start" } as const;
const user = (text: string): ChatLine => ({ role: "user", parts: [{ type: "text", text }] });
const texts = (lines: ChatLine[] | undefined): string[] => (lines ?? []).map((line) => line.parts.map((part) => (part.type === "text" ? part.text : part.type)).join(""));
const ended = (lines: ChatLine[], message: unknown): ChatLine[] => applyTranscriptEvent(lines, { type: "message.end", message }) ?? lines;

describe("a failure pi retries", () => {
  it("leaves the live transcript when the retry starts", () => {
    const shown = ended([user("go")], failure("overloaded", 1_000));
    expect(texts(shown)).toEqual(["go", "Model response failed: overloaded"]);
    expect(texts(applyTranscriptEvent(shown, retry))).toEqual(["go"]);
  });

  it("is found behind the reader's own queued messages", () => {
    const shown = [...ended([user("go")], failure("overloaded", 1_000)), user("also this")];
    expect(texts(applyTranscriptEvent(shown, retry))).toEqual(["go", "also this"]);
  });

  it("never takes back an earlier turn's final failure", () => {
    const earlier = ended([user("first")], failure("final", 1_000));
    const later: ChatLine[] = [...earlier, user("second"), { role: "assistant", parts: [{ type: "text", text: "answer" }] }];
    expect(applyTranscriptEvent(later, retry)).toBeUndefined();
  });

  it("takes back only the newest failure when two are on screen", () => {
    const shown = ended(ended([user("go")], failure("first try", 1_000)), failure("second try", 2_000));
    expect(texts(applyTranscriptEvent(shown, retry))).toEqual(["go", "Model response failed: first try"]);
  });
});
