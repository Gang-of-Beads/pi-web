import type { ChatLine } from "./components/shared";

/**
 * What makes two deliveries the same message.
 *
 * A message reaches the browser through several independent paths - an
 * optimistic bubble, the server's echo, the agent's committed copy, streaming
 * deltas, a history load, the server's queue. Without an identity each path
 * invented its own "have I seen this?" test, and every duplicate reported was
 * one of those tests' blind spots.
 *
 * Returns nothing when the line carries no identity yet: an unidentified line
 * cannot be claimed to be a repeat of anything.
 */
export function messageIdentity(line: ChatLine): string | undefined {
  const delivery = line.meta?.delivery?.clientMessageId;
  if (delivery !== undefined && delivery !== "") return `client:${delivery}`;
  const responseId = line.meta?.responseId;
  if (responseId !== undefined && responseId !== "") return `response:${responseId}`;
  const timestamp = line.meta?.timestamp;
  if (timestamp !== undefined && timestamp !== "") return `at:${line.role}:${timestamp}`;
  return undefined;
}

export function indexOfIdentity(transcript: readonly ChatLine[], identity: string): number {
  return transcript.findIndex((line) => messageIdentity(line) === identity);
}
