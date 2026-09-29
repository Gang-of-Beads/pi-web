import type { PromptAttachment } from "./api";
import type { PromptAttachmentDelivery } from "../../shared/apiTypes";
import type { OutgoingEvent, OutgoingState } from "./outgoingMessages";
import { isOutgoingState, outgoingVerdict } from "./outgoingMessages";
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
  /**
   * Where this record is in its own life. Carried on the record, not in a component, so a
   * late answer for a session the reader has left cannot rewrite what another one shows.
   */
  state?: OutgoingState;
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
  /**
   * How the attachments travel, decided when the message was composed. A replay used to
   * recompute it from whatever the composer held at replay time - empty, or the next
   * message's files - so a file meant for the workspace went inline, and an image inline
   * became a workspace file.
   */
  delivery?: PromptAttachmentDelivery;
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

/** Move one record along its own life, if the verdict says so, and persist it. */
export function advancePendingPrompt(sessionKey: string, clientMessageId: string, event: OutgoingEvent): OutgoingState | undefined {
  const prompts = loadPendingPrompts(sessionKey);
  const target = prompts.find((prompt) => prompt.clientMessageId === clientMessageId);
  if (target === undefined) return undefined;
  const verdict = outgoingVerdict(target.state ?? "stored", event);
  if (verdict.kind === "ignore" || verdict.kind === "stay") return target.state ?? "stored";
  if (verdict.kind === "drop") {
    forgetPendingPrompt(sessionKey, clientMessageId);
    return undefined;
  }
  savePendingPrompt(sessionKey, { ...target, state: verdict.to });
  return verdict.to;
}

function isPendingPrompt(value: unknown): value is PendingPrompt {
  if (value === null || typeof value !== "object" || typeof Reflect.get(value, "text") !== "string") return false;
  const state: unknown = Reflect.get(value, "state");
  return state === undefined || typeof state === "string";
}

/**
 * A record whose state this build's table has no row for - written by another build, or under
 * the bubble's spelling - is read as freshly stored. The table lookup is unchecked, so an
 * unknown state used to make the next transition throw inside the async send, where nothing
 * caught it.
 */
function withKnownState(prompt: PendingPrompt): PendingPrompt {
  if (prompt.state === undefined || isOutgoingState(prompt.state)) return prompt;
  const stored = { ...prompt };
  delete stored.state;
  return stored;
}

/** Whether an error looks like connectivity loss rather than a server verdict. */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof NetworkSendError) return true;
  if (error instanceof TypeError && /fetch|network|load failed|failed to fetch/i.test(error.message)) return true;
  if (error instanceof Error && /ECONNREFUSED|ENOTFOUND|socket hang up|network.*down/i.test(error.message)) return true;
  return false;
}

/** The machine and session a message was composed for. */
export interface SendScope {
  machineId: string;
  sessionId: string;
}

/** What a send hands the controller besides its content: its identity and its own scope. */
export interface SendReplay {
  clientMessageId?: string;
  scope?: SendScope;
}

/**
 * The selection moved away from the scope a send was composed for before the send could go.
 *
 * Sends wait their turn behind the previous one, and the controller sends to whatever session
 * is selected when a send finally goes - so a message composed for session A, still waiting
 * when the reader switched machine and opened B, ran in B. Neither a refusal nor a failure:
 * the message keeps its outbox record under its own scope and goes when that session is open.
 */
export class SendScopeChangedError extends Error {
  constructor(readonly scope: SendScope) {
    super(`The message was written for another session (${scope.machineId}:${scope.sessionId})`);
    this.name = "SendScopeChangedError";
  }
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

/**
 * Announced whenever the outbox for a session changes.
 *
 * The outbox lives in storage, so a writer that is not the composer - the
 * session controller retiring an accepted prompt - had no way to tell the
 * composer to re-read. The owner met the result: a message the agent had
 * already answered still offered "Unsent · Retry".
 */
export const OUTBOX_CHANGED_EVENT = "pi-web.outbox-changed";

function announceOutboxChange(sessionKey: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OUTBOX_CHANGED_EVENT, { detail: sessionKey }));
}

/**
 * Which record states the session list marks: a send nobody answered for needs the reader as
 * much as one that failed, and the two used to be recorded differently for the same event.
 */
const NEEDS_ATTENTION: Readonly<Record<OutgoingState, boolean>> = {
  stored: false,
  sending: false,
  accepted: false,
  delivered: false,
  unverified: true,
  failed: true,
};

/**
 * The sessions holding a send that failed, so the session list can mark them.
 *
 * The failure's record already carries its scope; this reads the marks back out for the
 * list, so the reader can see that a session needs attention before opening it.
 */
export function sessionsWithFailedSends(storage = browserStorage()): Set<string> {
  const marked = new Set<string>();
  if (storage === undefined) return marked;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index) ?? "";
    if (!key.startsWith(outboxPrefix)) continue;
    const prompts = loadPendingPrompts(key.slice(outboxPrefix.length), storage);
    if (!prompts.some((prompt) => prompt.state !== undefined && NEEDS_ATTENTION[prompt.state])) continue;
    const scope = key.slice(outboxPrefix.length);
    marked.add(scope.slice(scope.indexOf(":") + 1));
  }
  return marked;
}

export function loadPendingPrompts(sessionKey: string, storage = browserStorage()): PendingPrompt[] {
  try {
    const raw = storage?.getItem(outboxKey(sessionKey));
    if (raw === undefined || raw === null || raw === "") return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingPrompt).map(withKnownState);
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
    announceOutboxChange(sessionKey);
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
    announceOutboxChange(sessionKey);
  } catch {
    return;
  }
}

/**
 * Carry a session's unsent records to its new identity. A session created in this browser
 * gets its daemon id when it starts, and one whose daemon copy vanished is recreated under a
 * new id; records left under the old key were read by no surface - not the strip, not the
 * session list, not a replay - and Retry called them gone.
 */
export function moveOutbox(fromSessionKey: string, toSessionKey: string, storage = browserStorage()): void {
  if (fromSessionKey === toSessionKey) return;
  const moving = loadPendingPrompts(fromSessionKey, storage);
  if (moving.length === 0) return;
  for (const prompt of moving) savePendingPrompt(toSessionKey, prompt, storage);
  clearPendingPrompts(fromSessionKey, storage);
}

export function clearPendingPrompts(sessionKey: string, storage = browserStorage()): void {
  try {
    storage?.removeItem(outboxKey(sessionKey));
    announceOutboxChange(sessionKey);
  } catch {
    // Ignore storage failures; next online flush will retry once more.
  }
}