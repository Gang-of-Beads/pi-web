import { HttpError } from "./api/http";
import { SESSION_NOT_FOUND_CODE } from "../../shared/apiTypes";

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
