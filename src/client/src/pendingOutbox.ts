import type { PromptAttachment } from "./api";
/**
 * Pending-message outbox: survives network drops so a send is never silently
 * lost. When a prompt fails with a network error, its contents are persisted
 * per session and retried automatically once the browser reports connectivity
 * again (`window.online`) or on the next manual retry.
 *
 * Storage mirrors the prompt-draft conventions (localStorage, best-effort).
 */

const outboxPrefix = "pi-web:pending-prompt:";

export interface PendingPrompt {
  text: string;
  behavior?: "steer" | "followUp";
  /** The bubble's correlation id, so the retry lands on the same tracking. */
  clientMessageId?: string;
  /**
   * What was attached to the message. The outbox used to store text alone and
   * the replay sent text alone, so a retried message came back as prose about
   * a screenshot nobody could see - and nothing said so, because the bubble
   * replayed and the send succeeded.
   */
  attachments?: PromptAttachment[];
  at: string;
}

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function outboxKey(sessionKey: string): string {
  return `${outboxPrefix}${sessionKey}`;
}

/** Whether an error looks like connectivity loss rather than a server verdict. */
function isPendingPrompt(value: unknown): value is PendingPrompt {
  return value !== null && typeof value === "object" && typeof Reflect.get(value, "text") === "string";
}

export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof NetworkSendError) return true;
  if (error instanceof TypeError && /fetch|network|load failed|failed to fetch/i.test(error.message)) return true;
  if (error instanceof Error && /ECONNREFUSED|ENOTFOUND|socket hang up|network.*down/i.test(error.message)) return true;
  return false;
}

/**
 * A connectivity failure on send, carrying the bubble's correlation id so the
 * outbox can retry the *same* message. Retrying under a fresh id would leave
 * the "Not sent" bubble behind and, once the retry landed, show the message
 * twice; reusing it makes the retry advance the one bubble that is there.
 */
export class NetworkSendError extends Error {
  constructor(message: string, readonly clientMessageId: string | undefined, options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkSendError";
  }
}

export function loadPendingPrompts(sessionKey: string, storage = browserStorage()): PendingPrompt[] {
  try {
    const raw = storage?.getItem(outboxKey(sessionKey));
    if (raw === undefined || raw === null || raw === "") return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingPrompt);
  } catch {
    return [];
  }
}

export function savePendingPrompt(sessionKey: string, prompt: PendingPrompt, storage = browserStorage()): void {
  try {
    const pending = loadPendingPrompts(sessionKey, storage);
    // A retry that failed again saves the same message; replacing rather than
    // appending keeps one line per unsent message.
    const index = prompt.clientMessageId === undefined
      ? -1
      : pending.findIndex((entry) => entry.clientMessageId === prompt.clientMessageId);
    if (index === -1) pending.push(prompt);
    else pending[index] = prompt;
    storage?.setItem(outboxKey(sessionKey), JSON.stringify(pending));
  } catch {
    // localStorage unavailable (private mode/quota): the message is still in
    // the composer's restore buffer; the outbox is best-effort.
  }
}

export function forgetPendingPrompt(sessionKey: string, clientMessageId: string, storage = browserStorage()): void {
  try {
    const remaining = loadPendingPrompts(sessionKey, storage).filter((entry) => entry.clientMessageId !== clientMessageId);
    if (remaining.length === 0) storage?.removeItem(outboxKey(sessionKey));
    else storage?.setItem(outboxKey(sessionKey), JSON.stringify(remaining));
  } catch {
    return;
  }
}

export function clearPendingPrompts(sessionKey: string, storage = browserStorage()): void {
  try {
    storage?.removeItem(outboxKey(sessionKey));
  } catch {
    // Ignore storage failures; next online flush will retry once more.
  }
}