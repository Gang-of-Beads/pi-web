/**
 * What a subagent's supervisor message says, and what a person can do about it.
 *
 * These arrived in the transcript as "Unrecognized message": the shell has no
 * business knowing what a subagent run is, and nothing else claimed the tag.
 * The reply path is deliberately honest - a browser has no channel into a
 * child agent, so replying sends a message to this session, which owns the
 * supervisor tool, and the card says exactly that.
 */

/**
 * The reasons pi-subagents' contact_supervisor tool sends (native-supervisor-channel.ts:
 * need_decision, interview_request, progress_update). The table once held invented reasons,
 * so every decision request rendered as a generic "Message" with its question missing.
 */
export type SupervisorReason = "need_decision" | "interview_request" | "progress_update" | "unknown";

export interface SupervisorRequest {
  requestId: string | undefined;
  runId: string | undefined;
  agent: string | undefined;
  childTarget: string | undefined;
  reason: SupervisorReason;
  expectsReply: boolean;
  /** What the child actually asked or reported: the reason a person opens the card. */
  body: string | undefined;
}

const REASONS: Record<string, SupervisorReason> = {
  need_decision: "need_decision",
  interview_request: "interview_request",
  progress_update: "progress_update",
};

const REASON_LABEL: Record<SupervisorReason, string> = {
  need_decision: "Decision request",
  interview_request: "Interview request",
  progress_update: "Progress update",
  unknown: "Message",
};

function readString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value: unknown = Reflect.get(payload, key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function supervisorRequest(payload: unknown): SupervisorRequest {
  const expects: unknown = typeof payload === "object" && payload !== null ? Reflect.get(payload, "expectsReply") : undefined;
  return {
    requestId: readString(payload, "requestId") ?? readString(payload, "id"),
    runId: readString(payload, "runId"),
    agent: readString(payload, "agent"),
    childTarget: readString(payload, "childTarget"),
    reason: REASONS[readString(payload, "reason") ?? ""] ?? "unknown",
    expectsReply: expects === true,
    body: readString(payload, "requestBody") ?? readString(payload, "message"),
  };
}

export function supervisorTitle(request: SupervisorRequest): string {
  const who = request.agent ?? "a subagent";
  return `${REASON_LABEL[request.reason]} from ${who}`;
}

/** Whether the card offers a reply box: only a request that says it waits for one. */
export function offersReply(request: SupervisorRequest): boolean {
  return request.expectsReply;
}

/**
 * The message the session receives. It names the child and the request so the
 * agent relays it to the right run rather than guessing from context.
 */
export function replyMessage(request: SupervisorRequest, text: string): string {
  const trimmed = text.trim();
  const target = request.childTarget ?? request.agent ?? "the subagent";
  const run = request.runId === undefined ? "" : ` (run ${request.runId})`;
  return `Reply to ${target}${run}: ${trimmed}`;
}
