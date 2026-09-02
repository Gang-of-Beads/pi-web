import { describe, expect, it } from "vitest";
import { draftWithDictation } from "../dictationDraft.js";

/**
 * The seam between a cumulative reporter and an appending consumer.
 *
 * Live dictation reports everything heard so far on every update. The composer
 * used to append each report to the text already on screen, so the reports
 * accumulated: "hello", then "hello world", left "hello hello world", growing
 * with every interim result. It stayed invisible because the audio was framed
 * as text, which the service discards without an error, so no recognition
 * event ever reached the composer.
 *
 * This replays the sequence a speaker produces against the fold the composer
 * now performs.
 */

/** What the composer does on each live report: fold onto the captured base. */
function replay(typed: string, reports: readonly string[]): string {
  let shown = typed;
  for (const report of reports) shown = draftWithDictation(typed, report);
  return shown;
}

describe("a spoken sentence arriving as cumulative reports", () => {
  it("leaves one copy of the utterance, not one per report", () => {
    expect(replay("", ["hello", "hello world", "hello world again"])).toBe("hello world again");
  });

  it("would have accumulated under the old appending rule", () => {
    let shown = "";
    for (const report of ["hello", "hello world"]) {
      const separator = shown === "" ? "" : " ";
      shown = `${shown}${separator}${report}`;
    }

    expect(shown).toBe("hello hello world");
    expect(replay("", ["hello", "hello world"])).toBe("hello world");
  });

  it("keeps a half-written message the speaker had already typed", () => {
    expect(replay("note:", ["hello", "hello world"])).toBe("note: hello world");
  });

  it("shows nothing extra before the first word is recognised", () => {
    expect(replay("note:", [""])).toBe("note:");
  });
});
