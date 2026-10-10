/**
 * The live half of hiding a failure pi retried (state-diagram D11).
 *
 * Owner, 2026-09-30: "don't show the errors from before the retries have completely failed"; Q16,
 * 2026-10-10: a failure no retry replaced is the turn's outcome and shows. The daemon hides an
 * attempt in history pages while its retry is to come and once a newer reply replaced it
 * (`retriedAttemptIds`), but the browser watching the turn has already drawn it from
 * `message.end`. The daemon names the attempt in `attempt.retry`; an older daemon only announces
 * the retry (`auto_retry_start`) without naming the message.
 *
 * Unnamed, the attempt being retried is the latest reply, so only the newest failed rows are
 * taken back, and only when nothing but the reader's own queued messages came after them. An
 * earlier turn's final failure is never touched.
 */
import { normalizeMessage } from "./chatMessages";
import type { ChatLine } from "./components/shared";

export function withoutRetriedAttempt(messages: ChatLine[]): ChatLine[] | undefined {
  let last = messages.length - 1;
  while (last >= 0 && messages[last]?.role === "user") last -= 1;
  const failed = messages[last];
  if (failed?.meta?.failedAttempt !== true) return undefined;
  const timestamp = failed.meta.timestamp;
  let first = last;
  while (first > 0) {
    const previous = messages[first - 1];
    if (previous?.meta?.failedAttempt !== true || previous.meta.timestamp !== timestamp) break;
    first -= 1;
  }
  return [...messages.slice(0, first), ...messages.slice(last + 1)];
}

/** The stamps of the named attempts' rows: a reply's rows carry its timestamp and are marked as a failed attempt, drawn live or read from history alike. */
export function attemptStamps(attempts: readonly unknown[]): Set<string> {
  return new Set(attempts.flatMap(normalizeMessage).flatMap((line) => (line.meta?.failedAttempt === true && line.meta.timestamp !== undefined ? [line.meta.timestamp] : [])));
}

export function isAttemptRow(line: ChatLine, stamps: ReadonlySet<string>): boolean {
  return line.meta?.failedAttempt === true && line.meta.timestamp !== undefined && stamps.has(line.meta.timestamp);
}

/** Hide the named attempts while pi retries them. Found by stamp, so a second application removes nothing more. */
export function withoutAttempts(messages: ChatLine[], attempts: readonly unknown[]): ChatLine[] | undefined {
  const stamps = attemptStamps(attempts);
  const kept = messages.filter((line) => !isAttemptRow(line, stamps));
  return kept.length === messages.length ? undefined : kept;
}
