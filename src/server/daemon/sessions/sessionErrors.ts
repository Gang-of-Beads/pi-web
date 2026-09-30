import { SESSION_NOT_FOUND_CODE } from "../../../shared/apiTypes.js";

/**
 * A session the daemon does not have, as one typed answer (object model §1.6,
 * P2 slice a).
 *
 * The read routes answered 404 for any failure, so a timeout or an I/O error
 * read as a deleted session, and the mutation routes decided "not found" by
 * matching the message text. The words stay the same so older clients keep
 * recognising them; the `code` is what the answer is keyed on.
 */
export class SessionNotFoundError extends Error {
  readonly code = SESSION_NOT_FOUND_CODE;

  constructor(options: { archived?: boolean } = {}) {
    super(options.archived === true ? "Archived session not found" : "Session not found");
    this.name = "SessionNotFoundError";
  }
}

export interface SessionErrorReply {
  readonly status: number;
  readonly body: { readonly error: string; readonly code?: typeof SESSION_NOT_FOUND_CODE };
}

/**
 * What a failed session route answers: a missing session is 404 with the code;
 * anything else keeps the route's own status - 500 for a read the daemon
 * failed to answer, 400 for a refused request, 503 for child work that could
 * not be read.
 */
export function sessionErrorReply(error: unknown, otherwise: 400 | 500 | 503): SessionErrorReply {
  if (error instanceof SessionNotFoundError) return { status: 404, body: { error: error.message, code: error.code } };
  return { status: otherwise, body: { error: errorText(error) } };
}

const NO_REASON = "The session daemon failed without saying why.";

/** An error's words for a reply body; an error without any says so, rather than sending an empty reason. */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim() === "" ? NO_REASON : text;
}
