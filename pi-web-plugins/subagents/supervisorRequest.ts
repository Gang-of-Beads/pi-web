/**
 * What a subagent's supervisor message says, and what a person can do about it.
 *
 * These arrived in the transcript as "Unrecognized message": the shell has no
 * business knowing what a subagent run is, and nothing else claimed the tag.
 * The reply path is deliberately honest - a browser has no channel into a
 * child agent, so replying sends a message to this session, which owns the
 * supervisor tool, and the card says exactly that.
 */

export type SupervisorReason = "progress_update" | "question" | "blocked" | "contact" | "unknown";

export interface SupervisorRequest {
  requestId: string | undefined;
  runId: string | undefined;
  agent: string | undefined;
  childTarget: string | undefined;
  reason: SupervisorReason;
  expectsReply: boolean;
}

const REASONS: Record<string, SupervisorReason> = {
  progress_update: "progress_update",
  question: "question",
  blocked: "blocked",
  contact: "contact",
};

const REASON_LABEL: Record<SupervisorReason, string> = {
  progress_update: "Progress update",
  question: "Question",
  blocked: "Blocked",
  contact: "Contact",
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
