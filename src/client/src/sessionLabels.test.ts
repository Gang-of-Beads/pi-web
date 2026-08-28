import { describe, expect, it } from "vitest";
import type { SessionInfo } from "./api";
import { NEW_SESSION_LABEL, sessionLabel, sessionLabelDetail, shortSessionId } from "./sessionLabels";

function session(patch: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "019f22c5-d53e-7489-997f-fce17c4dc82f",
    cwd: "/repo",
    path: "/repo/.pi/session.jsonl",
    created: "2026-08-28T10:00:00.000Z",
    modified: "2026-08-28T10:00:00.000Z",
    messageCount: 0,
    firstMessage: "",
    ...patch,
  };
}

describe("shortSessionId", () => {
  it("uses the random-looking suffix of UUIDv7 session ids", () => {
    expect(shortSessionId("019f22c5-d53e-7489-997f-fce1e570a202")).toBe("e570a202");
  });

  it("keeps short ids intact", () => {
    expect(shortSessionId("abc123")).toBe("abc123");
  });
});

describe("what a session is called", () => {
  it("prefers the name the reader gave it", () => {
    expect(sessionLabel(session({ name: "Ship the release" }))).toBe("Ship the release");
  });

  it("falls back to what was said first", () => {
    expect(sessionLabel(session({ firstMessage: "Fix the failing test" }))).toBe("Fix the failing test");
  });

  /**
   * A session that has been started but not yet spoken to has no name and no
   * first message, and the last fallback was the tail of its id: a reader on a
   * phone was shown the literal word "7c4dc82f" as the name of the thing they
   * were looking at, in the header and in the rename control.
   *
   * A hexadecimal id is an identifier, not a name.
   */
  it("names a session that has not been spoken to yet in words", () => {
    const label = sessionLabel(session());

    expect(label).toBe(NEW_SESSION_LABEL);
    expect(label).not.toContain("7c4dc82f");
  });

  it("says the same thing when the name is only whitespace", () => {
    expect(sessionLabel(session({ name: "   " }))).toBe(NEW_SESSION_LABEL);
  });
});

describe("what tells two unnamed sessions apart", () => {
  /**
   * Once every new session is called "New session", the list needs something
   * else to separate them. The id is still the thing that distinguishes them,
   * so it stays - as a secondary detail rather than as the name.
   */
  it("offers the id as a detail for a session with no words of its own", () => {
    expect(sessionLabelDetail(session())).toBe("7c4dc82f");
  });

  it("offers no detail once the session has a name of its own", () => {
    expect(sessionLabelDetail(session({ name: "Ship the release" }))).toBeUndefined();
    expect(sessionLabelDetail(session({ firstMessage: "Fix the failing test" }))).toBeUndefined();
  });
});
