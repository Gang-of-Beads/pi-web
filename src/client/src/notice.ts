import { isTransientError } from "./components/errorBanner";
import { HttpError } from "./api/http";
import { machineIdFromUrl } from "./api/transportHealth";
import { RequestTimeoutError } from "./api/requestDeadline";

/**
 * What retires a notice.
 *
 * A notice asserts something, and what withdraws it depends on what it asserts.
 * Deciding that afterwards, by matching the words against a list of known
 * phrasings, means every message the list has not met stays on screen forever -
 * which is how "HttpError" survived a session that went on replying normally.
 */
export const RetiredBy = {
  /** The claim is that the link is down. An answer from that link disproves it. */
  reply: "reply",
  /** The claim is about one operation or one reader decision. Only the reader retires it. */
  reader: "reader",
} as const;

export type RetiredBy = (typeof RetiredBy)[keyof typeof RetiredBy];

export interface Notice {
  readonly text: string;
  readonly retiredBy: RetiredBy;
  /** The machine a transport claim is about; "page" when the claim is global. */
  readonly machineId?: string;
}


export function noticeFromTransport(text: string, machineId?: string): Notice {
  return machineId === undefined
    ? { text, retiredBy: RetiredBy.reply }
    : { text, retiredBy: RetiredBy.reply, machineId };
}

export function noticeForReader(text: string): Notice {
  return { text, retiredBy: RetiredBy.reader };
}


/** Shown when a failure carried no words of its own; see describeError. */
const UNDESCRIBED_FAILURE = "The request failed";

/**
 * What a thrown value says to a reader.
 *
 * Two shapes arrive here with nothing to say. Over HTTP/2 `response.statusText`
 * is always the empty string, so a response whose body carries no error field
 * builds an `HttpError` with an empty message - and an Error with a name and no
 * message stringifies to just its name, which put a red banner reading the bare
 * word "HttpError" on screen. A thrown non-Error is the same failure in another
 * costume: `String(value)` yields "[object Object]".
 *
 * Neither is something a reader can act on, so a failure that did not describe
 * itself is described by its status instead.
 */
export function describeError(error: unknown): string {
  if (error instanceof HttpError) {
    return error.message === "" ? `${UNDESCRIBED_FAILURE} (${String(error.status)})` : error.message;
  }
  if (error instanceof Error) return error.message === "" ? UNDESCRIBED_FAILURE : error.message;
  const text = String(error);
  return text === "" || text.startsWith("[object") ? UNDESCRIBED_FAILURE : text;
}

/**
 * Whether a failed request should raise a page-level notice at all.
 *
 * The page banner speaks about the link. An operation that went unanswered is
 * a fact about that operation, and it now says so on its own row: a red bar
 * reading "the server did not answer within 30s" over a transcript that was
 * still receiving output made the app look broken while it was working.
 *
 * A deadline miss is rewritten by the wording table to a line that withdraws
 * itself. (The live-link suppression branch - raise nothing while the socket
 * is proven live - is the recorded open seam from the round-19 triage: no
 * production caller can prove liveness yet, so no such branch ships here.)
 */
export function noticeFromError(error: unknown): Notice {
  const text = describeError(error);
  // An HTTP status is an answer: the link demonstrably works and the operation
  // failed. Treating it as a transport claim let the next successful poll
  // erase a real failure 1.5s after it appeared - a red flash, no explanation.
  // It is the operation's outcome, so only the reader (or a replacing message)
  // retires it. The exception is a proxy failure whose body is a transport
  // claim - the gateway answered, but only to say the daemon behind it is
  // unreachable, which is the commonest banner an update produces. That claim
  // heals, so it keeps reply retirement and the wording table applies.
  // Retirement follows the evidence in the message, not the exception's
  // pedigree: helper wrappers re-throw plain Errors carrying the same words,
  // and the same text must not get two lifetimes because two HTTP helpers
  // raised it.
  // An HttpError goes first, because it may carry the machine in its hand:
  // the gateway names the machine it failed for, and a text-first branch
  // would classify the message before that name is read - the scope stamp
  // the producer chose was being dropped by branch order, not by design.
  // Classification still follows the message's evidence, so a reader-type
  // failure that happens to carry a machineId keeps reader retirement.
  if (error instanceof HttpError) {
    return isTransientError(text) ? noticeFromTransport(text, error.machineId) : noticeForReader(text);
  }
  // The display side owns the phrase table (isTransientError below reads
  // it); classification asks rather than re-spelling it, so the two cannot
  // drift - a text the banner would not shorten must not claim a lifetime
  // only the shortening would spend.
  if (isTransientError(text)) {
    return noticeFromTransport(text, error instanceof RequestTimeoutError ? machineIdFromUrl(error.url) : undefined);
  }
  // A deadline miss reaches the transport branch above: its fixed text
  // ("The server did not answer within Ns.") is exactly what the wording
  // table matches, so the deadline claims a reply lifetime and later answers
  // disprove it the same way. Measured live: a remote machine answered
  // /status at 30.007s against a 30.000s browser deadline, and the timeout
  // banner outlived the working session on the reader lifetime.
  return noticeForReader(text);
}
