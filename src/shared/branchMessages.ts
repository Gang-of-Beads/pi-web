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
/** Written when the daemon settled the reader's Stop on its own, so history ends it there too (D1, B30). */
export const TURN_STOP_SETTLED_CUSTOM_TYPE = "pi-web.turn.stop-settled";

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
 * user message, the daemon's recorded settlement (TURN_STOP_SETTLED_CUSTOM_TYPE), or the end of the
 * branch comes first. One walk owns this so the transcript and
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
    if (entry["type"] === "custom" && entry["customType"] === TURN_STOP_SETTLED_CUSTOM_TYPE) {
      settleAlone();
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
 * Custom entry the daemon appends when a failed attempt pi took back to try again was never
 * replaced: the retry was cancelled (a Stop in the wait), the overflow compaction failed, the run
 * ended, the session closed, or the daemon restarted during the wait (state-diagram D11). The
 * attempt is then the turn's outcome and shows; pi itself keeps it out of the model's context.
 */
export const RETRY_UNREPLACED_CUSTOM_TYPE = "pi-web.retry.unreplaced";

const NO_PENDING: ReadonlySet<string> = new Set();

/**
 * The row saying why no retry replaced an attempt: pi's own words when pi gave them ("Retry
 * cancelled", its compaction failure), else the daemon's. History draws it right after the
 * attempt and the daemon publishes it live in the same place, so a Stop's own row follows it in
 * both (D11).
 */
export function retryUnreplacedMessage(reason: string, at: string | undefined): Record<string, unknown> {
  return { role: "system", content: reason, ...(at === undefined ? {} : { timestamp: at }) };
}

/** The attempts an unreplaced record names; the one place that reads the record's shape. */
function recordedAttemptIds(entry: Record<string, unknown>): string[] {
  const data = entry["data"];
  return stringsOf(isRecord(data) ? data["attemptIds"] : undefined);
}

/** The record's row, keyed by the last attempt it names: that attempt is where the row is drawn. */
function retryUnreplacedRow(entry: Record<string, unknown>): { attemptId: string; message: Record<string, unknown> } | undefined {
  const data = entry["data"];
  const attemptId = recordedAttemptIds(entry).at(-1);
  if (attemptId === undefined) return undefined;
  return { attemptId, message: retryUnreplacedMessage(getString(data, "reason") ?? "", getString(data, "at") ?? getString(entry, "timestamp")) };
}

function isRetryUnreplacedEntry(entry: Record<string, unknown>): boolean {
  return entry["type"] === "custom" && entry["customType"] === RETRY_UNREPLACED_CUSTOM_TYPE;
}

/** Whether a session entry is an assistant reply that ended in an error: the only kind pi takes back to retry that is hidden. */
export function isErroredReplyEntry(entry: unknown): boolean {
  return isRecord(entry) && entry["type"] === "message" && isErroredAssistant(entry["message"]);
}

/** The failed attempts pi took back, where each sits, which the daemon recorded as unreplaced, and where the newest reply sits. */
interface AttemptsTakenBack {
  readonly takenBack: ReadonlyMap<string, number>;
  readonly unreplaced: ReadonlySet<string>;
  readonly lastReply: number;
}

/**
 * An assistant message that ended in an error and that a `context_edit` then removed with no
 * replacement is pi's own recovery signature (auto-retry's `_prepareRetry` and overflow recovery,
 * both through `_omitRecoveryAttempt`), so nothing else an extension edits out of the model's
 * context counts.
 */
function attemptsTakenBack(entries: readonly unknown[]): AttemptsTakenBack {
  const errored = new Map<string, number>();
  const takenBack = new Map<string, number>();
  const unreplaced = new Set<string>();
  let lastReply = -1;
  entries.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const id = getString(entry, "id");
    const message = entry["message"];
    if (entry["type"] === "message" && isRecord(message) && message["role"] === "assistant") lastReply = index;
    if (id !== undefined && entry["type"] === "message" && isErroredAssistant(message)) errored.set(id, index);
    const target = getString(entry, "targetId");
    const at = target === undefined ? undefined : errored.get(target);
    if (entry["type"] === "context_edit" && entry["replacement"] === null && target !== undefined && at !== undefined) takenBack.set(target, at);
    if (isRetryUnreplacedEntry(entry)) {
      for (const attemptId of recordedAttemptIds(entry)) unreplaced.add(attemptId);
    }
  });
  return { takenBack, unreplaced, lastReply };
}

/**
 * The failed attempts pi took back that stay hidden (state-diagram D11). Owner, 2026-09-30:
 * "don't show the errors from before the retries have completely failed"; Q16, 2026-10-10: a
 * failure no retry replaced is the turn's outcome, a Stop during the wait included. So an attempt
 * is hidden while `pending` (the daemon's own word for a retry still to come), or once a newer
 * assistant reply follows it; one the daemon recorded as unreplaced, or with no newer reply after
 * it and nothing pending, shows.
 */
export function retriedAttemptIds(entries: readonly unknown[], pending: ReadonlySet<string> = NO_PENDING): Set<string> {
  const { takenBack, unreplaced, lastReply } = attemptsTakenBack(entries);
  const hidden = new Set<string>();
  for (const [id, at] of takenBack) {
    if (!unreplaced.has(id) && (pending.has(id) || lastReply > at)) hidden.add(id);
  }
  return hidden;
}

/** Attempts pi took back that no newer reply followed and no record names: with no retry under way, none will come. */
export function attemptsAwaitingRetry(entries: readonly unknown[]): string[] {
  const { takenBack, unreplaced, lastReply } = attemptsTakenBack(entries);
  return [...takenBack].filter(([id, at]) => !unreplaced.has(id) && lastReply <= at).map(([id]) => id);
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
  if (RENDERED_ENTRY_TYPES.has(entry["type"]) || isRefusedDialogEntry(entry) || isRetryUnreplacedEntry(entry)) return true;
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

/**
 * {@link branchMessages}, with each message's entry id beside it.
 *
 * `showsEntry` names the custom entry types the session's extensions registered a renderer for: pi
 * draws a custom entry only then, so only those become rows (`source: "entry"`). Without it (a
 * session read with no runtime) no extension entry is shown.
 */
export function branchTranscript(entries: Iterable<unknown>, showsEntry?: (customType: string) => boolean, pending: ReadonlySet<string> = NO_PENDING): TranscriptRow[] {
  const branch = [...entries];
  const retried = retriedAttemptIds(branch, pending);
  const stops = stopOutcomes(branch);
  const reasons = unreplacedReasonRows(branch);
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
      const reason = reasons.get(id);
      if (reason !== undefined) push(reason.entry, reason.message);
    }
    else if (entry["type"] === "thinking_level_change") {
      const level = getString(entry, "thinkingLevel");
      if (level !== undefined) thinkingLevel = level;
    }
    else if (entry["type"] === "custom_message" && entry["display"] === true) push(entry, { role: "custom", content: entry["content"], customType: entry["customType"], details: entry["details"] });
    else if (isRefusedDialogEntry(entry)) push(entry, refusedDialogMessage(getString(entry["data"], "reason") ?? "", getString(entry["data"], "at") ?? getString(entry, "timestamp")));
    else if (entry["type"] === "custom" && showsEntry !== undefined) pushShownEntry(entry, showsEntry, push);
    else if (entry["type"] === "compaction") push(entry, { role: "system", source: "compaction", content: `Compacted history:\n\n${stringValue(entry["summary"])}` });
    else if (entry["type"] === "branch_summary") push(entry, { role: "system", source: "branch_summary", content: `Branch summary:\n\n${stringValue(entry["summary"])}` });
  }
  return rows;
}

/** Each unreplaced record's row, by the attempt it is drawn after. */
function unreplacedReasonRows(branch: readonly unknown[]): Map<string, { entry: Record<string, unknown>; message: Record<string, unknown> }> {
  const rows = new Map<string, { entry: Record<string, unknown>; message: Record<string, unknown> }>();
  for (const entry of branch) {
    if (!isRecord(entry) || !isRetryUnreplacedEntry(entry)) continue;
    const row = retryUnreplacedRow(entry);
    if (row !== undefined) rows.set(row.attemptId, { entry, message: row.message });
  }
  return rows;
}

function pushShownEntry(entry: Record<string, unknown>, showsEntry: (customType: string) => boolean, push: (entry: Record<string, unknown>, message: unknown) => void): void {
  const customType = getString(entry, "customType");
  if (customType === undefined || !showsEntry(customType)) return;
  push(entry, customEntryRow(entry, customType));
}

/** The row a shown custom entry becomes; the live row and its history copy must be identical so they dedupe. */
export function customEntryRow(entry: unknown, customType: string): Record<string, unknown> {
  const timestamp = getString(entry, "timestamp");
  return { role: "custom", source: "entry", customType, details: isRecord(entry) ? entry["data"] : undefined, ...(timestamp === undefined ? {} : { timestamp }) };
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
