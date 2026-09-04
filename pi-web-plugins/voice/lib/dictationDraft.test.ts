import { describe, expect, it } from "vitest";
import { draftWithDictation } from "./dictationDraft.js";

/**
 * Live dictation reports what it has heard so far, from the beginning, every
 * time it hears more. Batch transcription reports once, at the end.
 *
 * Both used to arrive through the same callback, which appended. Appending a
 * cumulative report means the second update writes what the first already
 * wrote: "hello" then "hello world" leaves "hello hello world". Nobody saw it
 * because the audio was framed in a way the service silently discarded, so no
 * recognition event ever reached this code; fixing the framing exposed it.
 *
 * What must survive: whatever the user had already typed by hand. Dictation
 * replaces only the span it owns.
 */

describe("folding dictated text into a draft", () => {
  it("replaces the previous cumulative report rather than appending it", () => {
    const base = "";

    expect(draftWithDictation(base, "hello")).toBe("hello");
    expect(draftWithDictation(base, "hello world")).toBe("hello world");
  });

  it("keeps what the user typed before dictation started", () => {
    expect(draftWithDictation("notes:", "hello")).toBe("notes: hello");
    expect(draftWithDictation("notes:", "hello world")).toBe("notes: hello world");
  });

  it("does not add a separator when the typed text already ends with space", () => {
    expect(draftWithDictation("notes: ", "hello")).toBe("notes: hello");
    expect(draftWithDictation("notes:\n", "hello")).toBe("notes:\nhello");
  });

  it("leaves the typed text alone while nothing has been heard yet", () => {
    expect(draftWithDictation("notes:", "")).toBe("notes:");
    expect(draftWithDictation("", "")).toBe("");
  });

  /** The whole point of inserting rather than sending: the draft is not lost. */
  it("never drops the typed text, whatever is dictated", () => {
    expect(draftWithDictation("keep me", "spoken words")).toContain("keep me");
  });
});
