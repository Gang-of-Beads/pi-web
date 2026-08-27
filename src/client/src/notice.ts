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

/** A request that did not get through is retired by one that does. */
export function noticeFromError(error: unknown): Notice {
  const text = error instanceof Error ? error.message : String(error);
  return error instanceof HttpError ? noticeFromTransport(text) : noticeForReader(text);
}

export function retiresOnReply(notice: Notice): boolean {
  return notice.text !== "" && notice.retiredBy === RetiredBy.reply;
}
