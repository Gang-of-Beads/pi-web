import type { PromptAttachment } from "./api";
import { isRecord } from "../../shared/unknownValues";
import { newClientMessageId } from "./messageDelivery";
import { storageFailureOf } from "./browserStoragePressure";

/** Bytes belong to an immutable operation; its outbox record owns the destination session, which may acquire a real ID after creation. */
export interface OutboxAttachmentOwner {
  machineId: string;
  cwd: string;
  clientMessageId: string;
}

export interface OutboxAttachmentRef {
  id: string;
  owner: OutboxAttachmentOwner;
  dataCharacters: number;
  count: number;
}

interface StoredAttachments {
  id: string;
  owner: OutboxAttachmentOwner;
  attachments: PromptAttachment[];
  retiredAt?: number;
}

const DATABASE_NAME = "pi-web-outbox-attachments";
const STORE_NAME = "payloads";
/** How long an unreferenced payload is kept after a sweep first found it so: long enough for a record written by another tab between its payload and its metadata. */
const RETENTION_MS = 60 * 60 * 1000;
/** A released payload is deleted after this, so a read its retiring caller started (a cancel, a take-back's words) finishes first. */
const RELEASE_DELAY_MS = 60 * 1000;
const MEMORY_CHARACTERS = 8 * 1024 * 1024;
const cached = new Map<string, StoredAttachments>();
const releasing = new Set<string>();
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
let opened: Promise<IDBDatabase | undefined> | undefined;

class OutboxAttachmentError extends Error {
  constructor() {
    super("This browser could not write to its attachment store.");
    this.name = "OutboxAttachmentError";
  }
}

/**
 * What a read of a stored payload came to. Absence is not unreadability: `absent` means this
 * browser's attachment store answered and has no such payload (it was cleared or evicted), so the
 * bytes will never come back; `unreadable` means the store could not answer now (closed connection,
 * failed transaction) and a later read may succeed.
 */
export type OutboxAttachmentRead =
  | { readonly kind: "found"; readonly attachments: PromptAttachment[] }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable" };

export function isOutboxAttachmentRef(value: unknown): value is OutboxAttachmentRef {
  return isRecord(value) && typeof value["id"] === "string" && isOwner(value["owner"])
    && typeof value["dataCharacters"] === "number" && Number.isSafeInteger(value["dataCharacters"]) && value["dataCharacters"] >= 0
    && typeof value["count"] === "number" && Number.isSafeInteger(value["count"]) && value["count"] > 0;
}

export function attachmentOwnerMatches(left: OutboxAttachmentOwner, right: OutboxAttachmentOwner): boolean {
  return left.machineId === right.machineId && left.cwd === right.cwd && left.clientMessageId === right.clientMessageId;
}

/** Resolves only after the attachment transaction commits, before any outbox metadata or composer clearing. */
export async function saveOutboxAttachments(owner: OutboxAttachmentOwner, attachments: PromptAttachment[]): Promise<OutboxAttachmentRef> {
  const database = await openDatabase();
  if (database === undefined) throw new OutboxAttachmentError();
  const record: StoredAttachments = { id: newClientMessageId(), owner, attachments };
  await transactionWrite(database, store => { store.put(record); });
  remember(record);
  return { id: record.id, owner, count: attachments.length, dataCharacters: dataCharacters(attachments) };
}

export function peekOutboxAttachments(ref: OutboxAttachmentRef, owner: OutboxAttachmentOwner): PromptAttachment[] | undefined {
  const record = cached.get(ref.id);
  if (!matchesReference(record, ref, owner)) return undefined;
  remember(record);
  return record.attachments;
}

export async function readOutboxAttachments(ref: OutboxAttachmentRef, owner: OutboxAttachmentOwner): Promise<OutboxAttachmentRead> {
  const memory = peekOutboxAttachments(ref, owner);
  if (memory !== undefined) return { kind: "found", attachments: memory };
  const database = await openDatabase();
  if (database === undefined) return { kind: "unreadable" };
  const answer = await new Promise<{ value: unknown } | undefined>(resolve => {
    try {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(ref.id);
      request.onsuccess = () => { resolve({ value: request.result }); };
      request.onerror = () => { resolve(undefined); };
    } catch {
      opened = undefined;
      resolve(undefined);
    }
  });
  if (answer === undefined) return { kind: "unreadable" };
  if (!matchesReference(answer.value, ref, owner)) return { kind: "absent" };
  remember(answer.value);
  return { kind: "found", attachments: answer.value.attachments };
}

/**
 * The record that referenced this payload is gone (retired, withdrawn, discarded): its memory copy
 * goes now, and the bytes a little later unless a record references them again by then (a reserve
 * kept for a take-back, a lost message queued again).
 */
export function releaseOutboxAttachments(ref: OutboxAttachmentRef, referenced: () => ReadonlySet<string> | undefined): void {
  cached.delete(ref.id);
  releasing.add(ref.id);
  releaseTimer ??= setTimeout(() => {
    releaseTimer = undefined;
    const ids = [...releasing];
    releasing.clear();
    void deleteUnreferenced(ids, referenced).catch(() => { console.warn("PI WEB attachment cleanup deferred to the next sweep"); });
  }, RELEASE_DELAY_MS);
}

async function deleteUnreferenced(ids: readonly string[], referenced: () => ReadonlySet<string> | undefined): Promise<void> {
  const database = await openDatabase();
  const references = referenced();
  if (database === undefined || references === undefined) return;
  const unreferenced = ids.filter(id => !references.has(id));
  if (unreferenced.length > 0) await transactionWrite(database, store => { for (const id of unreferenced) store.delete(id); });
}

/** A failed metadata write owns this newly created payload and can remove it without touching other messages. */
export async function deleteUnwrittenOutboxAttachments(ref: OutboxAttachmentRef): Promise<void> {
  cached.delete(ref.id);
  const database = await openDatabase();
  if (database !== undefined) await transactionWrite(database, store => { store.delete(ref.id); });
}

/** What a sweep does to one payload: keep it, clear the mark of one referenced again, mark an orphan, or delete one marked long enough ago. */
type SweepVerdict = "keep" | "pin" | "mark" | "delete";

function sweepVerdict(retiredAt: number | undefined, referenced: boolean, now: number): SweepVerdict {
  if (referenced) return retiredAt === undefined ? "keep" : "pin";
  if (retiredAt === undefined) return "mark";
  return now - retiredAt >= RETENTION_MS ? "delete" : "keep";
}

const SWEEP_ACTION: Readonly<Record<SweepVerdict, (cursor: IDBCursorWithValue, value: StoredAttachments, now: number) => void>> = {
  keep: () => undefined,
  pin: (cursor, value) => {
    const pinned = { ...value };
    Reflect.deleteProperty(pinned, "retiredAt");
    cursor.update(pinned);
  },
  mark: (cursor, value, now) => { cursor.update({ ...value, retiredAt: now }); },
  delete: (cursor) => { cursor.delete(); },
};

/** Referenced payloads never expire. An orphan is marked first and deleted by a sweep at least RETENTION_MS later, so a payload whose record another tab is still writing survives. */
export async function sweepOutboxAttachments(referenced: () => ReadonlySet<string> | undefined, now = Date.now()): Promise<void> {
  const database = await openDatabase();
  if (database === undefined) return;
  const references = referenced();
  if (references === undefined) return;
  await transactionWrite(database, store => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) return;
      const value: unknown = cursor.value;
      if (isStoredAttachments(value)) SWEEP_ACTION[sweepVerdict(value.retiredAt, references.has(value.id), now)](cursor, value, now);
      cursor.continue();
    };
  });
}

function openDatabase(): Promise<IDBDatabase | undefined> {
  opened ??= new Promise(resolve => {
    try {
      if (typeof indexedDB === "undefined") { resolve(undefined); return; }
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE_NAME, { keyPath: "id" }); };
      request.onerror = () => { opened = undefined; resolve(undefined); };
      request.onblocked = () => { opened = undefined; resolve(undefined); };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); opened = undefined; };
        database.onclose = () => { opened = undefined; };
        resolve(database);
      };
    } catch { opened = undefined; resolve(undefined); }
  });
  return opened;
}

function transactionWrite(database: IDBDatabase, write: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.oncomplete = () => { resolve(); };
      transaction.onerror = transaction.onabort = () => {
        console.warn("PI WEB attachment storage write refused", { failure: storageFailureOf(transaction.error) });
        reject(new OutboxAttachmentError());
      };
      write(transaction.objectStore(STORE_NAME));
    } catch (error) {
      opened = undefined;
      console.warn("PI WEB attachment storage unavailable", { failure: storageFailureOf(error) });
      reject(new OutboxAttachmentError());
    }
  });
}

function remember(record: StoredAttachments): void {
  cached.delete(record.id);
  cached.set(record.id, record);
  let characters = [...cached.values()].reduce((total, entry) => total + dataCharacters(entry.attachments), 0);
  while (cached.size > 1 && characters > MEMORY_CHARACTERS) {
    const oldest = cached.values().next().value;
    if (oldest === undefined) return;
    cached.delete(oldest.id);
    characters -= dataCharacters(oldest.attachments);
  }
}

function dataCharacters(attachments: readonly PromptAttachment[]): number {
  return attachments.reduce((total, attachment) => total + attachment.data.length, 0);
}

function matchesReference(value: unknown, ref: OutboxAttachmentRef, owner: OutboxAttachmentOwner): value is StoredAttachments {
  return isStoredAttachments(value) && value.id === ref.id && attachmentOwnerMatches(value.owner, owner)
    && attachmentOwnerMatches(ref.owner, owner) && value.attachments.length === ref.count && dataCharacters(value.attachments) === ref.dataCharacters;
}

function isOwner(value: unknown): value is OutboxAttachmentOwner {
  return isRecord(value) && typeof value["machineId"] === "string" && typeof value["cwd"] === "string" && typeof value["clientMessageId"] === "string";
}

function isStoredAttachments(value: unknown): value is StoredAttachments {
  return isRecord(value) && typeof value["id"] === "string" && isOwner(value["owner"])
    && Array.isArray(value["attachments"]) && value["attachments"].every(attachment => isRecord(attachment)
      && (attachment["kind"] === "image" || attachment["kind"] === "file") && typeof attachment["data"] === "string" && typeof attachment["mimeType"] === "string");
}
