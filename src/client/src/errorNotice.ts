import type { AppState } from "./appState";
import { noticeFromError, type Notice } from "./notice";

/**
 * The one way a controller reports a failure to the reader.
 *
 * Failures used to be reported as `setState({ error: String(error) })`, written
 * out at 53 call sites. Each one independently decided both the words and the
 * lifetime of the banner, and both decisions were wrong in the same way
 * everywhere:
 *
 * - `String(error)` on an `HttpError` with an empty message yields the bare
 *   class name, so the reader saw "HttpError". The message is empty whenever a
 *   response body carries no error field, because `statusText` is always "" over
 *   HTTP/2.
 * - None of them set `errorRetiredBy`, so it kept its initial `reader` value and
 *   the code that withdraws a transport complaint after a successful reply
 *   returned early every time. The banner stayed until dismissed by hand.
 *
 * Returning every notice field together (`NoticeFields`: words, lifetime,
 * machine and claim) makes them impossible to set apart, so a call site added
 * later cannot reintroduce half of a notice.
 */
export function errorNoticePatch(error: unknown): NoticeFields {
  return noticePatch(noticeFromError(error));
}

/** The notice's fields in the app state: its words, lifetime, machine and claim always move together. */
export type NoticeFields = Pick<AppState, "error" | "errorRetiredBy" | "errorMachineId" | "errorClaim">;

/** An AppState patch carrying a Notice with its retirement semantics. */
export function noticePatch(notice: Notice): NoticeFields {
  return { error: notice.text, errorRetiredBy: notice.retiredBy, errorMachineId: notice.machineId ?? "page", errorClaim: notice.claim };
}

/** The one way to clear: a cleared banner carries no stranger's mark or scope. */
export function clearErrorPatch(): NoticeFields {
  return { error: "", errorRetiredBy: "reader", errorMachineId: "page", errorClaim: undefined };
}
