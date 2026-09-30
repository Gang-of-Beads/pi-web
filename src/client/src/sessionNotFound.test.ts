import { describe, expect, it } from "vitest";
import { HttpError } from "./api/http";
import { isSessionNotFoundError } from "./sessionNotFound";

/**
 * P2 slice a: a missing session is recognised by the code the daemon answers
 * with, not by the words. The words remain only for a 404 without a code, from
 * a remote machine on an older daemon.
 */
describe("which failures mean the session is gone", () => {
  it("is keyed on the code, keeps the old words only for a coded-less 404, and never matches words on another status", () => {
    expect({
      "the code": isSessionNotFoundError(new HttpError("Session not found", 404, "local", undefined, "session-not-found")),
      "the code with other words": isSessionNotFoundError(new HttpError("No such session", 404, "local", undefined, "session-not-found")),
      "an older daemon's 404": isSessionNotFoundError(new HttpError("Session not found", 404, "remote-1")),
      "the words on a 500": isSessionNotFoundError(new HttpError("Session not found", 500, "local")),
      "a plain error with the words": isSessionNotFoundError(new Error("Session not found")),
      "a protocol 404": isSessionNotFoundError(new HttpError("Not Found", 404, "local")),
    }).toEqual({
      "the code": true,
      "the code with other words": true,
      "an older daemon's 404": true,
      "the words on a 500": false,
      "a plain error with the words": false,
      "a protocol 404": false,
    });
  });
});
