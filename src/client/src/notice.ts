import { HttpError } from "./api/http";
import { machineIdFromUrl } from "./api/transportHealth";
import { RequestTimeoutError } from "./api/requestDeadline";
import { transportClaimOf, type TransportClaim } from "./api/transportClaim";

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
  /** What a self-healing failure claims about the link (B16); the row words it, and the next answer retires it. */
  readonly claim?: TransportClaim;
}


export function noticeFromTransport(text: string, machineId?: string, claim?: TransportClaim): Notice {
  return { text, retiredBy: RetiredBy.reply, ...(machineId === undefined ? {} : { machineId }), ...(claim === undefined ? {} : { claim }) };
}

export function noticeForReader(text: string, machineId?: string): Notice {
  return machineId === undefined
    ? { text, retiredBy: RetiredBy.reader }
    : { text, retiredBy: RetiredBy.reader, machineId };
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
 * The notice a failure raises.
 *
 * The page row speaks about the link. A failure that claims the link is down (`transportClaimOf`:
 * by its type, never its words) is retired by the next answer from that link; anything else,
 * an HTTP refusal included, is the outcome of one operation and only the reader retires it.
 * Measured live: a remote machine answered /status at 30.007s against a 30.000s browser
 * deadline, and the timeout notice outlived the working session on the reader's lifetime.
 *
 * The machine a notice speaks about rides with it: the gateway names the machine it failed for,
 * and a deadline names the machine its URL asked.
 */
export function noticeFromError(error: unknown): Notice {
  const text = describeError(error);
  const claim = transportClaimOf(error);
  const machineId = noticeMachineOf(error);
  return claim === undefined ? noticeForReader(text, machineId) : noticeFromTransport(text, machineId, claim);
}

function noticeMachineOf(error: unknown): string | undefined {
  if (error instanceof HttpError) return error.machineId;
  return error instanceof RequestTimeoutError ? machineIdFromUrl(error.url) : undefined;
}
