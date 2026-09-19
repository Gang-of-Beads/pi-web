/**
 * What a prompt that has not landed offers the reader.
 *
 * "Unsent · Retry · Discard" was shown even while the message was still on its
 * way, so the screen said "Sending your message…" and offered to send it
 * again in the same breath. Retry belongs to a send that has stopped; a send
 * in flight can only be taken back.
 */

export type PendingPromptState = "sending" | "unsent";

export interface PendingPromptActions {
  state: PendingPromptState;
  label: string;
  retry: boolean;
  discard: true;
}

export function pendingPromptActions(input: { sending: boolean }): PendingPromptActions {
  if (input.sending) return { state: "sending", label: "Sending", retry: false, discard: true };
  return { state: "unsent", label: "Unsent", retry: true, discard: true };
}
