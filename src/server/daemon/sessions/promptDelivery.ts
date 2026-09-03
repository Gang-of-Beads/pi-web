/** How a prompt waits when the runtime is busy. */
export type QueuedPromptKind = "steer" | "followUp";

export interface PromptDeliveryInput {
  requestedBehavior: QueuedPromptKind | undefined;
  busyAtSubmit: boolean;
}

/**
 * How a prompt is handed to the runtime, decided at the moment of handing.
 *
 * Whether to queue is settled when the request arrives, and the turn it would
 * wait behind can end before the prompt is submitted. A queue kind given to an
 * idle runtime parks the message where no turn-end will drain it: the sender is
 * told "Sent", the session reports idle, and the message surfaces later, out of
 * order, when some unrelated turn ends.
 */
export function promptDeliveryBehavior(input: PromptDeliveryInput): QueuedPromptKind | undefined {
  if (input.requestedBehavior === undefined) return undefined;
  return input.busyAtSubmit ? input.requestedBehavior : undefined;
}
