import { HttpError } from "./api/http";
import { SESSION_NOT_FOUND_CODE } from "../../shared/apiTypes";
import { describeError, noticeForReader, noticeFromError, type Notice } from "./notice";

/** What a send the machine answered with the code tells the reader; the words match the session's own page. */
export const SEND_TO_MISSING_SESSION = "This session no longer exists, so your message was not sent.";

/**
 * The notice of a refused send (owner, 2026-10-01: if so, say so as an error up top).
 *
 * The code says the machine holds no such session: it was deleted on another device, by the pi
 * CLI, or by hand on the disk, while this page still showed it. The daemon's own words, "Session
 * not found", read as a fault of the page. A message's words go back to the composer; any other
 * refusal keeps the words it was answered with.
 *
 * The code comes from the session's own store, read through its own cwd, so it is an answer about
 * that session. A session moved to another store by a changed `sessionDir` would read as gone
 * here; the open says so too, through the machine-wide locate, when the reader opens it again.
 */
export function sendRefusalNotice(error: unknown, machineId: string): Notice {
  if (isSessionNotFoundError(error)) return noticeForReader(SEND_TO_MISSING_SESSION, machineId);
  if (isPayloadTooLarge(error)) return noticeForReader(tooLargeWords(error), machineId);
  return noticeFromError(error);
}

/** The same words for the transcript line and the command row a refused shell line or command leaves. */
export function sendRefusalWords(error: unknown): string {
  if (isSessionNotFoundError(error)) return SEND_TO_MISSING_SESSION;
  if (isPayloadTooLarge(error)) return tooLargeWords(error);
  return describeError(error);
}

/** A body the machine would not take, with its ceiling and what to do instead; the send is refused, nothing was written. */
export const TOO_LARGE_IN_ONE_REQUEST = "Too large for one request";

function isPayloadTooLarge(error: unknown): error is HttpError {
  return error instanceof HttpError && error.status === 413;
}

function tooLargeWords(error: HttpError): string {
  const limit = limitWords(error.message);
  return `${TOO_LARGE_IN_ONE_REQUEST}: ${limit} Put the file in the workspace and mention its path instead.`;
}

function limitWords(message: string): string {
  const match = /\((.+?)\)/u.exec(message);
  return match?.[1] === undefined ? "the machine refused it." : `this machine accepts at most ${match[1]}.`;
}

/**
 * Whether a failure says the machine does not have the session (object model
 * §1.6, P2 slice a).
 *
 * The daemon answers a missing session with a code, and only the code is
 * checked; a match on the words decided it before, and any error whose text
 * happened to contain them read as a deleted session.
 */
export function isSessionNotFoundError(error: unknown): boolean {
  return error instanceof HttpError && error.code === SESSION_NOT_FOUND_CODE;
}

/**
 * Where a failed read or change of one session goes (P2 slice b part 2; state-diagram D8).
 *
 * - `locate`: the daemon's code about the session the reader has open. The page does not
 *   report a failure: the session becomes a named target, and the machine-wide locate says
 *   whether it is gone, archived or recorded elsewhere (owner, 2026-10-01: report that it
 *   was deleted).
 * - `already-located`: the code about a session that is already the named target, from a read
 *   that was on its way. It says nothing new.
 * - `notice`: anything else, including the code about a row the reader does not have open.
 */
export type SessionFailureRoute = "locate" | "already-located" | "notice";

export function sessionFailureRoute(error: unknown, sessionId: string, openSessionId: string | undefined, targetSessionId: string | undefined): SessionFailureRoute {
  if (!isSessionNotFoundError(error)) return "notice";
  if (sessionId === openSessionId) return "locate";
  return sessionId === targetSessionId ? "already-located" : "notice";
}
