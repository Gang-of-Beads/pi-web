import { HttpError } from "./api/http";

/**
 * What retires a notice.
 *
 * A notice asserts something, and what withdraws it depends on what it asserts.
 * Deciding that afterwards, by matching the words against a list of known
 * phrasings, means every message the list has not met stays on screen forever -
 * which is how "HttpError" survived a session that went on replying normally.
 */
export const RetiredBy = {
  /** The claim is that the server could not be reached. A reply disproves it. */
  reply: "reply",
  /** The claim is about one operation. Only the reader can retire it. */
  reader: "reader",
} as const;

export type RetiredBy = (typeof RetiredBy)[keyof typeof RetiredBy];

export interface Notice {
  readonly text: string;
  readonly retiredBy: RetiredBy;
}

export const NO_NOTICE: Notice = { text: "", retiredBy: RetiredBy.reader };

export function noticeFromTransport(text: string): Notice {
  return { text, retiredBy: RetiredBy.reply };
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

/** A request that did not get through is retired by one that does. */
export function noticeFromError(error: unknown): Notice {
  const text = describeError(error);
  return error instanceof HttpError ? noticeFromTransport(text) : noticeForReader(text);
}

export function retiresOnReply(notice: Notice): boolean {
  return notice.text !== "" && notice.retiredBy === RetiredBy.reply;
}
