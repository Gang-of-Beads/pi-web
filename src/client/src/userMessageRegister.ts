import type { ChatLine } from "./components/shared.js";
import type { QueuedSessionMessage } from "./api.js";

/**
 * One user message, one row.
 *
 * A message the user sent used to be drawn from four independent places: the
 * bubble the browser draws on send, the daemon's echo, a row synthesised from
 * the status queue, and finally the transcript entry. Each place decided for
 * itself whether it was looking at a message somebody else had already drawn,
 * so agreement between them was what produced a single row - and any
 * disagreement produced two. A duplicate was the default outcome, held off by
 * matching, and improving the matching is what has been done ten times.
 *
 * Here the sources contribute *facts about a message*, never a row. Rows come
 * out of one map keyed by identity, so two rows for one message cannot be
 * constructed: the second write finds the first and updates it.
 *
 * Identity is the id the browser minted when it sent, and for anything it did
 * not send - another browser, the CLI, a subagent - the transcript's own entry
 * key. Text is never an identity. Text is what the runtime rewrites when it
 * expands a slash command, what an attachment-only message does not have, and
 * what every previous fix was eventually defeated by.
 */

/** Where a message currently is, as a property of its row rather than a row. */
export type UserMessageState = "sending" | "queued" | "settled";

export interface UserMessageRow {
  /** Stable key. Never text. */
  identity: string;
  state: UserMessageState;
  /** The line to render. The newest contribution wins for the same identity. */
  line: ChatLine;
  /** Where in the transcript this belongs, for ordering. Absent while pending. */
  transcriptIndex?: number;
}

interface RegisterInput {
  /** Settled transcript lines, in transcript order. */
  transcript: readonly ChatLine[];
  /** What the browser has sent and not yet seen settle. */
  optimistic: readonly ChatLine[];
  /** What the daemon reports as queued, with whatever identity survived. */
  queued: readonly QueuedSessionMessage[];
  /** Builds a row for a queued entry the browser has no bubble for. */
  synthesise: (message: QueuedSessionMessage, position: number) => ChatLine;
}

function identityOf(line: ChatLine, fallbackIndex: number): string {
  const minted = line.meta?.delivery?.clientMessageId;
  if (minted !== undefined && minted !== "") return minted;
  // A message this browser did not send is keyed by where it sits in the
  // transcript, which is stable for a settled entry and unique by construction.
  return `transcript:${String(fallbackIndex)}`;
}

/**
 * Collect every source into one row per message.
 *
 * Order of contribution is deliberate. The transcript is written first because
 * it holds the lines themselves, including the optimistic bubbles this browser
 * added to it. The queue is written last because the queue is what decides
 * whether a message is still waiting: a line sitting in the transcript that the
 * daemon still reports as queued has not been delivered, and drawing it as
 * settled is what put one message in two places at once.
 */
export function registerUserMessages(input: RegisterInput): UserMessageRow[] {
  const rows = new Map<string, UserMessageRow>();

  for (const [index, line] of input.transcript.entries()) {
    const identity = identityOf(line, index);
    rows.set(identity, { identity, state: "settled", line, transcriptIndex: index });
  }

  for (const [index, line] of input.optimistic.entries()) {
    const identity = identityOf(line, index);
    const existing = rows.get(identity);
    if (existing === undefined) rows.set(identity, { identity, state: "sending", line });
  }

  for (const [position, message] of input.queued.entries()) {
    const id = message.clientMessageId;
    // An entry with no identity cannot be matched to a line, so it gets a key
    // of its own rather than being guessed onto somebody else's row. It is
    // still one row: a key nobody else uses cannot collide.
    const identity = id !== undefined && id !== "" ? id : `queued:${message.kind}:${String(position)}`;
    const existing = rows.get(identity);
    // The line already in hand is kept: it carries attachments and the recall
    // affordance that a synthesised stand-in does not have. Only the state
    // moves, because the queue is the authority on what is still waiting.
    rows.set(identity, existing === undefined
      ? { identity, state: "queued", line: input.synthesise(message, position) }
      : { identity, state: "queued", line: existing.line });
  }

  return [...rows.values()];
}

/**
 * A row for a queued entry the browser has no line for - one queued from
 * another client, the CLI, or a subagent.
 *
 * The synthetic key deliberately contains no text. A key built from text gives
 * one message two identities the moment the runtime rewrites it, which is the
 * fault this module exists to end; the position within the reported queue is
 * stable for as long as the entry is in it, and an entry that leaves takes its
 * row with it.
 */
export function queuedUserLine(message: QueuedSessionMessage, position: number): ChatLine {
  const clientMessageId = message.clientMessageId ?? `queued:${message.kind}:${String(position)}`;
  return { role: "user", parts: [{ type: "text", text: message.text }], meta: { delivery: { clientMessageId, state: "queued", kind: message.kind } } };
}
