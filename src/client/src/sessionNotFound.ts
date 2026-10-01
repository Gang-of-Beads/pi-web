import { HttpError } from "./api/http";
import { SESSION_NOT_FOUND_CODE } from "../../shared/apiTypes";
import { describeError, noticeForReader, noticeFromError, type Notice } from "./notice";

/** What a send the machine answered with the code tells the reader; the words match the session's own page. */
export const SEND_TO_MISSING_SESSION = "This session no longer exists, so your message was not sent.";

/**
 * The notice of a refused send (owner, 2026-10-01: "如果是就直接报错啊在上面").
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
  return isSessionNotFoundError(error) ? noticeForReader(SEND_TO_MISSING_SESSION, machineId) : noticeFromError(error);
}

/** The same words for the transcript line and the command row a refused shell line or command leaves. */
export function sendRefusalWords(error: unknown): string {
  return isSessionNotFoundError(error) ? SEND_TO_MISSING_SESSION : describeError(error);
}

/** The words an older daemon answered a missing session with, before it sent a code. */
const LEGACY_SESSION_NOT_FOUND = /^(archived )?session not found$/iu;

/**
 * Whether a failure says the machine does not have the session (object model
 * §1.6, P2 slice a).
 *
 * The daemon answers a missing session with a code, and that is what is
 * checked; a match on the words decided it before, and any error whose text
 * happened to contain them read as a deleted session. A remote machine on an
 * older daemon still answers 404 with the words and no code, so that exact
 * answer is recognised too - one release of rolling compatibility, to be
 * removed once every machine runs a daemon that sends the code.
 */
export function isSessionNotFoundError(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false;
  if (error.code !== undefined) return error.code === SESSION_NOT_FOUND_CODE;
  return error.status === 404 && LEGACY_SESSION_NOT_FOUND.test(error.message.trim());
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
