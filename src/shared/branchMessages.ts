import { isRecord } from "./unknownValues.js";
import type { TranscriptHead } from "./apiTypes.js";
/**
 * The transcript as the browser receives it, from the entries of a branch.
 *
 * A session that Pi holds open and a child run's transcript file are the same
 * thing on disk - a session `jsonl` whose entries are `message`,
 * `thinking_level_change`, `custom_message`, `compaction` and `branch_summary`.
 * Measured on a real child run: entry types `{session, model_change,
 * thinking_level_change, session_info, message}` and roles `{user, assistant,
 * toolResult}`, which is exactly what this walk already handled for the live
 * case.
 *
 * So the walk lives here rather than inside the service that owns live
 * sessions, and both callers share one projection. Writing a second one for
 * child runs would be the mistake this module exists to prevent: the sidebar
 * count and the chat total disagreed for two releases precisely because two
 * places each decided for themselves what counted as a message.
 */

/**
 * Custom entry the daemon appends when the reader presses Stop during a turn.
 *
 * pi records an ended reply with its provider's words ("This operation was aborted")
 * and not who ended it, so after a reload a Stop the reader pressed read the same as
 * a dropped connection. Owner, 2026-09-30: only two cases matter, "you stopped it"
 * and "it was interrupted". The entry is the durable half; the daemon also marks the
 * live reply, so every device and every reload says the same.
 */
export const TURN_STOPPED_CUSTOM_TYPE = "pi-web.turn.stopped";

/**
 * Custom entry the daemon appends when it cannot show an extension's dialog (B10): the only case
 * left is a dialog kind this PI WEB does not know, which a newer pi could add. Owner, 2026-10-07:
 * the row saying so stays in PI WEB's record, after a reload and on every device. A custom entry
 * is what pi neither renders in its terminal nor sends to the model, which the owner chose over a
 * custom message the model would read.
 */
export const REFUSED_DIALOG_CUSTOM_TYPE = "pi-web.dialog.refused";

/** The row a refused dialog leaves, live and from history alike; `at` is when the daemon refused it. */
export function refusedDialogMessage(reason: string, at: string | undefined): Record<string, unknown> {
  return { role: "system", content: `An extension asked something PI WEB could not show: ${reason}.`, ...(at === undefined ? {} : { timestamp: at }) };
}

function isRefusedDialogEntry(entry: Record<string, unknown>): boolean {
  return entry["type"] === "custom" && entry["customType"] === REFUSED_DIALOG_CUSTOM_TYPE;
}

/** A reply that ended without finishing: pi's own abort, or an error. */
export function isCutAssistant(message: unknown): boolean {
  return isRecord(message) && message["role"] === "assistant" && (message["stopReason"] === "aborted" || message["stopReason"] === "error");
}

function stoppedByYou(message: unknown): unknown {
  return isRecord(message) ? { ...message, stoppedBy: "you" } : message;
}

/**
 * The row a reader's Stop settles as when no reply followed it: the shape of a reply the Stop
 * cut, with nothing in it, so the browser words it with the one classifier every cut reply goes
 * through. pi writes no reply for a Stop pressed while it waits to retry a failed attempt, and
 * that attempt is hidden as retried, so without this the Stop left nothing on screen (B30).
 * The daemon publishes the same row live; `at` is the moment it recorded the Stop.
 */
export function stoppedTurnMessage(at: string | undefined): Record<string, unknown> {
  return { role: "assistant", content: [], stopReason: "aborted", stoppedBy: "you", ...(at === undefined ? {} : { timestamp: at }) };
}

/**
 * Where each Stop the reader pressed settles: on the first reply it cut, or on its own when a
 * user message or the end of the branch comes first. One walk owns this so the transcript and
 * the sidebar count read the same rule.
 */
export function stopOutcomes(entries: readonly unknown[]): { cutReplies: Set<string>; alone: Map<string, string | undefined> } {
  const cutReplies = new Set<string>();
  const alone = new Map<string, string | undefined>();
  let pending: Record<string, unknown> | undefined;
  const settleAlone = () => { if (pending !== undefined) alone.set(getString(pending, "id") ?? "", stopMoment(pending)); pending = undefined; };
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (entry["type"] === "custom" && entry["customType"] === TURN_STOPPED_CUSTOM_TYPE) {
      settleAlone();
      pending = entry;
      continue;
    }
    if (entry["type"] !== "message" || pending === undefined) continue;
    const message = entry["message"];
    if (isRecord(message) && message["role"] === "user") settleAlone();
    else if (isCutAssistant(message)) {
      cutReplies.add(getString(entry, "id") ?? "");
      pending = undefined;
    }
  }
  settleAlone();
  return { cutReplies, alone };
}

function stopMoment(entry: Record<string, unknown>): string | undefined {
  return getString(entry["data"], "at") ?? getString(entry, "timestamp");
}

/**
 * The failed attempts pi retried: an assistant message that ended in an error and
 * that a `context_edit` then removed with no replacement. That pair is pi's own
 * recovery signature (`auto_retry_start`, then `_omitRecoveryAttempt`), so nothing
 * else an extension edits out of the model's context is hidden by it.
 *
 * Owner, 2026-09-30: "don't show the errors from before the retries have completely failed" - a failure the retry then
 * replaced is not the turn's outcome; only the attempt nobody retried is.
 */
export function retriedAttemptIds(entries: readonly unknown[]): Set<string> {
  const errored = new Set<string>();
  const retried = new Set<string>();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const id = getString(entry, "id");
    if (id !== undefined && entry["type"] === "message" && isErroredAssistant(entry["message"])) errored.add(id);
    const target = getString(entry, "targetId");
    if (entry["type"] === "context_edit" && entry["replacement"] === null && target !== undefined && errored.has(target)) retried.add(target);
  }
  return retried;
}

function isErroredAssistant(message: unknown): boolean {
  return isRecord(message) && message["role"] === "assistant" && message["stopReason"] === "error";
}

/** Entry types `branchTranscript` draws a row for, except a message pi retried aside. */
const RENDERED_ENTRY_TYPES: ReadonlySet<unknown> = new Set(["message", "compaction", "branch_summary"]);

/**
 * Whether the transcript renders this entry, and so whether it is counted. A compaction and a
 * branch summary are drawn as rows, so they count: leaving them out made the session's count
 * one short of the transcript's own total per compaction (owed review of 402a9e22, lane C).
 */
export function isReadableBranchEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  if (RENDERED_ENTRY_TYPES.has(entry["type"]) || isRefusedDialogEntry(entry)) return true;
  return entry["type"] === "custom_message" && entry["display"] === true;
}

/**
 * Normalize a branch into the messages the chat view consumes.
 *
 * Pi records the initial thinking level at session creation and every later
 * change, so walking in order yields the level in effect for each assistant
 * message.
 */
export function branchMessages(entries: Iterable<unknown>): unknown[] {
  return branchTranscript(entries).map((row) => row.message);
}

/** One transcript message and the id of the session entry it was projected from. */
export interface TranscriptRow {
  entryId: string | undefined;
  message: unknown;
}

/**
 * Where a transcript stands. Entry ids are written into the session file, so a head survives
 * a daemon restart and needs no epoch. The projection is not append-only - a later
 * `context_edit` removes a retried attempt - so a head can move back as well as forward; a
 * reader compares heads by value (docs/design/sync-convergence.md).
 */
export function transcriptHead(transcript: readonly TranscriptRow[]): TranscriptHead {
  return { n: transcript.length, leaf: transcript.at(-1)?.entryId ?? null };
}

/** {@link branchMessages}, with each message's entry id beside it. */
export function branchTranscript(entries: Iterable<unknown>): TranscriptRow[] {
  const branch = [...entries];
  const retried = retriedAttemptIds(branch);
  const stops = stopOutcomes(branch);
  const rows: TranscriptRow[] = [];
  const push = (entry: Record<string, unknown>, message: unknown) => { rows.push({ entryId: getString(entry, "id"), message }); };
  let thinkingLevel: string | undefined;
  for (const entry of branch) {
    if (!isRecord(entry)) continue;
    const id = getString(entry, "id") ?? "";
    if (entry["type"] === "custom" && stops.alone.has(id)) push(entry, stoppedTurnMessage(stops.alone.get(id)));
    if (entry["type"] === "message") {
      const message = entry["message"];
      if (!retried.has(id)) push(entry, annotateAssistantThinkingLevel(stops.cutReplies.has(id) ? stoppedByYou(message) : message, thinkingLevel));
    }
    else if (entry["type"] === "thinking_level_change") {
      const level = getString(entry, "thinkingLevel");
      if (level !== undefined) thinkingLevel = level;
    }
    else if (entry["type"] === "custom_message" && entry["display"] === true) push(entry, { role: "custom", content: entry["content"], customType: entry["customType"], details: entry["details"] });
    else if (isRefusedDialogEntry(entry)) push(entry, refusedDialogMessage(getString(entry["data"], "reason") ?? "", getString(entry["data"], "at") ?? getString(entry, "timestamp")));
    else if (entry["type"] === "compaction") push(entry, { role: "system", source: "compaction", content: `Compacted history:\n\n${stringValue(entry["summary"])}` });
    else if (entry["type"] === "branch_summary") push(entry, { role: "system", source: "branch_summary", content: `Branch summary:\n\n${stringValue(entry["summary"])}` });
  }
  return rows;
}

/**
 * Attach the thinking level in effect when an assistant message was generated,
 * so chat bubbles can show it next to the model. Non-assistant messages pass
 * through by reference; assistant messages are copied only when a level is set.
 * "off" is the absence of thinking, not a level worth labeling on every bubble.
 */
export function annotateAssistantThinkingLevel(message: unknown, thinkingLevel: string | undefined): unknown {
  if (thinkingLevel === undefined || thinkingLevel === "" || thinkingLevel === "off") return message;
  if (!isRecord(message) || message["role"] !== "assistant") return message;
  return { ...message, thinkingLevel };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getString(value: unknown, key: string): string | undefined {
  const property = isRecord(value) ? value[key] : undefined;
  return typeof property === "string" ? property : undefined;
}
