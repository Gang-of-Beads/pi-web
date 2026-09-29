/**
 * The live half of hiding a failure pi retried.
 *
 * Owner, 2026-09-30: "完全重试失败之前的错误不要显示出来". A retried attempt is not
 * the turn's outcome. The daemon drops it from history pages (`retriedAttemptIds`),
 * but the browser watching the turn has already drawn it from `message.end`. pi then
 * announces the retry (`auto_retry_start`) without naming the message.
 *
 * The attempt being retried is the latest reply, so only the newest failed rows are
 * taken back, and only when nothing but the reader's own queued messages came
 * after them. An earlier turn's final failure is never touched.
 */
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
