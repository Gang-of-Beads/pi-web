/**
 * The conversation held in a fork-context child's transcript.
 *
 * Two kinds of child write two different files. A fresh-context child gets a
 * run directory holding an ordinary session `jsonl`, which `branchMessages`
 * already reads. A fork-context child - which is what the builtin `worker` and
 * `oracle` agents are, so the common case - never creates that directory; the
 * subagent tool keeps its own event log in the shared artifacts directory
 * instead, under a name that merely looks like a transcript.
 *
 * The two were assumed to be the same file because of that name. They are not:
 * projected as a session branch, a real fork transcript of 254 entries yielded
 * zero messages, because these records carry no `type` and no session envelope.
 * This module adapts the event log; it deliberately does not widen the session
 * walk to accept both, because the difference is in the data, not in the view.
 *
 * Measured across the 43 fork transcripts on one machine, 8685 records:
 *
 *   recordType  message 4240 | tool_start 2222 | tool_end 2219 | stderr 4
 *   role        assistant 1938 | toolResult 2219 | user 83 (message records only)
 *
 * Every one of the 4244 `message` records carried a nested `message` object in
 * the session shape, so the conversation itself needs unwrapping rather than
 * rebuilding. The rest are the tool lifecycle, which the session shape already
 * expresses through the assistant's own tool calls and the results that follow:
 * `tool_start` and `tool_end` duplicate what those messages say, so they are
 * dropped rather than rendered twice. `stderr` has no equivalent - it is the
 * runner complaining, not the child speaking - so it is surfaced as a system
 * message instead of being discarded, because a conversation that quietly loses
 * content is worse than one that admits what it could not show.
 */

/** Record kinds seen in a fork-context transcript, in the order they matter here. */
const MESSAGE_RECORD = "message";
const STDERR_RECORD = "stderr";

/**
 * Whether this file is the subagent tool's event log rather than a session
 * file. A session entry names its kind in `type`; an event-log record names it
 * in `recordType`, and carries the `version` the tool stamps on every line.
 */
export function isSubagentEventLog(entries: readonly unknown[]): boolean {
  return entries.some((entry) => isRecord(entry) && typeof entry["recordType"] === "string");
}

/**
 * The conversation in a child run's transcript, whichever format wrote it.
 *
 * The caller reads a file and does not know which kind of child produced it,
 * so the records decide. Keeping the choice here rather than at the call site
 * means one place answers "what is this file", and it can be checked without a
 * live session.
 */
export function runTranscriptMessages(entries: readonly unknown[], readSessionBranch: (entries: readonly unknown[]) => unknown[]): unknown[] {
  return isSubagentEventLog(entries) ? subagentEventLogMessages(entries) : readSessionBranch(entries);
}

/**
 * Normalize a fork-context transcript into the messages the chat view renders.
 *
 * Returns the same shape `branchMessages` produces, so the caller pages and
 * projects one kind of list however the child was started.
 */
export function subagentEventLogMessages(entries: Iterable<unknown>): unknown[] {
  const messages: unknown[] = [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const recordType = entry["recordType"];
    if (recordType === MESSAGE_RECORD) {
      const message = entry["message"];
      // The nested object is the message as the model produced it. A record
      // without one would be a shape this module has not met; it carries a
      // flat `text` too, so the reader still sees what was said.
      if (isRecord(message)) messages.push(message);
      else if (typeof entry["text"] === "string" && entry["text"] !== "") messages.push({ role: roleOf(entry), content: entry["text"] });
      continue;
    }
    if (recordType === STDERR_RECORD) {
      const text = entry["text"];
      if (typeof text === "string" && text !== "") messages.push({ role: "system", source: "subagent_stderr", content: text });
    }
  }
  return messages;
}

function roleOf(entry: Record<string, unknown>): string {
  const role = entry["role"];
  return typeof role === "string" ? role : "assistant";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
