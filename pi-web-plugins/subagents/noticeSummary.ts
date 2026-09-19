/**
 * The one line a subagent notice shows. These messages are addressed to the
 * agent, but they are displayed, so a reader is entitled to know which run
 * they came from rather than reading "Unrecognized message".
 */

export interface NoticeSummary {
  title: string;
  detail: string | undefined;
}

const TITLES: Record<string, string> = {
  "subagent-notify": "Subagent finished",
  "subagent-incremental-child-notify": "Subagent progress",
  "subagent_control_notice": "Subagent control",
  "subagent_steering_notice": "Subagent steering",
  "subagent_supervisor_reply": "Reply to a subagent",
  "subagent-compaction-resume": "Subagent resumed after compaction",
};

function readString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value: unknown = Reflect.get(payload, key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function noticeSummary(tag: string, payload: unknown): NoticeSummary {
  const agent = readString(payload, "agent");
  const runId = readString(payload, "runId");
  const status = readString(payload, "status");
  const parts = [agent, status, runId === undefined ? undefined : `run ${runId}`].filter((part): part is string => part !== undefined);
  return {
    title: TITLES[tag] ?? "Subagent message",
    detail: parts.length === 0 ? undefined : parts.join(" · "),
  };
}
