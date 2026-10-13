import { browserLocalStorage } from "./browserLocalStorage";
import type { PromptAttachment } from "./api";
import type { PromptAttachmentDelivery } from "../../shared/apiTypes";
import { NetworkError } from "./api/requestDeadline";
import { claimSequence, moveOperationLog, type SequencedOperation } from "./operationLog";

/**
 * The outbox: this device's operations on a session that the machine has not answered yet, in
 * the order they were written (docs/design/message-states.md). A message and a take-back are
 * both operations; each carries its number in the session's operation log (operationLog.ts),
 * is sent again with the same identity and number until the machine answers, and holds every
 * later operation behind it. A message never fails: it leaves when the machine answers it -
 * accepted, taken back, or refused for good (then cancelled, words back in the composer). Only a
 * write to this browser's storage can fail, and the writers say so to their callers.
 *
 * Storage mirrors the prompt-draft conventions (localStorage, per session).
 */

const outboxPrefix = "pi-web:pending-prompt:";

export interface PendingPrompt {
  /** This operation's number in its session's log; fixed for its whole life. */
  seq: number;
  /** A take-back of the message with this identity, rather than a message. */
  takeBackOf?: string;
  text: string;
  behavior?: "steer" | "followUp";
  /** The message's identity; a take-back's own identity is derived from its target's. */
  clientMessageId: string;
  /** What was attached, so a resend carries the same files. */
  attachments?: PromptAttachment[];
  /** How the attachments travel, decided when the message was composed. */
  delivery?: PromptAttachmentDelivery;
  at: string;
}

function outboxKey(sessionKey: string): string {
  return `${outboxPrefix}${sessionKey}`;
}

function isPendingPrompt(value: unknown): value is PendingPrompt {
  if (value === null || typeof value !== "object") return false;
  return typeof Reflect.get(value, "text") === "string" && typeof Reflect.get(value, "seq") === "number" && typeof Reflect.get(value, "clientMessageId") === "string";
}

/** Whether a send failed on the link rather than with an answer. */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof NetworkSendError || error instanceof NetworkError) return true;
  if (error instanceof Error && /ECONNREFUSED|ENOTFOUND|socket hang up|network.*down/i.test(error.message)) return true;
  return false;
}

/** The machine and session a message was composed for. */
export interface SendScope {
  machineId: string;
  sessionId: string;
}

/** What a send hands the controller besides its content: its identity, scope and number. */
export interface SendReplay {
  clientMessageId?: string;
  scope?: SendScope;
  sentAt?: string;
  sequence?: SequencedOperation;
}

/**
 * The selection moved away from the scope a send was composed for before the send could go. The
 * operation keeps its place in its own session's outbox and goes when that session is open.
 */
export class SendScopeChangedError extends Error {
  constructor(readonly scope: SendScope) {
    super(`The message was written for another session (${scope.machineId}:${scope.sessionId})`);
    this.name = "SendScopeChangedError";
  }
}

/** A send nobody answered: the operation stays at the head of its outbox and is sent again. */
export class NetworkSendError extends Error {
  constructor(message: string, readonly clientMessageId: string | undefined, options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkSendError";
  }
}

/** Announced whenever the outbox for a session changes, so the composer re-reads and drains it. */
export const OUTBOX_CHANGED_EVENT = "pi-web.outbox-changed";

function announceOutboxChange(sessionKey: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OUTBOX_CHANGED_EVENT, { detail: sessionKey }));
}

export function loadPendingPrompts(sessionKey: string, storage = browserLocalStorage()): PendingPrompt[] {
  try {
    const raw = storage?.getItem(outboxKey(sessionKey));
    if (raw === undefined || raw === null || raw === "") return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingPrompt).sort((left, right) => left.seq - right.seq);
  } catch {
    return [];
  }
}

/** Write a session's outbox and announce it; an unchanged outbox is neither rewritten nor announced, since every announcement kicks the driver. */
function writeOutbox(sessionKey: string, prompts: readonly PendingPrompt[], storage: Storage | undefined): boolean {
  if (storage === undefined) return false;
  try {
    const before = storage.getItem(outboxKey(sessionKey));
    if ((before ?? "") === (prompts.length === 0 ? "" : JSON.stringify(prompts))) return true;
    if (prompts.length === 0) storage.removeItem(outboxKey(sessionKey));
    else storage.setItem(outboxKey(sessionKey), JSON.stringify(prompts));
    announceOutboxChange(sessionKey);
    return true;
  } catch {
    return false;
  }
}

/** Write an operation, replacing one with the same identity. Returns whether it landed. */
export function savePendingPrompt(sessionKey: string, prompt: PendingPrompt, storage = browserLocalStorage()): boolean {
  const pending = loadPendingPrompts(sessionKey, storage).filter((entry) => entry.clientMessageId !== prompt.clientMessageId);
  return writeOutbox(sessionKey, [...pending, prompt], storage);
}

/** Write a new message at the end of the session's log. */
export function appendMessage(sessionKey: string, message: Omit<PendingPrompt, "seq" | "takeBackOf">, storage = browserLocalStorage()): PendingPrompt | undefined {
  const record: PendingPrompt = { ...message, seq: claimSequence(sessionKey, storage) };
  return savePendingPrompt(sessionKey, record, storage) ? record : undefined;
}

/** The identity of the take-back of one message. */
export function takeBackId(clientMessageId: string): string {
  return `${clientMessageId}:take-back`;
}

/**
 * Write a take-back at the end of the session's log. It carries the message's words, so they can
 * go back to the composer when the machine confirms. A second press finds it already written.
 */
export function appendTakeBack(sessionKey: string, message: { clientMessageId: string; text: string; attachments?: PromptAttachment[]; behavior?: "steer" | "followUp" }, storage = browserLocalStorage()): boolean {
  const id = takeBackId(message.clientMessageId);
  if (loadPendingPrompts(sessionKey, storage).some((entry) => entry.clientMessageId === id)) return true;
  const record: PendingPrompt = {
    seq: claimSequence(sessionKey, storage),
    takeBackOf: message.clientMessageId,
    clientMessageId: id,
    text: message.text,
    ...(message.behavior === undefined ? {} : { behavior: message.behavior }),
    ...(message.attachments === undefined || message.attachments.length === 0 ? {} : { attachments: message.attachments }),
    at: new Date().toISOString(),
  };
  return savePendingPrompt(sessionKey, record, storage);
}

export function forgetPendingPrompt(sessionKey: string, clientMessageId: string, storage = browserLocalStorage()): void {
  const remaining = loadPendingPrompts(sessionKey, storage).filter((entry) => entry.clientMessageId !== clientMessageId);
  writeOutbox(sessionKey, remaining, storage);
}

const reservePrefix = "pi-web:accepted-prompt:";

/** How long an accepted message's words are kept for a take-back or a refusal that may still come: as long as the daemon's ledger answers for it. */
const RESERVE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

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
 * The machine took this message: it leaves the outbox, and its words are kept aside until the
 * agent takes it, so a take-back or a runtime refusal can hand them back to the composer.
 */
export function reserveAcceptedPrompt(sessionKey: string, clientMessageId: string, storage = browserLocalStorage(), now = Date.now()): void {
  const record = loadPendingPrompts(sessionKey, storage).find((entry) => entry.clientMessageId === clientMessageId && entry.takeBackOf === undefined);
  sweepExpiredReserves(storage, now);
  if (record !== undefined) {
    const reserved = loadReserve(sessionKey, storage, now).filter((entry) => entry.clientMessageId !== clientMessageId);
    if (!writeReserve(sessionKey, [...reserved, { ...record, reservedAt: new Date(now).toISOString() }], storage)) return;
  }
  forgetPendingPrompt(sessionKey, clientMessageId, storage);
}

function sweepExpiredReserves(storage: Storage | undefined, now: number): void {
  if (storage === undefined) return;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index) ?? "";
    if (key.startsWith(reservePrefix)) keys.push(key.slice(reservePrefix.length));
  }
  for (const sessionKey of keys) writeReserve(sessionKey, loadReserve(sessionKey, storage, now), storage);
}

/** The words of a message this device sent, wherever they are kept. */
export function heldWords(sessionKey: string, clientMessageId: string, storage = browserLocalStorage(), now = Date.now()): PendingPrompt | undefined {
  return loadPendingPrompts(sessionKey, storage).find((entry) => entry.clientMessageId === clientMessageId)
    ?? loadReserve(sessionKey, storage, now).find((entry) => entry.clientMessageId === clientMessageId);
}

/**
 * The message is over for this device - taken, taken back, or cancelled: its record goes from
 * the outbox and the reserve, and so does a take-back still waiting for it. Returns its words.
 */
export function retireMessage(sessionKey: string, clientMessageId: string, storage = browserLocalStorage(), now = Date.now()): PendingPrompt | undefined {
  const words = heldWords(sessionKey, clientMessageId, storage, now);
  const remaining = loadPendingPrompts(sessionKey, storage).filter((entry) => entry.clientMessageId !== clientMessageId && entry.takeBackOf !== clientMessageId);
  writeOutbox(sessionKey, remaining, storage);
  const reserved = loadReserve(sessionKey, storage, now);
  if (reserved.some((entry) => entry.clientMessageId === clientMessageId)) writeReserve(sessionKey, reserved.filter((entry) => entry.clientMessageId !== clientMessageId), storage);
  return words;
}

/**
 * The machine lost a message it had accepted (a restart before the agent read it). It goes back
 * into the log as a new operation under its own identity, which the machine admits again.
 */
export function requeueLostMessage(sessionKey: string, clientMessageId: string, storage = browserLocalStorage(), now = Date.now()): boolean {
  const reserved = loadReserve(sessionKey, storage, now);
  const lost = reserved.find((entry) => entry.clientMessageId === clientMessageId);
  if (lost === undefined) return false;
  const record: PendingPrompt = { ...lost, seq: claimSequence(sessionKey, storage) };
  Reflect.deleteProperty(record, "reservedAt");
  if (!savePendingPrompt(sessionKey, record, storage)) return false;
  writeReserve(sessionKey, reserved.filter((entry) => entry !== lost), storage);
  return true;
}

/**
 * Carry a session's outbox, reserve and operation log to its new identity: a session created in
 * this browser gets its daemon id when it starts.
 */
export function moveOutbox(fromSessionKey: string, toSessionKey: string, storage = browserLocalStorage(), now = Date.now()): void {
  if (fromSessionKey === toSessionKey) return;
  moveOperationLog(fromSessionKey, toSessionKey, storage);
  const reserved = loadReserve(fromSessionKey, storage, now);
  if (reserved.length > 0 && writeReserve(toSessionKey, [...loadReserve(toSessionKey, storage, now), ...reserved], storage)) {
    writeReserve(fromSessionKey, [], storage);
  }
  const moving = loadPendingPrompts(fromSessionKey, storage);
  if (moving.length === 0) return;
  if (writeOutbox(toSessionKey, [...loadPendingPrompts(toSessionKey, storage), ...moving], storage)) writeOutbox(fromSessionKey, [], storage);
}
