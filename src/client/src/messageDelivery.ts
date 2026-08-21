import type { QueuedSessionMessage } from "./api";
import type { ChatLine, MessageDeliveryState } from "./components/shared";

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
export function optimisticUserLine(text: string, clientMessageId: string): ChatLine {
  return { role: "user", parts: [{ type: "text", text }], meta: { delivery: { clientMessageId, state: "sending" } } };
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
  if (current === "failed") return false;
  return DELIVERY_ORDER[next] > DELIVERY_ORDER[current];
}

/**
 * Fold a status update into the transcript: entries still in the agent's queue
 * are marked queued, and a tracked message that has left the queue has been
 * taken into the turn.
 */
/**
 * Drop the optimistic bubble for a message that was pulled back out of the
 * queue. It has to go rather than change state: the bubble says "the server has
 * this and the agent will take it next", which stopped being true, and
 * applyQueueToDelivery reads absence from the queue as *delivered* - so leaving
 * it would promote a recalled message to "Read". The text lands back in the
 * composer, which is where an unsent message belongs.
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
    // Only a message the server confirmed can be reported as delivered by
    // absence: an in-flight send is simply not in the queue yet.
    if (delivery.state === "received" || delivery.state === "queued") next = markDelivery(next, delivery.clientMessageId, "delivered");
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
