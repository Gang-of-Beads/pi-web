import { describe, expect, it } from "vitest";
import { sessionMissingMeaning } from "./sessionMissingMeaning.js";

/**
 * "Session not found" is true of the daemon and misleading to the reader: the
 * same words describe a session that was deleted and one that is thirty
 * milliseconds young and not written yet. Told only that, the reader gives up
 * on work that was about to exist.
 */

describe("what a missing session means", () => {
  it("reads a transient session as still arriving", () => {
    expect(sessionMissingMeaning("transient").kind).toBe("not-yet-synced");
  });

  it("reads a session known to be on disk as genuinely gone", () => {
    expect(sessionMissingMeaning("persisted").kind).toBe("gone");
  });

  /**
   * Neither the frightening reading nor the reassuring one. Nobody has
   * established which this is, and saying so is the honest answer.
   */
  it("refuses to guess when the session's state was never established", () => {
    expect(sessionMissingMeaning("unknown").kind).toBe("unknown");
  });

  it("gives every state something a reader can act on", () => {
    for (const state of ["transient", "persisted", "unknown"] as const) {
      expect(sessionMissingMeaning(state).notice.length).toBeGreaterThan(0);
    }
  });

  /** The three readings must not share wording, or the distinction is lost. */
  it("says something different for each", () => {
    const notices = new Set([sessionMissingMeaning("transient").notice, sessionMissingMeaning("persisted").notice, sessionMissingMeaning("unknown").notice]);
    expect(notices.size).toBe(3);
  });
});
