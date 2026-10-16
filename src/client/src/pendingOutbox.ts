import { browserLocalStorage } from "./browserLocalStorage";
import type { PromptAttachment } from "./api";
import type { PromptAttachmentDelivery } from "../../shared/apiTypes";
import { forgetAckedThrough, moveAckedThrough } from "./operationLog";
import { machineSessionKey } from "./machineKeys";
import { writeEssentialBrowserRecord } from "./browserStoragePressure";
import { isAttachmentShortfall, type AttachmentShortfall } from "./returnedAttachments";
import { attachmentOwnerMatches, deleteUnwrittenOutboxAttachments, forgetOutboxAttachmentMemory, isOutboxAttachmentRef, peekOutboxAttachments, readOutboxAttachments, saveOutboxAttachments, type OutboxAttachmentOwner, type OutboxAttachmentRef } from "./outboxAttachmentStore";

/**
 * The outbox: this browser's operations on a session that the machine has not answered yet, in
 * the order they were written (docs/design/message-states.md, "Devices" and "Operations").
 *
 * Every operation is its own stored record, never one array rewritten: appending writes a new key
 * and an answer deletes its own key, so two tabs writing at once never overwrite each other. A
 * session's outbox is its records sorted by key, which begins with the write time. Each record
 * carries the scope it belongs to - machine, session, cwd - so it is sent wherever the reader is.
 *
 * A message never fails: it leaves when the machine answers it - accepted, taken back, or refused
 * for good (then cancelled, words back in the composer). Only a write to this browser's storage
 * can fail, and the writers say so to their callers.
 */

const OUTBOX_PREFIX = "pi-web:outbox:";
const RESERVE_PREFIX = "pi-web:accepted:";
const ORDER_MARK = "#";

export type OperationKind = "message" | "takeBack" | "command" | "shell";

/** The machine, session and folder an operation was written for. */
export interface OperationScope {
  machineId: string;
  sessionId: string;
  cwd: string;
}

export interface PendingPrompt {
  kind: OperationKind;
  /** The operation's identity, the same through every resend. */
  clientMessageId: string;
  scope: OperationScope;
  text: string;
  behavior?: "steer" | "followUp";
  /** A take-back's message. */
  takeBackOf?: string;
  /** A take-back whose words already went back to the composer: the message was withdrawn on this browser. */
  wordsReturned?: true;
  /** A take-back of a message whose attachments this browser has no copy of: said when its words come back. */
  shortfall?: AttachmentShortfall;
  attachments?: PromptAttachment[];
  attachmentRef?: OutboxAttachmentRef;
  delivery?: PromptAttachmentDelivery;
  at: string;
  /** Its number in the last batch that carried it. */
  seq?: number;
  /** Where it sorts in its outbox; part of its storage key. */
  order: string;
}

const KINDS: ReadonlySet<string> = new Set<OperationKind>(["message", "takeBack", "command", "shell"]);

function isScope(value: unknown): value is OperationScope {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "machineId") === "string" && typeof Reflect.get(value, "sessionId") === "string" && typeof Reflect.get(value, "cwd") === "string";
}

function isPendingPrompt(value: unknown): value is PendingPrompt {
  if (value === null || typeof value !== "object") return false;
  const kind: unknown = Reflect.get(value, "kind");
  const scope: unknown = Reflect.get(value, "scope");
  const clientMessageId: unknown = Reflect.get(value, "clientMessageId");
  const ref: unknown = Reflect.get(value, "attachmentRef");
  const shortfall: unknown = Reflect.get(value, "shortfall");
  if (typeof kind !== "string" || !KINDS.has(kind) || typeof Reflect.get(value, "text") !== "string" || typeof clientMessageId !== "string" || typeof Reflect.get(value, "order") !== "string" || !isScope(scope)) return false;
  if (shortfall !== undefined && !isAttachmentShortfall(shortfall)) return false;
  return ref === undefined || (isOutboxAttachmentRef(ref) && attachmentOwnerMatches(ref.owner, { machineId: scope.machineId, cwd: scope.cwd, clientMessageId }));
}

/** Announced whenever an outbox changes in this tab; other tabs hear the storage event. */
export const OUTBOX_CHANGED_EVENT = "pi-web.outbox-changed";

function announce(sessionKey: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OUTBOX_CHANGED_EVENT, { detail: sessionKey }));
}

/** The session an outbox storage key belongs to, or undefined for any other key. */
export function outboxSessionKeyOf(storageKey: string): string | undefined {
  if (!storageKey.startsWith(OUTBOX_PREFIX)) return undefined;
  const rest = storageKey.slice(OUTBOX_PREFIX.length);
  const mark = rest.lastIndexOf(ORDER_MARK);
  return mark <= 0 ? undefined : rest.slice(0, mark);
}

function keysWithPrefix(prefix: string, storage: Storage | undefined): string[] {
  if (storage === undefined) return [];
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix) === true) keys.push(key);
  }
  return keys.sort();
}

function readRecord(key: string, storage: Storage | undefined): PendingPrompt | undefined {
  try {
    const raw = storage?.getItem(key);
    if (raw === undefined || raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isPendingPrompt(parsed)) return undefined;
    const attachments = parsed.attachmentRef === undefined ? undefined : peekOutboxAttachments(parsed.attachmentRef, attachmentOwner(parsed));
    return attachments === undefined ? parsed : { ...parsed, attachments };
  } catch {
    return undefined;
  }
}

function recordKey(sessionKey: string, record: Pick<PendingPrompt, "order">): string {
  return `${OUTBOX_PREFIX}${sessionKey}${ORDER_MARK}${record.order}`;
}

function sessionRecords(sessionKey: string, storage: Storage | undefined): PendingPrompt[] {
  return keysWithPrefix(`${OUTBOX_PREFIX}${sessionKey}${ORDER_MARK}`, storage).flatMap((key) => {
    const record = readRecord(key, storage);
    return record !== undefined && machineSessionKey(record.scope.machineId, record.scope.sessionId) === sessionKey ? [record] : [];
  });
}

/** A session's outbox, in the order it was written. */
export function loadPendingPrompts(sessionKey: string, storage = browserLocalStorage()): PendingPrompt[] {
  return sessionRecords(sessionKey, storage);
}

/** One record of a session's outbox. */
export function findOperation(sessionKey: string, clientMessageId: string, storage = browserLocalStorage()): PendingPrompt | undefined {
  return sessionRecords(sessionKey, storage).find((record) => record.clientMessageId === clientMessageId);
}

/** Every session that has an outbox in this browser. */
export function outboxSessionKeys(storage = browserLocalStorage()): string[] {
  return [...new Set(keysWithPrefix(OUTBOX_PREFIX, storage).flatMap((key) => outboxSessionKeyOf(key) ?? []))];
}

function writeRecord(sessionKey: string, record: PendingPrompt, storage: Storage | undefined): boolean {
  if (storage === undefined) return false;
  try {
    if (!writeEssentialBrowserRecord(storage, recordKey(sessionKey, record), JSON.stringify(storedRecord(record)))) return false;
    announce(sessionKey);
    return true;
  } catch {
    return false;
  }
}

let orderCounter = 0;

/** A key that sorts by write time, then by this tab's counter; the identity keeps two tabs apart. */
function nextOrder(clientMessageId: string, now: number): string {
  orderCounter += 1;
  return `${String(now).padStart(15, "0")}.${String(orderCounter).padStart(6, "0")}.${clientMessageId}`;
}

/** Write a new operation at the end of its session's outbox. Returns the record, or undefined when storage refused it. */
export function appendOperation(sessionKey: string, operation: Omit<PendingPrompt, "order">, storage = browserLocalStorage(), now = Date.now()): PendingPrompt | undefined {
  const record: PendingPrompt = { ...operation, order: nextOrder(operation.clientMessageId, now) };
  return writeRecord(sessionKey, record, storage) ? record : undefined;
}

/** Persist attachment bytes first; only a fully durable operation is announced as Sending. */
export async function appendPreparedOperation(sessionKey: string, operation: Omit<PendingPrompt, "order">, storage = browserLocalStorage()): Promise<PendingPrompt | undefined> {
  let ref = operation.attachmentRef;
  const ownsNewPayload = ref === undefined && (operation.attachments?.length ?? 0) > 0;
  // A browser without a usable IndexedDB keeps the bytes inline, as before; only what local storage cannot hold is refused.
  if (ownsNewPayload) ref = await saveOutboxAttachments(attachmentOwner(operation), operation.attachments ?? []).catch(() => undefined);
  const written = appendOperation(sessionKey, { ...operation, ...(ref === undefined ? {} : { attachmentRef: ref }) }, storage);
  if (written === undefined && ownsNewPayload && ref !== undefined) await deleteUnwrittenOutboxAttachments(ref);
  return written;
}

export async function hydratePendingPrompt(record: PendingPrompt): Promise<PendingPrompt> {
  if (record.attachmentRef === undefined) return record;
  const attachments = await readOutboxAttachments(record.attachmentRef, attachmentOwner(record));
  return { ...record, attachments };
}

/** Older inline records acquire a payload reference before their next rewrite, without discarding their existing bytes. */
export async function prepareOutboxAttachments(record: PendingPrompt): Promise<PendingPrompt> {
  if (record.attachmentRef !== undefined) return hydratePendingPrompt(record);
  if ((record.attachments?.length ?? 0) === 0) return record;
  const attachmentRef = await saveOutboxAttachments(attachmentOwner(record), record.attachments ?? []);
  return { ...record, attachmentRef };
}

export function referencedOutboxAttachments(storage = browserLocalStorage()): ReadonlySet<string> | undefined {
  if (storage === undefined) return undefined;
  const ids = new Set<string>();
  try {
    for (const key of [...keysWithPrefix(OUTBOX_PREFIX, storage), ...keysWithPrefix(RESERVE_PREFIX, storage)]) {
      const value: unknown = JSON.parse(storage.getItem(key) ?? "null");
      const ref: unknown = typeof value === "object" && value !== null ? Reflect.get(value, "attachmentRef") : undefined;
      if (ref === undefined) continue;
      if (!isOutboxAttachmentRef(ref)) return undefined;
      ids.add(ref.id);
    }
    return ids;
  } catch { return undefined; }
}

function attachmentOwner(record: Pick<PendingPrompt, "scope" | "clientMessageId">): OutboxAttachmentOwner {
  return { machineId: record.scope.machineId, cwd: record.scope.cwd, clientMessageId: record.clientMessageId };
}

function storedRecord(record: PendingPrompt): PendingPrompt {
  if (record.attachmentRef === undefined) return record;
  const stored = { ...record };
  Reflect.deleteProperty(stored, "attachments");
  return stored;
}

/** What a rewrite came to: stored, refused because the record is another operation now, or refused by storage. */
export type RewriteOutcome = "written" | "changed" | "failed";

/**
 * Rewrite one record in place (its number, its words after attachments were saved), only while it
 * is still the operation that was read: a message withdrawn meanwhile turned into its take-back
 * under the same key, here or in another tab, and a copy read before must not bring it back.
 */
export function updateOperation(sessionKey: string, record: PendingPrompt, storage = browserLocalStorage()): RewriteOutcome {
  const stored = readRecord(recordKey(sessionKey, record), storage);
  if (stored?.clientMessageId !== record.clientMessageId || stored.kind !== record.kind) return "changed";
  return writeRecord(sessionKey, record, storage) ? "written" : "failed";
}

/** A message whose files go to the workspace: they are saved, and its words rewritten with their paths, before it travels. */
export function savesFilesFirst(record: PendingPrompt): boolean {
  return record.kind === "message" && record.delivery === "folder" && (record.attachmentRef?.count ?? record.attachments?.length ?? 0) > 0;
}

/**
 * Drop everything a session held to send - its outbox, its reserve, its acknowledgements - when
 * the reader deleted it: the engine sends every outbox, and a deleted draft would otherwise start
 * again and run what the reader threw away.
 */
export function discardOutbox(sessionKey: string, storage = browserLocalStorage()): void {
  if (storage === undefined) return;
  forgetAckedThrough(sessionKey, storage);
  const keys = [...keysWithPrefix(`${OUTBOX_PREFIX}${sessionKey}${ORDER_MARK}`, storage), ...keysWithPrefix(`${RESERVE_PREFIX}${sessionKey}${ORDER_MARK}`, storage)];
  for (const key of keys) {
    const record = readRecord(key, storage);
    storage.removeItem(key);
    if (record?.attachmentRef !== undefined) forgetOutboxAttachmentMemory(record.attachmentRef);
  }
  announce(sessionKey);
}

export function forgetPendingPrompt(sessionKey: string, clientMessageId: string, storage = browserLocalStorage()): void {
  const record = sessionRecords(sessionKey, storage).find((entry) => entry.clientMessageId === clientMessageId);
  if (record === undefined || storage === undefined) return;
  try {
    storage.removeItem(recordKey(sessionKey, record));
    if (record.attachmentRef !== undefined) forgetOutboxAttachmentMemory(record.attachmentRef);
  } catch {
    return;
  }
  announce(sessionKey);
}

/** The identity of the take-back of one message. */
export function takeBackId(clientMessageId: string): string {
  return `${clientMessageId}:take-back`;
}

/**
 * Write a take-back at the end of the session's outbox. It carries the message's words, so they
 * can go back to the composer when the machine confirms. A second press finds it already written.
 */
export async function appendTakeBack(sessionKey: string, message: { clientMessageId: string; text: string; scope: OperationScope; attachments?: PromptAttachment[]; shortfall?: AttachmentShortfall; behavior?: "steer" | "followUp"; wordsReturned?: true }, storage = browserLocalStorage()): Promise<boolean> {
  const id = takeBackId(message.clientMessageId);
  if (sessionRecords(sessionKey, storage).some((entry) => entry.clientMessageId === id)) return true;
  return (await appendPreparedOperation(sessionKey, {
    kind: "takeBack",
    takeBackOf: message.clientMessageId,
    clientMessageId: id,
    scope: message.scope,
    text: message.text,
    ...(message.behavior === undefined ? {} : { behavior: message.behavior }),
    ...(message.attachments === undefined || message.attachments.length === 0 ? {} : { attachments: message.attachments }),
    ...(message.shortfall === undefined ? {} : { shortfall: message.shortfall }),
    ...(message.wordsReturned === undefined ? {} : { wordsReturned: message.wordsReturned }),
    at: new Date().toISOString(),
  }, storage)) !== undefined;
}

/**
 * Withdraw a message still in this browser's outbox (docs/design/message-states.md,
 * "Operations"): its words go back at once, and its record turns, in its place, into a take-back.
 * A batch that went unanswered may have reached the machine, and another tab may be sending it
 * this instant; the take-back reaches the machine before anything written after the message, so
 * the machine refuses the message if it never had it, recalls it if it waits, and says when the
 * agent already has it. Undefined when the message is not in the outbox - the machine answered
 * it, and only the machine can take it back.
 */
export function withdrawLocally(sessionKey: string, clientMessageId: string, storage = browserLocalStorage()): PendingPrompt | undefined {
  const record = sessionRecords(sessionKey, storage).find((entry) => entry.clientMessageId === clientMessageId && entry.kind === "message");
  if (record === undefined) return undefined;
  const takeBack: PendingPrompt = { kind: "takeBack", takeBackOf: record.clientMessageId, clientMessageId: takeBackId(record.clientMessageId), scope: record.scope, text: record.text, ...(record.behavior === undefined ? {} : { behavior: record.behavior }), wordsReturned: true, at: new Date().toISOString(), order: record.order };
  return writeRecord(sessionKey, takeBack, storage) ? record : undefined;
}

/** How long an accepted message's words are kept for a take-back or a refusal that may still come: as long as the daemon's ledger answers for it. */
const RESERVE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

interface ReservedPrompt extends PendingPrompt {
  reservedAt: string;
}

function reserveKey(sessionKey: string, clientMessageId: string): string {
  return `${RESERVE_PREFIX}${sessionKey}${ORDER_MARK}${clientMessageId}`;
}

function readReserve(key: string, storage: Storage | undefined): ReservedPrompt | undefined {
  const record = readRecord(key, storage);
  if (record === undefined) return undefined;
  const reservedAt: unknown = Reflect.get(record, "reservedAt");
  return typeof reservedAt === "string" ? { ...record, reservedAt } : undefined;
}

function sweepExpiredReserves(storage: Storage | undefined, now: number): void {
  for (const key of keysWithPrefix(RESERVE_PREFIX, storage)) {
    const reserved = readReserve(key, storage);
    if (reserved === undefined || now - Date.parse(reserved.reservedAt) >= RESERVE_KEEP_MS) storage?.removeItem(key);
  }
}

/**
 * The machine took this message: it leaves the outbox, and its words are kept aside until the
 * agent takes it, so a take-back or a runtime refusal can hand them back to the composer.
 */
export function reserveAcceptedPrompt(sessionKey: string, clientMessageId: string, storage = browserLocalStorage(), now = Date.now()): void {
  const record = sessionRecords(sessionKey, storage).find((entry) => entry.clientMessageId === clientMessageId && entry.kind === "message");
  sweepExpiredReserves(storage, now);
  if (record !== undefined) {
    try {
      if (!writeEssentialBrowserRecord(storage, reserveKey(sessionKey, clientMessageId), JSON.stringify({ ...storedRecord(record), reservedAt: new Date(now).toISOString() }))) return;
    } catch {
      return;
    }
  }
  forgetPendingPrompt(sessionKey, clientMessageId, storage);
}

/** The words of a message this browser sent, wherever they are kept. */
export function heldWords(sessionKey: string, clientMessageId: string, storage = browserLocalStorage()): PendingPrompt | undefined {
  return sessionRecords(sessionKey, storage).find((entry) => entry.clientMessageId === clientMessageId)
    ?? readReserve(reserveKey(sessionKey, clientMessageId), storage);
}

/**
 * The message is over for this browser - taken, taken back, or cancelled: its record goes from
 * the outbox and the reserve, and so does a take-back still waiting for it. Returns its words.
 */
export function retireMessage(sessionKey: string, clientMessageId: string, storage = browserLocalStorage()): PendingPrompt | undefined {
  const words = heldWords(sessionKey, clientMessageId, storage);
  for (const record of sessionRecords(sessionKey, storage)) {
    if (record.clientMessageId === clientMessageId || record.takeBackOf === clientMessageId) forgetPendingPrompt(sessionKey, record.clientMessageId, storage);
  }
  storage?.removeItem(reserveKey(sessionKey, clientMessageId));
  if (words?.attachmentRef !== undefined) forgetOutboxAttachmentMemory(words.attachmentRef);
  return words;
}

/**
 * The machine lost a message it had accepted (a restart before the agent read it). It goes back
 * into the outbox as a new operation under its own identity, which the machine admits again.
 */
export async function requeueLostMessage(sessionKey: string, clientMessageId: string, storage = browserLocalStorage()): Promise<boolean> {
  const key = reserveKey(sessionKey, clientMessageId);
  const lost = readReserve(key, storage);
  if (lost === undefined) return false;
  const operation: PendingPrompt = { ...lost };
  for (const field of ["reservedAt", "seq", "order"]) Reflect.deleteProperty(operation, field);
  if (await appendPreparedOperation(sessionKey, operation, storage) === undefined) return false;
  storage?.removeItem(key);
  return true;
}

/**
 * Carry a session's outbox, reserve and acknowledgements to its new identity: a draft gets its
 * machine id when its first operation starts it. Each record's scope names the new session.
 */
export function moveOutbox(fromSessionKey: string, toSessionKey: string, toSessionId: string, storage = browserLocalStorage()): void {
  if (fromSessionKey === toSessionKey || storage === undefined) return;
  moveAckedThrough(fromSessionKey, toSessionKey, storage);
  for (const key of keysWithPrefix(`${RESERVE_PREFIX}${fromSessionKey}${ORDER_MARK}`, storage)) {
    const reserved = readReserve(key, storage);
    if (reserved === undefined) continue;
    if (!writeEssentialBrowserRecord(storage, reserveKey(toSessionKey, reserved.clientMessageId), JSON.stringify({ ...storedRecord(reserved), scope: { ...reserved.scope, sessionId: toSessionId } }))) return;
    storage.removeItem(key);
  }
  for (const record of sessionRecords(fromSessionKey, storage)) {
    if (!writeRecord(toSessionKey, { ...record, scope: { ...record.scope, sessionId: toSessionId } }, storage)) return;
    storage.removeItem(recordKey(fromSessionKey, record));
  }
  announce(fromSessionKey);
}
