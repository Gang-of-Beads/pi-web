import { describe, expect, it } from "vitest";
import { transcriptLoadingAfter } from "./transcriptLoadingOwnership.js";

/**
 * The "loading" flag belongs to the selection that set it.
 *
 * A transcript read marks the session as loading so an unread transcript is not
 * drawn as an empty one. Clearing that flag is restricted to the selection that
 * set it, because a superseded read finishing late would otherwise clear the
 * flag of the newer read still in flight, and the newer session would be called
 * empty while its history was still arriving.
 *
 * That restriction assumed a newer selection always exists to take the flag
 * over. Abandoning the selection breaks the assumption: deselecting, or
 * disposing the controller, advances the selection counter without starting a
 * read, so the in-flight read finds itself superseded and declines to clear,
 * and no successor ever clears it either. The session then reads
 * "Loading this session..." with nothing loading behind it - reported after a
 * quick-access switch, where it never resolved.
 *
 * Abandonment ends the flag: nothing is loading once nobody is waiting.
 */

describe("who may clear the transcript loading flag", () => {
  it("lets the selection that set the flag clear it", () => {
    expect(transcriptLoadingAfter({ event: "readSettled", readSeq: 5, currentSeq: 5 })).toBe(false);
  });

  it("keeps the flag when a newer selection is still reading", () => {
    expect(transcriptLoadingAfter({ event: "readSettled", readSeq: 5, currentSeq: 6 })).toBe(true);
  });

  /** The stuck state: superseded by an abandonment, so no successor clears it. */
  it("ends the flag when the selection is abandoned", () => {
    expect(transcriptLoadingAfter({ event: "selectionAbandoned" })).toBe(false);
  });

  /**
   * The same stuck state by a second route, which the first fix missed:
   * starting a session advances the counter without reading anything, so an
   * in-flight read declines to clear, and a brand-new session has no history
   * that could arrive to clear it either.
   */
  it("ends the flag when the new selection has nothing to read", () => {
    expect(transcriptLoadingAfter({ event: "selectedWithoutRead" })).toBe(false);
  });

  it("starts the flag when a read begins", () => {
    expect(transcriptLoadingAfter({ event: "readStarted" })).toBe(true);
  });
});
