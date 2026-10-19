import type { SessionRunAskedBy } from "../../../shared/pluginApiTypes";
import type { ChatLine } from "../components/shared";
import { deliveryTaken } from "../messageDelivery";
import { isPositionalRowKey, rowKeys } from "../rowIdentity";

/**
 * The user messages the agent had taken when the page saw a run start, by row identity, or
 * `unseen` when the page did not hold the session's transcript then.
 */
export type RunStartTranscript = ReadonlySet<string> | "unseen";

/** The transcript on screen as a run starts: what the run did not take. */
export function runStartTranscript(lines: readonly ChatLine[]): ReadonlySet<string> {
  return new Set(takenUserLines(lines).map(({ key }) => key));
}

/**
 * Which device asked for a run that just ended: the newest user message this
 * run took, and the device the machine stamped on it (`sentBy`). The run took a message the agent
 * had not taken when the page saw the run start; a taken message is not an acceptance echo, nor one
 * still on its way or queued. A run whose start the page did not see, or saw without the session's
 * transcript, cannot say which messages it took, so it is unknown: the newest user message may be
 * older than the run, as for a run an extension started. A
 * message known only by its place, or unstamped (the terminal, an extension, a machine too old to
 * stamp), is unknown too, never another device.
 */
export function runAskedBy(lines: readonly ChatLine[], thisDevice: string | undefined, atStart: RunStartTranscript | undefined): SessionRunAskedBy {
  if (atStart === undefined || atStart === "unseen" || thisDevice === undefined) return "unknown";
  const newest = takenUserLines(lines).at(-1);
  if (newest === undefined || isPositionalRowKey(newest.key) || atStart.has(newest.key)) return "unknown";
  const sentBy = newest.line.meta?.sentBy;
  if (sentBy === undefined) return "unknown";
  return sentBy === thisDevice ? "this-device" : "another-device";
}

function takenUserLines(lines: readonly ChatLine[]): { line: ChatLine; key: string }[] {
  const keys = rowKeys([{ lines, firstIndex: 0 }])[0] ?? [];
  return lines.flatMap((line, index) => {
    const key = keys[index];
    if (key === undefined || line.role !== "user" || line.meta?.echo === true) return [];
    const state = line.meta?.delivery?.state;
    return state === undefined || deliveryTaken(state) ? [{ line, key }] : [];
  });
}
