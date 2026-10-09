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
  return `${replyPrefix(request)}${text.trim()}`;
}

/**
 * How a reply to this request begins. It names the request when the child gave it an id: two
 * requests from one run otherwise shared a prefix, so the agent could not tell which one a
 * reply answered, and a reply to the later request marked the earlier card answered.
 */
function replyPrefix(request: SupervisorRequest): string {
  const target = request.childTarget ?? request.agent ?? "the subagent";
  const about = [
    ...(request.runId === undefined ? [] : [`run ${request.runId}`]),
    ...(request.requestId === undefined ? [] : [`request ${request.requestId}`]),
  ];
  return `Reply to ${target}${about.length === 0 ? "" : ` (${about.join(", ")})`}: `;
}

/** The entry pi-subagents journals when a reply reaches the child (`appendSupervisorReplyEntry`). */
const REPLY_ENTRY_TAG = "subagent_supervisor_reply";

/**
 * The reply pi-subagents delivered to the child for this request: its own journal entry of it,
 * matched by request id, whoever wrote the reply (this card, or the reader in the composer). A
 * record whose message cannot be read is still a delivery, with no text. A request without an id
 * cannot be matched to a record, so it is never known delivered and stays asked or open.
 */
export function deliveredReply(request: SupervisorRequest, followingRows: readonly { readonly tag: string; readonly payload: unknown }[]): { readonly text: string } | undefined {
  if (request.requestId === undefined) return undefined;
  const entry = followingRows.find((row) => row.tag === REPLY_ENTRY_TAG && readString(row.payload, "requestId") === request.requestId);
  return entry === undefined ? undefined : { text: readString(entry.payload, "message") ?? "" };
}

/** A reply's states on the card: delivered, asked of the agent, open (the form), or not expected. */
export type ReplyKind = "delivered" | "asked" | "open" | "not-expected";

/** `text` is the reply, for a delivered or asked one; empty otherwise. */
export interface ReplyStanding {
  readonly kind: ReplyKind;
  readonly text: string;
}

/**
 * Where a reply to this request stands, as the card shows it: delivered to the child (pi-subagents'
 * record), else asked of the agent (the reader's message to this session, which the agent relays and
 * pi-subagents records once it does), else open; or not expected.
 */
export function replyStanding(request: SupervisorRequest, followingRows: readonly { readonly tag: string; readonly payload: unknown }[], followingUserTexts: readonly string[]): ReplyStanding {
  if (!offersReply(request)) return { kind: "not-expected", text: "" };
  const delivered = deliveredReply(request, followingRows);
  if (delivered !== undefined) return { kind: "delivered", text: delivered.text };
  const asked = answeredReply(request, followingUserTexts);
  return asked === undefined ? { kind: "open", text: "" } : { kind: "asked", text: asked };
}

/**
 * The reply the reader asked this session to relay for this request, found in what they said after
 * it: the first later message written the way `replyMessage` writes one for this request. It means
 * asked, not delivered: the agent relays it, and pi-subagents' own record (`deliveredReply`) says when
 * it reached the child. Read from the transcript, so a reload or a session switch keeps it.
 */
export function answeredReply(request: SupervisorRequest, followingUserTexts: readonly string[]): string | undefined {
  if (!offersReply(request)) return undefined;
  const prefix = replyPrefix(request);
  const reply = followingUserTexts.find((text) => text.startsWith(prefix) && text.length > prefix.length);
  return reply?.slice(prefix.length);
}
