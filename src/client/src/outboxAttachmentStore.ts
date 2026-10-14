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
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MEMORY_CHARACTERS = 8 * 1024 * 1024;
const cached = new Map<string, StoredAttachments>();
let opened: Promise<IDBDatabase | undefined> | undefined;

export class OutboxAttachmentError extends Error {
  constructor() {
    super("This browser could not keep or restore the message attachments. The message was not sent.");
    this.name = "OutboxAttachmentError";
  }
}

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

export async function readOutboxAttachments(ref: OutboxAttachmentRef, owner: OutboxAttachmentOwner): Promise<PromptAttachment[]> {
  const memory = peekOutboxAttachments(ref, owner);
  if (memory !== undefined) return memory;
  const database = await openDatabase();
  if (database === undefined) throw new OutboxAttachmentError();
  const value = await new Promise<unknown>(resolve => {
    try {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(ref.id);
      request.onsuccess = () => { resolve(request.result); };
      request.onerror = () => { resolve(undefined); };
    } catch { resolve(undefined); }
  });
  if (!matchesReference(value, ref, owner)) throw new OutboxAttachmentError();
  remember(value);
  return value.attachments;
}

export function forgetOutboxAttachmentMemory(ref: OutboxAttachmentRef): void {
  cached.delete(ref.id);
}

/** A failed metadata write owns this newly created payload and can remove it without touching other messages. */
export async function deleteUnwrittenOutboxAttachments(ref: OutboxAttachmentRef): Promise<void> {
  cached.delete(ref.id);
  const database = await openDatabase();
  if (database !== undefined) await transactionWrite(database, store => { store.delete(ref.id); });
}

/** Referenced payloads never expire. An orphan first enters a 30-day retirement window, so a return to the composer cannot race immediate deletion. */
export async function sweepOutboxAttachments(referenced: () => ReadonlySet<string> | undefined, now = Date.now()): Promise<void> {
  const database = await openDatabase();
  if (database === undefined) return;
  await transactionWrite(database, store => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor === null) return;
      const value: unknown = cursor.value;
      const references = referenced();
      if (isStoredAttachments(value) && references !== undefined) {
        const retained = references.has(value.id);
        if (retained && value.retiredAt !== undefined) {
          const pinned = { ...value };
          Reflect.deleteProperty(pinned, "retiredAt");
          cursor.update(pinned);
        } else if (!retained && value.retiredAt === undefined) cursor.update({ ...value, retiredAt: now });
        else if (!retained && value.retiredAt !== undefined && now - value.retiredAt >= RETENTION_MS) cursor.delete();
      }
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
