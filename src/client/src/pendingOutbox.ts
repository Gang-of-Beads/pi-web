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
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError && /fetch|network|load failed|failed to fetch/i.test(error.message)) return true;
  if (error instanceof Error && /ECONNREFUSED|ENOTFOUND|socket hang up|network.*down/i.test(error.message)) return true;
  return false;
}

export function loadPendingPrompts(sessionKey: string, storage = browserStorage()): PendingPrompt[] {
  try {
    const raw = storage?.getItem(outboxKey(sessionKey));
    if (raw === undefined || raw === null || raw === "") return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => entry !== null && typeof entry === "object") as PendingPrompt[] : [];
  } catch {
    return [];
  }
}

export function savePendingPrompt(sessionKey: string, prompt: PendingPrompt, storage = browserStorage()): void {
  try {
    const pending = loadPendingPrompts(sessionKey, storage);
    pending.push(prompt);
    storage?.setItem(outboxKey(sessionKey), JSON.stringify(pending));
  } catch {
    // localStorage unavailable (private mode/quota): the message is still in
    // the composer's restore buffer; the outbox is best-effort.
  }
}

export function clearPendingPrompts(sessionKey: string, storage = browserStorage()): void {
  try {
    storage?.removeItem(outboxKey(sessionKey));
  } catch {
    // Ignore storage failures; next online flush will retry once more.
  }
}