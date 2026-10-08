import { browserLocalStorage } from "./browserLocalStorage";
import type { PromptAttachment } from "./api";
import type { PromptAttachmentDelivery } from "../../shared/apiTypes";
import type { OutgoingEvent, OutgoingState } from "./outgoingMessages";
import { outgoingStateFromStorage, outgoingStopped, outgoingVerdict } from "./outgoingMessages";
import type { DeliveryFailureCause } from "./deliveryWords";
/**
 * Pending-message outbox: survives network drops so a send is never silently
 * lost. Every prompt is persisted per session before it is sent. One that was
 * not sent is sent again by itself within ten minutes of its send, when the
 * browser reports connectivity again (`window.online`), on the first render or
 * on a session switch; anything else waits for the reader's Retry (D1, B4).
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
  /** Why a failed record failed, so the tray words it as the bubble does. */
  failure?: DeliveryFailureCause;
  /**
   * The runtime refused it. Only the reader's Retry sends it again: an automatic replay on the
   * next `online` or session switch resent a message Pi had refused, raising the same error again.
   */
  refused?: true;
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

function outboxKey(sessionKey: string): string {
  return `${outboxPrefix}${sessionKey}`;
}

/** Move one record along its own life, if the verdict says so, and persist it. */
export function advancePendingPrompt(sessionKey: string, clientMessageId: string, event: OutgoingEvent): OutgoingState | undefined {
  const prompts = loadPendingPrompts(sessionKey);
  const target = prompts.find((prompt) => prompt.clientMessageId === clientMessageId);
  if (target === undefined) return undefined;
  const verdict = outgoingVerdict(target.state ?? "sending", event);
  if (verdict.kind === "ignore" || verdict.kind === "stay") return target.state ?? "sending";
  if (verdict.kind === "drop") {
    forgetPendingPrompt(sessionKey, clientMessageId);
    return undefined;
  }
  const moved: PendingPrompt = { ...target, state: verdict.to };
  delete moved.failure;
  delete moved.refused;
  savePendingPrompt(sessionKey, verdict.to === "failed" ? { ...moved, failure: FAILURE_FOR_EVENT[event] ?? "not-sent" } : moved);
  return verdict.to;
}

/**
 * Why a record that fails on this event failed. Every event that fails a record is a refusal or
 * a dead link, so the message never became part of the conversation.
 */
const FAILURE_FOR_EVENT: Partial<Record<OutgoingEvent, DeliveryFailureCause>> = {
  "send-refused-network": "not-sent",
  "send-refused-permanent": "not-sent",
};

function isPendingPrompt(value: unknown): value is PendingPrompt {
  if (value === null || typeof value !== "object" || typeof Reflect.get(value, "text") !== "string") return false;
  const state: unknown = Reflect.get(value, "state");
  return state === undefined || typeof state === "string";
}

/**
 * A record keeps its meaning across builds: a name an earlier build wrote is read as the state it
 * meant, and a state this build has no row for is read as sending. The table lookup is
 * unchecked, so an unknown state used to make the next transition throw inside the async send,
 * where nothing caught it.
 */
function withKnownState(prompt: PendingPrompt): PendingPrompt {
  if (prompt.state === undefined) return prompt;
  const known = outgoingStateFromStorage(prompt.state);
  if (known === prompt.state) return prompt;
  if (known !== undefined) return { ...prompt, state: known };
  const unknown = { ...prompt };
  delete unknown.state;
  return unknown;
}

/** Whether an error looks like connectivity loss rather than a server verdict. */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof NetworkSendError) return true;
  if (error instanceof TypeError && /fetch|network|load failed|failed to fetch/i.test(error.message)) return true;
  if (error instanceof Error && /ECONNREFUSED|ENOTFOUND|socket hang up|network.*down/i.test(error.message)) return true;
  return false;
}

/**
 * Whether the browser says the link was down for this failure, so the bytes never left. Only a
 * failure that carried no answer can have been stopped by a dead link, and only an explicit
 * `navigator.onLine === false` says so: an HTTP answer, even a gateway's 504, proves the bytes
 * left, and an environment that does not report the link proves nothing. This decides whether a
 * row reads "Not sent" instead of "Receiving…", so it may not guess.
 */
export function linkReportedOffline(error: unknown): boolean {
  if (!isNetworkFailure(error) || typeof navigator === "undefined") return false;
  const onLine: unknown = Reflect.get(navigator, "onLine");
  return onLine === false;
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
  /** When the message was first sent: a retry keeps the time its row first showed (B5). */
  sentAt?: string;
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
  sending: false,
  received: false,
  queued: false,
  delivered: false,
  unverifiable: true,
  failed: true,
};

/**
 * The sessions holding a send that failed, so the session list can mark them.
 *
 * The failure's record already carries its scope; this reads the marks back out for the
 * list, so the reader can see that a session needs attention before opening it.
 */
export function sessionsWithFailedSends(storage = browserLocalStorage()): Set<string> {
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

export function loadPendingPrompts(sessionKey: string, storage = browserLocalStorage()): PendingPrompt[] {
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

/** Returns whether the record was written; the callers that move a message out of another store need to know. */
export function savePendingPrompt(sessionKey: string, prompt: PendingPrompt, storage = browserLocalStorage()): boolean {
  if (storage === undefined) return false;
  try {
    const pending = loadPendingPrompts(sessionKey, storage);
    // A retry that failed again saves the same message; replacing rather than
    // appending keeps one line per unsent message.
    const index = prompt.clientMessageId === undefined
      ? -1
      : pending.findIndex((entry) => entry.clientMessageId === prompt.clientMessageId);
    if (index === -1) pending.push(prompt);
    else pending[index] = prompt;
    storage.setItem(outboxKey(sessionKey), JSON.stringify(pending));
    announceOutboxChange(sessionKey);
    return true;
  } catch {
    // localStorage unavailable (private mode/quota): the message is still in
    // the composer's restore buffer; the outbox is best-effort.
    return false;
  }
}

export function forgetPendingPrompt(sessionKey: string, clientMessageId: string, storage = browserLocalStorage()): void {
  try {
    const remaining = loadPendingPrompts(sessionKey, storage).filter((entry) => entry.clientMessageId !== clientMessageId);
    if (remaining.length === 0) storage?.removeItem(outboxKey(sessionKey));
    else storage?.setItem(outboxKey(sessionKey), JSON.stringify(remaining));
    announceOutboxChange(sessionKey);
  } catch {
    return;
  }
}

const reservePrefix = "pi-web:accepted-prompt:";

/** How long an accepted message is kept for a refusal that may still come; the daemon's ledger answers replays for a day. */
const RESERVE_KEEP_MS = 24 * 60 * 60 * 1000;

interface ReservedPrompt extends PendingPrompt {
  reservedAt: string;
}

function loadReserve(sessionKey: string, storage: Storage | undefined, now: number): ReservedPrompt[] {
  try {
    const raw = storage?.getItem(`${reservePrefix}${sessionKey}`);
    if (raw === undefined || raw === null || raw === "") return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is ReservedPrompt => isPendingPrompt(value) && typeof Reflect.get(value, "reservedAt") === "string")
      .filter((entry) => now - Date.parse(entry.reservedAt) < RESERVE_KEEP_MS);
  } catch {
    return [];
  }
}

/** Whether the write landed: a full quota must not cost a message whose words live only here. */
function writeReserve(sessionKey: string, reserved: readonly ReservedPrompt[], storage: Storage | undefined): boolean {
  if (storage === undefined) return false;
  try {
    if (reserved.length === 0) storage.removeItem(`${reservePrefix}${sessionKey}`);
    else storage.setItem(`${reservePrefix}${sessionKey}`, JSON.stringify(reserved));
    return true;
  } catch {
    return false;
  }
}

/**
 * The daemon took this message: it leaves the outbox, which holds only what waits on the reader,
 * and its content is kept aside until the agent takes it. The runtime can still refuse a message
 * the inbox accepted, and Retry needs the words and attachments to send it again under the same
 * identity - a refused row once offered Retry with nothing left to send.
 */
export function reserveAcceptedPrompt(sessionKey: string, clientMessageId: string, storage = browserLocalStorage(), now = Date.now()): void {
  const record = loadPendingPrompts(sessionKey, storage).find((entry) => entry.clientMessageId === clientMessageId);
  if (record?.refused === true) return;
  sweepExpiredReserves(storage, now);
  if (record !== undefined) {
    const reserved = loadReserve(sessionKey, storage, now).filter((entry) => entry.clientMessageId !== clientMessageId);
    const kept: ReservedPrompt = { ...record, state: "received", reservedAt: new Date(now).toISOString() };
    delete kept.failure;
    if (!writeReserve(sessionKey, [...reserved, kept], storage)) return;
  }
  forgetPendingPrompt(sessionKey, clientMessageId, storage);
}

/**
 * Drop every reserve entry past its day, in every session. A session the reader never opens
 * again kept its entries - attachments included - for good, and a full storage quota is what
 * would lose the next unsent message's record.
 */
function sweepExpiredReserves(storage: Storage | undefined, now: number): void {
  if (storage === undefined) return;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index) ?? "";
    if (key.startsWith(reservePrefix)) keys.push(key.slice(reservePrefix.length));
  }
  for (const sessionKey of keys) {
    const kept = loadReserve(sessionKey, storage, now);
    if (kept.length !== storedReserveLength(sessionKey, storage)) writeReserve(sessionKey, kept, storage);
  }
}

function storedReserveLength(sessionKey: string, storage: Storage): number {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`${reservePrefix}${sessionKey}`) ?? "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Write a verdict onto a message's record, wherever it is kept: the runtime refused it, or the
 * daemon has no record of it. A record in the reserve comes back to the outbox, so the tray and
 * Retry have its words - a message the daemon lost across a restart, already reserved as
 * received, read "Not received" with a Retry that had nothing to send. A refusal is marked so
 * only Retry sends it again. Returns whether a record now carries the verdict.
 */
export function failPendingPrompt(sessionKey: string, clientMessageId: string, cause: DeliveryFailureCause, refused: boolean, storage = browserLocalStorage(), now = Date.now()): boolean {
  const outboxed = loadPendingPrompts(sessionKey, storage).find((entry) => entry.clientMessageId === clientMessageId);
  const reserved = loadReserve(sessionKey, storage, now);
  const kept = outboxed === undefined ? reserved.find((entry) => entry.clientMessageId === clientMessageId) : undefined;
  const record: (PendingPrompt & { reservedAt?: string }) | undefined = outboxed ?? kept;
  if (record === undefined) return false;
  const failed: PendingPrompt & { reservedAt?: string } = { ...record, state: "failed", failure: cause };
  delete failed.refused;
  delete failed.reservedAt;
  if (!savePendingPrompt(sessionKey, refused ? { ...failed, refused: true } : failed, storage)) return false;
  if (kept !== undefined) writeReserve(sessionKey, reserved.filter((entry) => entry !== kept), storage);
  return true;
}

/**
 * A replay nobody answered: the record says what the bubble says. Bytes that left may have
 * arrived (Receiving…); bytes that never left did not (Not sent). The table cannot say it, because
 * a failed record ignores a timeout; a retry is a fresh attempt, so its outcome replaces the old.
 */
export function markUnansweredPrompt(sessionKey: string, clientMessageId: string, bytesLeft: boolean, storage = browserLocalStorage()): void {
  const record = loadPendingPrompts(sessionKey, storage).find((entry) => entry.clientMessageId === clientMessageId);
  if (record === undefined) return;
  const marked: PendingPrompt = { ...record, state: bytesLeft ? "unverifiable" : "failed" };
  delete marked.failure;
  delete marked.refused;
  savePendingPrompt(sessionKey, bytesLeft ? marked : { ...marked, failure: "not-sent" }, storage);
}

/** How long after it was sent a message not sent from this device is still resent by itself (D1). */
export const AUTOMATIC_RESEND_WINDOW_MS = 10 * 60_000;

/**
 * Whether a replay sends this record. The reader's Retry sends the stopped record it names. A
 * replay of everything - on `online`, on the first render, on a session switch - sends only a
 * message that was not sent (failed before its bytes left, or proven not received by the ledger)
 * or whose send never finished on this page (a page that closed mid-send), within ten minutes of
 * its send, and not refused (D1 "Automatic resend"); its id makes a second copy impossible. It used
 * to send everything that
 * stopped without an answer, whatever its
 * age, so a message stranded hours before came back the next time the page loaded, and an
 * unverifiable one was resent where D1 asks the ledger (B4, probe-outbox-stale.mjs).
 */
export function replaysRecord(record: PendingPrompt, only: string | undefined, now = Date.now()): boolean {
  if (!outgoingStopped(record.state)) return false;
  if (only !== undefined) return record.clientMessageId === only;
  return resendsByItself(record, now);
}

function resendsByItself(record: PendingPrompt, now: number): boolean {
  const notSent = record.state === undefined || record.state === "failed";
  if (!notSent || record.refused === true) return false;
  const sentAt = Date.parse(record.at);
  return Number.isFinite(sentAt) && now - sentAt <= AUTOMATIC_RESEND_WINDOW_MS;
}

/** The agent took it: nothing can refuse it any more. */
export function forgetReservedPrompt(sessionKey: string, clientMessageId: string, storage = browserLocalStorage(), now = Date.now()): void {
  const reserved = loadReserve(sessionKey, storage, now);
  if (!reserved.some((entry) => entry.clientMessageId === clientMessageId)) return;
  writeReserve(sessionKey, reserved.filter((entry) => entry.clientMessageId !== clientMessageId), storage);
}

/**
 * Carry a session's unsent records to its new identity. A session created in this browser
 * gets its daemon id when it starts, and one whose daemon copy vanished is recreated under a
 * new id; records left under the old key were read by no surface - not the strip, not the
 * session list, not a replay - and Retry called them gone.
 */
export function moveOutbox(fromSessionKey: string, toSessionKey: string, storage = browserLocalStorage(), now = Date.now()): void {
  if (fromSessionKey === toSessionKey) return;
  const reserved = loadReserve(fromSessionKey, storage, now);
  if (reserved.length > 0 && writeReserve(toSessionKey, [...loadReserve(toSessionKey, storage, now), ...reserved], storage)) {
    writeReserve(fromSessionKey, [], storage);
  }
  const moving = loadPendingPrompts(fromSessionKey, storage);
  if (moving.length === 0) return;
  const landed = moving.map((prompt) => savePendingPrompt(toSessionKey, prompt, storage)).every(Boolean);
  if (landed) clearPendingPrompts(fromSessionKey, storage);
}

export function clearPendingPrompts(sessionKey: string, storage = browserLocalStorage()): void {
  try {
    storage?.removeItem(outboxKey(sessionKey));
    announceOutboxChange(sessionKey);
  } catch {
    // Ignore storage failures; next online flush will retry once more.
  }
}