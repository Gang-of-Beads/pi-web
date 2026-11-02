import { isRecord } from "../../../shared/unknownValues.js";

/**
 * pi's words before the cause, by what started the compaction (`AgentSession.compact`,
 * `_runAutoCompaction` and `_checkCompaction`, pi-coding-agent 1.4); the row names what failed
 * itself.
 */
const TRIGGER_LEAD_INS: Readonly<Record<string, string>> = {
  manual: "Compaction failed: ",
  threshold: "Auto-compaction failed: ",
  overflow: "Context overflow recovery failed: ",
};

/** The summary step's own lead-ins inside them (`generateSummary`, `generateTurnPrefixSummary`). */
const SUMMARY_LEAD_INS: readonly string[] = ["Summarization failed: ", "Turn prefix summarization failed: "];

/**
 * pi's reason for a compaction that failed, read from its `compaction_end` (D13); undefined for
 * any other event and for a compaction that succeeded or was stopped. pi sets `errorMessage`
 * exactly when a compaction failed without being stopped, also when it refuses to compact again
 * after one compact-and-retry, as its own terminal shows. A lead-in pi words differently stays in
 * the reason; an empty one is the empty string.
 */
export function compactionFailureReason(event: unknown): string | undefined {
  if (!isRecord(event) || event["type"] !== "compaction_end" || event["aborted"] === true) return undefined;
  const trigger = event["reason"];
  const message = event["errorMessage"];
  if (typeof trigger !== "string" || !Object.hasOwn(TRIGGER_LEAD_INS, trigger) || typeof message !== "string" || message === "") return undefined;
  return withoutLeadIn(withoutLeadIn(message, [TRIGGER_LEAD_INS[trigger] ?? ""]), SUMMARY_LEAD_INS);
}

function withoutLeadIn(text: string, leadIns: readonly string[]): string {
  const leadIn = leadIns.find((candidate) => candidate !== "" && text.startsWith(candidate));
  return (leadIn === undefined ? text : text.slice(leadIn.length)).trim();
}
