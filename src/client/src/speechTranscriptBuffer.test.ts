import { describe, expect, it } from "vitest";
import { SpeechTranscriptBuffer } from "./speechTranscriptBuffer";

/**
 * What the composer shows while someone is still talking.
 *
 * The two protocols disagree about what a delta means. OpenAI sends fragments
 * to append; Deepgram re-sends the whole current phrase each time. Appending
 * Deepgram's interim results produces "hello hello there hello there now", and
 * replacing on OpenAI's produces only the last syllable. The buffer holds that
 * difference in one place so the composer never has to know which service is
 * connected.
 *
 * Settled text is kept separately from the current guess: a guess is replaced
 * on every message, and only settled text may be counted on.
 */
describe("an appending protocol", () => {
  it("builds the phrase out of fragments", () => {
    const buffer = new SpeechTranscriptBuffer("append");
    buffer.apply({ kind: "delta", text: "hello" });
    buffer.apply({ kind: "delta", text: " there" });

    expect(buffer.text()).toBe("hello there");
  });

  it("keeps settled text and starts the next guess clean", () => {
    const buffer = new SpeechTranscriptBuffer("append");
    buffer.apply({ kind: "delta", text: "hello" });
    buffer.apply({ kind: "final", text: "hello there" });
    buffer.apply({ kind: "delta", text: " and" });

    expect(buffer.text()).toBe("hello there and");
  });
});

describe("a replacing protocol", () => {
  it("shows the latest guess rather than every guess joined up", () => {
    const buffer = new SpeechTranscriptBuffer("replace");
    buffer.apply({ kind: "delta", text: "hello" });
    buffer.apply({ kind: "delta", text: "hello there" });

    expect(buffer.text()).toBe("hello there");
  });

  it("settles a phrase and begins the next one after it", () => {
    const buffer = new SpeechTranscriptBuffer("replace");
    buffer.apply({ kind: "delta", text: "hello ther" });
    buffer.apply({ kind: "final", text: "hello there." });
    buffer.apply({ kind: "delta", text: "how are" });

    expect(buffer.text()).toBe("hello there. how are");
  });
});

describe("either protocol", () => {
  it("reports the settled text on its own, so a stop keeps only what was heard", () => {
    const buffer = new SpeechTranscriptBuffer("replace");
    buffer.apply({ kind: "final", text: "settled" });
    buffer.apply({ kind: "delta", text: "still guessing" });

    expect(buffer.settledText()).toBe("settled");
  });

  it("leaves the text alone when the service reports an error", () => {
    const buffer = new SpeechTranscriptBuffer("append");
    buffer.apply({ kind: "delta", text: "hello" });
    buffer.apply({ kind: "error", message: "socket closed" });

    expect(buffer.text()).toBe("hello");
  });

  it("starts empty and stays empty until something is heard", () => {
    expect(new SpeechTranscriptBuffer("append").text()).toBe("");
  });
});
