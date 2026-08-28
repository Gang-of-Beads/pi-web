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

/** Whether the transcript renders this entry, and so whether it is counted. */
export function isReadableBranchEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  if (entry["type"] === "message") return true;
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
  const messages: unknown[] = [];
  let thinkingLevel: string | undefined;
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    if (entry["type"] === "message") messages.push(annotateAssistantThinkingLevel(entry["message"], thinkingLevel));
    else if (entry["type"] === "thinking_level_change") {
      const level = getString(entry, "thinkingLevel");
      if (level !== undefined) thinkingLevel = level;
    }
    else if (entry["type"] === "custom_message" && entry["display"] === true) messages.push({ role: "custom", content: entry["content"], customType: entry["customType"], details: entry["details"] });
    else if (entry["type"] === "compaction") messages.push({ role: "system", source: "compaction", content: `Compacted history:\n\n${stringValue(entry["summary"])}` });
    else if (entry["type"] === "branch_summary") messages.push({ role: "system", source: "branch_summary", content: `Branch summary:\n\n${stringValue(entry["summary"])}` });
  }
  return messages;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown, key: string): string | undefined {
  const property = isRecord(value) ? value[key] : undefined;
  return typeof property === "string" ? property : undefined;
}
