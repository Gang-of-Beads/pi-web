import type { PromptAttachment, QueuedSessionMessage } from "./api";
import type { ChatLine, ChatPart, MessageDeliveryState } from "./components/shared";
import { deliveryWordKey, deliveryWords } from "./deliveryWords";

/**
 * Delivery marks for messages this browser sent.
 *
 * A prompt used to vanish into an ambiguous middle state: the composer cleared
 * immediately, the transcript showed the text, and the same text also sat in
 * the "Queued messages" list - two renderings of one message, with nothing
 * saying whether the server had it. The message carries a correlation id now,
 * so every stage is a state on the bubble itself:
 *
 *   sending    on its way: sent and resent until the machine answers
 *   takingBack the reader asked for it back; the machine has not answered yet
 *   received   the machine accepted it (single mark)
 *   queued     the agent is busy and will take it as a steer/follow-up
 *   delivered  the agent has taken it into the turn (double mark)
 *
 * Nothing fails: a message refused for good or taken back leaves the transcript, and its words
 * go back to the composer (docs/design/message-states.md).
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

/** Sent, or waiting to be: the agent has not taken it yet. */
export function deliveryWaiting(state: MessageDeliveryState): boolean {
  return !deliveryTaken(state);
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

/**
 * Which moves a row's delivery makes, from each state to each state. Any answer from the machine -
 * received, queued, delivered - overtakes a message on its way. A message on its way or queued can
 * start being taken back; while it is, only the agent taking it (delivered) overtakes it, since the
 * take-back's own answer settles it either way.
 * Nothing moves back here; the two steps back a row takes (a lost message on its way again, a
 * take-back too late) are named moves of their own (`restartDelivery`, `endTakingBack`).
 */
const ADVANCES: Readonly<Record<MessageDeliveryState, Readonly<Record<MessageDeliveryState, boolean>>>> = {
  sending: { sending: false, takingBack: true, received: true, queued: true, delivered: true },
  takingBack: { sending: false, takingBack: false, received: false, queued: false, delivered: true },
  received: { sending: false, takingBack: false, received: false, queued: true, delivered: true },
  queued: { sending: false, takingBack: true, received: false, queued: false, delivered: true },
  delivered: { sending: false, takingBack: false, received: false, queued: false, delivered: false },
};

function advancesDelivery(current: MessageDeliveryState, next: MessageDeliveryState): boolean {
  return ADVANCES[current][next];
}

/**
 * A message the machine lost before the agent read it (a restart) is on its way again: its row
 * goes back to sending while the outbox resends it.
 */
export function restartDelivery(messages: readonly ChatLine[], clientMessageId: string): ChatLine[] {
  return setDeliveryState(messages, clientMessageId, RESTARTS, "sending");
}

/** Which rows a lost message restarts: any the agent has not taken. */
const RESTARTS: Readonly<Record<MessageDeliveryState, boolean>> = { sending: false, takingBack: true, received: true, queued: true, delivered: false };

/** Which rows a too-late answer settles: only one still being taken back; a frame may have moved it on already. */
const ENDS_TAKING_BACK: Readonly<Record<MessageDeliveryState, boolean>> = { sending: false, takingBack: true, received: false, queued: false, delivered: false };

/** A take-back the machine answered "too late": the message is with the machine, and stays. */
export function endTakingBack(messages: readonly ChatLine[], clientMessageId: string): ChatLine[] {
  return setDeliveryState(messages, clientMessageId, ENDS_TAKING_BACK, "received");
}

function setDeliveryState(messages: readonly ChatLine[], clientMessageId: string, applies: Readonly<Record<MessageDeliveryState, boolean>>, state: MessageDeliveryState): ChatLine[] {
  const index = findDeliveryLineIndex(messages, clientMessageId);
  const line = messages[index];
  const current = line?.meta?.delivery;
  if (line === undefined || current === undefined || !applies[current.state]) return [...messages];
  const next = [...messages];
  next[index] = { ...line, meta: { ...line.meta, delivery: { ...current, state } } };
  return next;
}

/** The identity a row's Take back acts on, when its state offers one. */
export function takeBackTarget(line: Pick<ChatLine, "meta">): string | undefined {
  const delivery = line.meta?.delivery;
  const key = delivery === undefined ? undefined : deliveryWordKey(delivery.state);
  return key !== undefined && deliveryWords(key).takeBack ? delivery?.clientMessageId : undefined;
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
