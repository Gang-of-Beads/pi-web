import type { PromptAttachment, QueuedSessionMessage } from "./api";
import type { ChatLine, ChatPart, MessageDeliveryState } from "./components/shared";
import type { DeliveryFailureCause } from "./deliveryWords";

/**
 * Delivery marks for messages this browser sent.
 *
 * A prompt used to vanish into an ambiguous middle state: the composer cleared
 * immediately, the transcript showed the text, and the same text also sat in
 * the "Queued messages" list - two renderings of one message, with nothing
 * saying whether the server had it. The message carries a correlation id now,
 * so every stage is a state on the bubble itself:
 *
 *   sending   the request is in flight, nothing is confirmed
 *   received  the server accepted it (single mark)
 *   queued    the agent is busy and will take it as a steer/follow-up
 *   delivered the agent has taken it into the turn (double mark)
 *   failed    the request never reached the server; the text is recoverable
 *
 * Every function here is pure so the state machine can be tested without a
 * session, a socket, or a server.
 */

/**
 * Mint a correlation id. `crypto.randomUUID` is only exposed on secure origins,
 * and pi-web is routinely served over plain http on a LAN address, so the
 * fallback is the normal path there rather than an edge case.
 */
export function newClientMessageId(): string {
  const webCrypto: Partial<Crypto> | undefined = globalThis.crypto;
  const uuid = webCrypto.randomUUID?.();
  if (uuid !== undefined) return uuid;
  return `cm-${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The bubble shown the instant the user hits send, before any round trip. Its time is the send
 * time the message keeps everywhere (B5): the daemon takes it with the message and stamps it on
 * the committed copy, so the row never switches to the time a turn took it.
 */
export function optimisticUserLine(text: string, clientMessageId: string, attachments: readonly PromptAttachment[] = [], sentAt = new Date().toISOString()): ChatLine {
  // The images travel with the bubble because nothing else will carry them: the
  // session's queue keeps only the text of a pending message, so a queued
  // prompt that was mostly a screenshot showed up as an empty-looking line.
  const images = attachments
    .filter((attachment) => attachment.kind === "image")
    .map((attachment): ChatPart => ({ type: "image", mimeType: attachment.mimeType, data: attachment.data }));
  const parts: ChatPart[] = text === "" ? [...images] : [{ type: "text", text }, ...images];
  return { role: "user", parts, meta: { timestamp: sentAt, delivery: { clientMessageId, state: "sending" } } };
}

/**
 * The transcript with every pending message at its tail, in the order the
 * server will send them.
 *
 * Pending messages reach the browser two ways: one this browser sent has an
 * optimistic bubble in place, and one queued anywhere else has only the
 * server's queue entry. Drawing the first in the transcript and the second in
 * a panel below it put a message sent seconds ago above one queued minutes
 * earlier. Both are drawn in the transcript now, ordered by the queue - which
 * is the order they will actually be delivered in.
 *
 * Keeping them in the transcript rather than a pinned panel is deliberate:
 * 1.202608.5-.7 tried the panel and it covered the conversation on a phone.
 */
/** The agent has taken it: there is nothing left to report. */
export function deliveryTaken(state: MessageDeliveryState): boolean {
  return state === "delivered";
}

/** The agent has taken it, or it never arrived: nothing more will happen. */
export function deliverySettled(state: MessageDeliveryState): boolean {
  return state === "delivered" || state === "failed";
}

/** Sent, or waiting to be: the agent has not taken it yet. */
export function deliveryWaiting(state: MessageDeliveryState): boolean {
  return !deliverySettled(state);
}

/** Settled messages, and the ones the agent has not started. */
export function splitTranscriptAndPending(messages: readonly ChatLine[], queued: readonly QueuedSessionMessage[]): { settled: ChatLine[]; pending: ChatLine[] } {
  if (queued.length === 0) return { settled: [...messages], pending: [] };
  const bubbles = new Map<string, ChatLine>();
  const unclaimed: ChatLine[] = [];
  for (const line of messages) {
    const delivery = line.meta?.delivery;
    if (delivery === undefined) continue;
    // The server can still hold a message it has already echoed back, so the id
    // claims it whatever the mark says.
    bubbles.set(delivery.clientMessageId, line);
    if (deliveryWaiting(delivery.state)) unclaimed.push(line);
  }
  const pending: ChatLine[] = [];
  for (const message of queued) {
    const byId = message.clientMessageId === undefined ? undefined : bubbles.get(message.clientMessageId);
    // Claimed, not matched: two identical messages stay two. An empty text is
    // never matched on - a message whose payload is an attachment carries no
    // words, and one empty string matches every other, which claimed the wrong
    // bubble and left a duplicate for the right one.
    const byWords = byId ?? (message.text === ""
      ? undefined
      : unclaimed.find((line) => line.meta?.delivery?.kind === message.kind && chatLineText(line) === message.text));
    if (byWords !== undefined) unclaimed.splice(unclaimed.indexOf(byWords), 1);
    pending.push(byWords ?? queuedUserLine(message));
  }
  const moved = new Set(pending);
  return { settled: messages.filter((line) => !moved.has(line)), pending };
}

/** The words of a bubble, for matching a queue entry that carries no id. */
function chatLineText(line: ChatLine): string {
  return line.parts.filter((part) => part.type === "text").map((part) => part.text).join("");
}

/**
 * A queued message with no bubble here, drawn like one. It carries the queue's
 * own kind so the mark reads the same as a locally sent message's.
 */
function queuedUserLine(message: QueuedSessionMessage): ChatLine {
  const clientMessageId = message.clientMessageId ?? `queued:${message.kind}:${message.text}`;
  return { role: "user", parts: [{ type: "text", text: message.text }], meta: { delivery: { clientMessageId, state: "queued", kind: message.kind } } };
}

/** The time a tracked bubble shows, which is the time its message is sent with. */
export function deliveryLineSentAt(messages: readonly ChatLine[], clientMessageId: string): string | undefined {
  return messages[findDeliveryLineIndex(messages, clientMessageId)]?.meta?.timestamp;
}

export function findDeliveryLineIndex(messages: readonly ChatLine[], clientMessageId: string): number {
  return messages.findIndex((line) => line.meta?.delivery?.clientMessageId === clientMessageId);
}

/**
 * Advance one message's delivery state. Never moves backwards: a status update
 * that arrives after the queue drained must not pull a delivered message back
 * to "queued", and a slow HTTP resolution must not undo a delivery the event
 * stream already reported.
 */
export function markDelivery(
  messages: ChatLine[],
  clientMessageId: string,
  state: MessageDeliveryState,
  kind?: "steer" | "followUp",
): ChatLine[] {
  const index = findDeliveryLineIndex(messages, clientMessageId);
  if (index === -1) return messages;
  const line = messages[index];
  const current = line?.meta?.delivery;
  if (line === undefined || current === undefined) return messages;
  if (!advancesDelivery(current.state, state) && !kindChanged(current.kind, kind, current.state, state)) return messages;
  const next = [...messages];
  const nextState = advancesDelivery(current.state, state) ? state : current.state;
  const nextKind = kind ?? current.kind;
  next[index] = {
    ...line,
    meta: { ...line.meta, delivery: { clientMessageId, state: nextState, ...(nextKind === undefined ? {} : { kind: nextKind }) } },
  };
  return next;
}

/**
 * Mark a row failed and record why, so it reads "Not sent" or "Not received" (deliveryWords.ts).
 * A row that stays where it is keeps its words: `markDelivery` decides whether a failure may land,
 * and a later fact that overturns it rebuilds the delivery without a cause.
 */
export function markDeliveryFailed(messages: ChatLine[], clientMessageId: string, cause: DeliveryFailureCause): ChatLine[] {
  const marked = markDelivery(messages, clientMessageId, "failed");
  const index = findDeliveryLineIndex(marked, clientMessageId);
  const line = marked[index];
  const delivery = line?.meta?.delivery;
  if (line === undefined || delivery?.state !== "failed" || delivery.cause === cause) return marked;
  const next = [...marked];
  next[index] = { ...line, meta: { ...line.meta, delivery: { ...delivery, cause } } };
  return next;
}

/** A queued message can change lane (follow-up promoted to steer) without changing state. */
function kindChanged(current: "steer" | "followUp" | undefined, next: "steer" | "followUp" | undefined, currentState: MessageDeliveryState, nextState: MessageDeliveryState): boolean {
  return next !== undefined && next !== current && currentState === "queued" && nextState === "queued";
}

/**
 * Unverifiable sits beside sending, not below failed: the message may be
 * anywhere between "never left" and "already running", so a real answer from
 * the server - received, queued, delivered - must still be able to overtake it.
 */
const DELIVERY_ORDER: Record<MessageDeliveryState, number> = { failed: -1, unverifiable: 0, sending: 0, received: 1, queued: 2, delivered: 3 };

/**
 * What a failed row still moves to: a server fact about the same message - the daemon has it,
 * its queue holds it, the transcript holds it. A failure is often an inference (no ledger row by
 * the last ask, a link that dropped); a later fact about the same identity proves it wrong, and
 * one message keeps one identity for its whole life, retries included. Deliberate retries go
 * through `restartDelivery`, which takes the row back to sending.
 */
const OUTRANKS_A_FAILURE: Readonly<Record<MessageDeliveryState, boolean>> = {
  received: true,
  queued: true,
  delivered: true,
  sending: false,
  unverifiable: false,
  failed: false,
};

function advancesDelivery(current: MessageDeliveryState, next: MessageDeliveryState): boolean {
  if (current === next) return false;
  // A failure can interrupt any earlier state; nothing overturns "delivered".
  if (next === "failed") return current !== "delivered";
  // An answer that arrives late closes an unverifiable row; that is the whole
  // point of keeping it open rather than calling it failed.
  if (current === "unverifiable") return next !== "sending";
  if (next === "unverifiable") return current === "sending";
  if (current === "failed") return OUTRANKS_A_FAILURE[next];
  return DELIVERY_ORDER[next] > DELIVERY_ORDER[current];
}

/**
 * Send a failed bubble back to in-flight for a deliberate retry.
 *
 * `markDelivery` never leaves "failed", because a late success event must not
 * resurrect a message the user was told to retry. A retry is not a late event:
 * the outbox is acting on the message again, so the bubble goes through
 * sending/received itself rather than being jumped to a result.
 */
/**
 * Which rows a deliberate retry sends back to "sending". A failed send and one whose answer
 * never came are both replayed from the outbox under their identity, and both must show the
 * attempt: a row left reading "No answer yet" while its retry is in flight still offered
 * Discard for a request that could land a moment later.
 */
const RESTARTABLE: Record<MessageDeliveryState, boolean> = {
  failed: true,
  unverifiable: true,
  sending: false,
  received: false,
  queued: false,
  delivered: false,
};

export function restartDelivery(messages: readonly ChatLine[], clientMessageId: string): ChatLine[] {
  const index = findDeliveryLineIndex(messages, clientMessageId);
  if (index === -1) return [...messages];
  const line = messages[index];
  const current = line?.meta?.delivery;
  if (line === undefined || current === undefined || !RESTARTABLE[current.state]) return [...messages];
  const next = [...messages];
  next[index] = {
    ...line,
    meta: { ...line.meta, delivery: { clientMessageId, state: "sending", ...(current.kind === undefined ? {} : { kind: current.kind }) } },
  };
  return next;
}

/**
 * Which delivery states a server fact has proved: the daemon answered for it, its queue holds
 * it, or the transcript does. A local answer - a refused or ambiguous HTTP reply - cannot
 * delete such a row: the fact outranks the answer, and deleting it handed the words back for
 * a second send under a new identity the ledger could not dedupe.
 */
const PROVEN_BY_SERVER: Readonly<Record<MessageDeliveryState, boolean>> = {
  sending: false,
  failed: false,
  unverifiable: false,
  received: true,
  queued: true,
  delivered: true,
};

/** Whether a server fact already proved this message's row, which no local answer overturns. */
export function deliveryProvenByServer(messages: readonly ChatLine[], clientMessageId: string): boolean {
  const state = messages[findDeliveryLineIndex(messages, clientMessageId)]?.meta?.delivery?.state;
  return state !== undefined && PROVEN_BY_SERVER[state];
}

/**
 * Drop the optimistic bubble of a send the client itself learned was refused. Only a row no
 * server fact has proved goes; a message the daemon has taken back leaves through
 * `withdrawDeliveryLine`, on the daemon's word.
 */
export function removeDeliveryLine(messages: readonly ChatLine[], clientMessageId: string): ChatLine[] {
  const index = findDeliveryLineIndex(messages, clientMessageId);
  if (index === -1 || deliveryProvenByServer(messages, clientMessageId)) return [...messages];
  return [...messages.slice(0, index), ...messages.slice(index + 1)];
}

/**
 * Which delivery states the reader may throw away from the row itself.
 *
 * One message has one row (docs/design/one-message-one-row.md), so the row carries every
 * action its state allows. Only a settled failure can be discarded here, and discarding
 * hands the words back to the composer: a send still in flight lands regardless of a local
 * delete, so offering Discard there would claim an outcome the request can overturn a
 * moment later. A message the daemon holds is recalled instead, and one the transcript
 * holds is history.
 */
const DISCARD_LABELS: Record<MessageDeliveryState, string | undefined> = {
  failed: "Discard: take this unsent message back into the composer",
  unverifiable: "Discard: stop tracking this here and take the text back - it may already have arrived",
  sending: undefined,
  received: undefined,
  queued: undefined,
  delivered: undefined,
};

export interface DiscardAction {
  readonly clientMessageId: string;
  readonly label: string;
}

export function discardAction(line: Pick<ChatLine, "meta">): DiscardAction | undefined {
  const delivery = line.meta?.delivery;
  const label = delivery === undefined ? undefined : DISCARD_LABELS[delivery.state];
  if (delivery === undefined || label === undefined) return undefined;
  return { clientMessageId: delivery.clientMessageId, label };
}

/**
 * Which states offer Retry on the row: a send whose answer never came and one the daemon
 * says it never received. The outbox keeps both under their identity, so a replay is
 * deduplicated rather than doubled.
 */
const RETRYABLE: Record<MessageDeliveryState, boolean> = {
  unverifiable: true,
  sending: false,
  failed: true,
  received: false,
  queued: false,
  delivered: false,
};

export function retryableDeliveryId(line: Pick<ChatLine, "meta">): string | undefined {
  const delivery = line.meta?.delivery;
  if (delivery === undefined || !RETRYABLE[delivery.state]) return undefined;
  return delivery.clientMessageId;
}

/** Identities that already have a row in this transcript, so no other surface draws them. */
export function rowedClientMessageIds(messages: readonly ChatLine[], queued: readonly QueuedSessionMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const line of messages) {
    const id = line.meta?.delivery?.clientMessageId ?? line.meta?.clientMessageId ?? (line.meta?.echo === true ? line.meta.echoClientMessageId : undefined);
    if (id !== undefined) ids.add(id);
  }
  for (const entry of queued) {
    if (entry.clientMessageId !== undefined) ids.add(entry.clientMessageId);
  }
  return ids;
}

/**
 * Remove the withdrawn message's lines - and only those. Recall, Stop and the daemon's
 * withdrawal frame all end here: the daemon says the message left its queue, and the text
 * goes back to the composer, where an unsent message belongs.
 *
 * A delivered line is the transcript's, not the queue's: a withdrawal frame
 * that raced the drain must not delete a row the conversation already
 * contains. The echo copy is the only form another device holds while the
 * message waits, so it is matched by its own carried identity.
 */
export function withdrawDeliveryLine(messages: readonly ChatLine[], clientMessageId: string): ChatLine[] {
  return messages.filter((line) => {
    const delivery = line.meta?.delivery;
    if (delivery?.clientMessageId === clientMessageId && !deliveryTaken(delivery.state)) return false;
    if (line.meta?.echo === true && line.meta.echoClientMessageId === clientMessageId) return false;
    return true;
  });
}

/**
 * Follow the daemon's queue. A row the queue holds is queued; a queued row an idle session no
 * longer holds is received - the daemon has it - but not read: absence from a queue is an
 * inference, and the committed copy in the transcript is the fact (`carryDeliveryForward`).
 */
export function applyQueueToDelivery(messages: ChatLine[], queued: readonly QueuedSessionMessage[], runtimeIdle = false): ChatLine[] {
  let next = messages;
  const queuedIds = new Map<string, "steer" | "followUp">();
  for (const message of queued) {
    if (message.clientMessageId !== undefined) queuedIds.set(message.clientMessageId, message.kind);
  }
  for (const line of messages) {
    const delivery = line.meta?.delivery;
    if (delivery === undefined) continue;
    const kind = queuedIds.get(delivery.clientMessageId);
    if (kind !== undefined) {
      next = markDelivery(next, delivery.clientMessageId, "queued", kind);
      continue;
    }
    if (runtimeIdle && delivery.state === "queued") next = leaveQueue(next, delivery.clientMessageId);
  }
  return next;
}

/**
 * The one step back the delivery order allows: a row the queue stopped holding is received
 * again, not read. `markDelivery` only moves forward, which is right for every answer and
 * frame - this is not an answer but the retraction of the queue's own claim.
 */
function leaveQueue(messages: ChatLine[], clientMessageId: string): ChatLine[] {
  const index = findDeliveryLineIndex(messages, clientMessageId);
  const line = messages[index];
  const delivery = line?.meta?.delivery;
  if (line === undefined || delivery?.state !== "queued") return messages;
  const next = [...messages];
  next[index] = { ...line, meta: { ...line.meta, delivery: { ...delivery, state: "received" } } };
  return next;
}

/**
 * Reconcile a server echo (or the agent's own committed copy) with the bubble
 * the sender already has. Returns the transcript unchanged when the echo is for
 * a tracked message, so one send stays one bubble.
 */
export function isEchoOfTrackedMessage(messages: readonly ChatLine[], clientMessageId: string | undefined): boolean {
  return clientMessageId !== undefined && findDeliveryLineIndex(messages, clientMessageId) !== -1;
}

/**
 * Carry a bubble's delivery state onto the agent's finalized copy of the same
 * message.
 *
 * When a turn takes a message, pi emits the committed version and the
 * transcript swaps the rendered line for it. Swapping blindly dropped the mark
 * the sender was watching, so the message silently lost its state at the exact
 * moment it reached the model. The committed copy *is* the proof of delivery,
 * so the state moves to delivered rather than merely surviving.
 */
export function carryDeliveryForward(previous: ChatLine, finalized: ChatLine): ChatLine {
  const delivery = previous.meta?.delivery;
  if (delivery === undefined) return finalized;
  return {
    ...finalized,
    meta: { ...finalized.meta, delivery: { ...delivery, state: "delivered" } },
  };
}

/** Index of a tracked user bubble with this exact text, or -1. */
export function findTrackedUserLineIndex(messages: readonly ChatLine[], text: string): number {
  if (text === "") return -1;
  return messages.findIndex((line) => line.role === "user" && line.meta?.delivery !== undefined && lineText(line) === text);
}

function lineText(line: ChatLine): string {
  return line.parts
    .filter((part): part is Extract<ChatLine["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}
