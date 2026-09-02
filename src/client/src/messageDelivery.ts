import type { PromptAttachment, QueuedSessionMessage } from "./api";
import type { ChatLine, ChatPart, MessageDeliveryState } from "./components/shared";

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

/** The bubble shown the instant the user hits send, before any round trip. */
export function optimisticUserLine(text: string, clientMessageId: string, attachments: readonly PromptAttachment[] = []): ChatLine {
  // The images travel with the bubble because nothing else will carry them: the
  // session's queue keeps only the text of a pending message, so a queued
  // prompt that was mostly a screenshot showed up as an empty-looking line.
  const images = attachments
    .filter((attachment) => attachment.kind === "image")
    .map((attachment): ChatPart => ({ type: "image", mimeType: attachment.mimeType, data: attachment.data }));
  const parts: ChatPart[] = text === "" ? [...images] : [{ type: "text", text }, ...images];
  return { role: "user", parts, meta: { timestamp: new Date().toISOString(), delivery: { clientMessageId, state: "sending" } } };
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

/** A queued message can change lane (follow-up promoted to steer) without changing state. */
function kindChanged(current: "steer" | "followUp" | undefined, next: "steer" | "followUp" | undefined, currentState: MessageDeliveryState, nextState: MessageDeliveryState): boolean {
  return next !== undefined && next !== current && currentState === "queued" && nextState === "queued";
}

const DELIVERY_ORDER: Record<MessageDeliveryState, number> = { failed: -1, sending: 0, received: 1, queued: 2, delivered: 3 };

function advancesDelivery(current: MessageDeliveryState, next: MessageDeliveryState): boolean {
  if (current === next) return false;
  // A failure is terminal for the attempt and can interrupt any earlier state,
  // but a late success event must not resurrect a message the user was told to
  // retry, and nothing recovers from "delivered".
  if (next === "failed") return current !== "delivered";
  // Deliberate retries go through restartDelivery, which takes the bubble back
  // to sending; a late event still cannot resurrect a failed message.
  if (current === "failed") return false;
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
export function restartDelivery(messages: readonly ChatLine[], clientMessageId: string): ChatLine[] {
  const index = findDeliveryLineIndex(messages, clientMessageId);
  if (index === -1) return [...messages];
  const line = messages[index];
  if (line?.meta?.delivery?.state !== "failed") return [...messages];
  const current = line.meta.delivery;
  const next = [...messages];
  next[index] = {
    ...line,
    meta: { ...line.meta, delivery: { clientMessageId, state: "sending", ...(current.kind === undefined ? {} : { kind: current.kind }) } },
  };
  return next;
}

/**
 * Drop the optimistic bubble for a message that was pulled back out of the
 * queue. It has to go rather than change state: the bubble says "the server has
 * this and the agent will take it next", which stopped being true, and a
 * recalled message has no committed copy to settle against. The text lands back
 * in the composer, which is where an unsent message belongs.
 */
export function removeDeliveryLine(messages: readonly ChatLine[], clientMessageId: string): ChatLine[] {
  const index = findDeliveryLineIndex(messages, clientMessageId);
  if (index === -1) return [...messages];
  return [...messages.slice(0, index), ...messages.slice(index + 1)];
}

export function applyQueueToDelivery(messages: ChatLine[], queued: readonly QueuedSessionMessage[]): ChatLine[] {
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
    // Absence proves nothing. A queue snapshot omits a message while the agent
    // is expanding it, between the instant it is taken and the instant it is
    // written to the transcript, and whenever its id could not be stamped onto
    // the entry at all. Settling on absence turned a waiting bubble into an
    // ordinary card, which then could not be claimed by its own queue entry -
    // so the entry was drawn a second time, or, when it never returned, the row
    // simply vanished. Delivery has its own evidence: the agent's committed
    // copy of the message, applied by carryDeliveryForward.
  }
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
    meta: { ...finalized.meta, delivery: { ...delivery, state: delivery.state === "failed" ? delivery.state : "delivered" } },
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
