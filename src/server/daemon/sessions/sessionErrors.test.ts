import { describe, expect, it } from "vitest";
import { SessionNotFoundError, sessionErrorReply } from "./sessionErrors.js";

/**
 * A missing session is one typed answer (object model §1.6, P2 slice a). The
 * read routes answered 404 for any failure, so a timeout or an I/O error read
 * as a deleted session; the mutation routes decided "not found" by matching
 * the message text.
 */
describe("the answer a session route gives for a failure", () => {
  const failures = {
    "no such session": new SessionNotFoundError(),
    "no such archived session": new SessionNotFoundError({ archived: true }),
    "a plain error with the old words": new Error("Session not found"),
    "an I/O error": new Error("EACCES: permission denied, open '/repo/.pi/sessions/s.jsonl'"),
    "a thrown string": "boom",
    "an error without words": new Error(""),
  };

  it("answers 404 and the code only for a missing session, and the route's own status for everything else", () => {
    expect(Object.fromEntries(Object.entries(failures).map(([label, error]) => [label, sessionErrorReply(error, 500)]))).toEqual({
      "no such session": { status: 404, body: { error: "Session not found", code: "session-not-found" } },
      "no such archived session": { status: 404, body: { error: "Archived session not found", code: "session-not-found" } },
      "a plain error with the old words": { status: 500, body: { error: "Session not found" } },
      "an I/O error": { status: 500, body: { error: "EACCES: permission denied, open '/repo/.pi/sessions/s.jsonl'" } },
      "a thrown string": { status: 500, body: { error: "boom" } },
      "an error without words": { status: 500, body: { error: "The session daemon failed without saying why." } },
    });
  });

  it("keeps each route's own status for a failure that is not a missing session", () => {
    expect(([400, 500, 503] as const).map((fallback) => [sessionErrorReply(new Error("boom"), fallback).status, sessionErrorReply(new SessionNotFoundError(), fallback).status])).toEqual([[400, 404], [500, 404], [503, 404]]);
  });
});
