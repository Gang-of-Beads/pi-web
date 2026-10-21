import { describe, expect, it } from "vitest";
import { HttpError } from "./api/http";
import { isSessionNotFoundError, sessionFailureRoute } from "./sessionNotFound";

/**
 * P2 slice a: a missing session is recognised by the code the daemon answers
 * with, never by the words.
 */
describe("which failures mean the session is gone", () => {
  it("is keyed on the code alone and never matches the words", () => {
    expect({
      "the code": isSessionNotFoundError(new HttpError("Session not found", 404, "local", undefined, "session-not-found")),
      "the code with other words": isSessionNotFoundError(new HttpError("No such session", 404, "local", undefined, "session-not-found")),
      "the words on a coded-less 404": isSessionNotFoundError(new HttpError("Session not found", 404, "remote-1")),
      "the words on a 500": isSessionNotFoundError(new HttpError("Session not found", 500, "local")),
      "a plain error with the words": isSessionNotFoundError(new Error("Session not found")),
      "a protocol 404": isSessionNotFoundError(new HttpError("Not Found", 404, "local")),
    }).toEqual({
      "the code": true,
      "the code with other words": true,
      "the words on a coded-less 404": false,
      "the words on a 500": false,
      "a plain error with the words": false,
      "a protocol 404": false,
    });
  });
});

describe("where a failed read or change of one session goes (P2 slice b part 2)", () => {
  it("locates the open session on the code, says nothing new about the named target, and keeps everything else a notice", () => {
    const code = new HttpError("Session not found", 404, "local", undefined, "session-not-found");
    const other = new HttpError("Internal error", 500, "local");

    expect({
      "the code, the open session": sessionFailureRoute(code, "a", "a", undefined),
      "the code, the named target": sessionFailureRoute(code, "a", undefined, "a"),
      "the code, another row": sessionFailureRoute(code, "b", "a", undefined),
      "the code, nothing open": sessionFailureRoute(code, "a", undefined, undefined),
      "another failure, the open session": sessionFailureRoute(other, "a", "a", undefined),
      "another failure, the named target": sessionFailureRoute(other, "a", undefined, "a"),
    }).toEqual({
      "the code, the open session": "locate",
      "the code, the named target": "already-located",
      "the code, another row": "notice",
      "the code, nothing open": "notice",
      "another failure, the open session": "notice",
      "another failure, the named target": "notice",
    });
  });
});
