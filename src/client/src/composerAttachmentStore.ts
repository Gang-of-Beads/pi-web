import { isRecord } from "../../shared/unknownValues";
import type { CapturedAttachment } from "./promptAttachmentCapture";

/**
 * This browser's copy of each session's unsent composer attachments, so a reload keeps them.
 *
 * Owner, D2 (2026-10-10): the attachments of an unsent message are not merged between devices;
 * they stay in the browser that added them, while the composer's text follows the session
 * through its daemon (server drafts, slice 1). Images run to megabytes, which local storage
 * cannot hold, so they live in IndexedDB, one record per machine + session key. A browser
 * without IndexedDB, or one that refuses it, keeps them in memory only, as before. A record
 * untouched for 30 days is removed when the database opens, the retention a draft on the
 * daemon has.
 */

const DATABASE_NAME = "pi-web-composer-attachments";
const STORE_NAME = "attachments";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

let opened: Promise<IDBDatabase | undefined> | undefined;

/** The attachments this browser keeps for a session: none when it keeps none, undefined when its record cannot be read, and of a record, only the items that read as attachments. */
export async function loadComposerAttachments(key: string): Promise<CapturedAttachment[] | undefined> {
  const database = await openDatabase();
  if (database === undefined) return undefined;
  const record = await new Promise<{ readonly value: unknown } | undefined>((resolve) => {
    try {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => { resolve({ value: request.result }); };
      request.onerror = () => { resolve(undefined); };
    } catch {
      resolve(undefined);
    }
  });
  if (record === undefined) return undefined;
  if (record.value === undefined) return [];
  const attachments = isRecord(record.value) ? record.value["attachments"] : undefined;
  return Array.isArray(attachments) ? attachments.filter(isCapturedAttachment) : undefined;
}

/** Keep a session's unsent attachments in this browser; none removes its record. A write the browser refuses leaves them in memory only. */
export function saveComposerAttachments(key: string, attachments: readonly CapturedAttachment[]): void {
  void openDatabase()
    .then((database) => { if (database !== undefined) writeRecord(database, key, attachments); })
    .catch(() => undefined);
}

function writeRecord(database: IDBDatabase, key: string, attachments: readonly CapturedAttachment[]): void {
  const store = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
  if (attachments.length === 0) store.delete(key);
  else store.put({ key, attachments: [...attachments], updatedAt: Date.now() });
}

function openDatabase(): Promise<IDBDatabase | undefined> {
  opened ??= new Promise((resolve) => {
    const request = openRequest();
    if (request === undefined) {
      resolve(undefined);
      return;
    }
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE_NAME, { keyPath: "key" }); };
    request.onsuccess = () => {
      sweep(request.result, Date.now());
      resolve(request.result);
    };
    request.onerror = () => { resolve(undefined); };
  });
  return opened;
}

function openRequest(): IDBOpenDBRequest | undefined {
  try {
    return typeof indexedDB === "undefined" ? undefined : indexedDB.open(DATABASE_NAME, 1);
  } catch {
    return undefined;
  }
}

/** Remove records untouched for the retention, and any this page cannot read. */
function sweep(database: IDBDatabase, now: number): void {
  let request: IDBRequest<IDBCursorWithValue | null>;
  try {
    request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).openCursor();
  } catch {
    return;
  }
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor === null) return;
    const value: unknown = cursor.value;
    const updatedAt = isRecord(value) ? value["updatedAt"] : undefined;
    if (typeof updatedAt !== "number" || now - updatedAt > RETENTION_MS) cursor.delete();
    cursor.continue();
  };
}

function isCapturedAttachment(value: unknown): value is CapturedAttachment {
  return isRecord(value)
    && (value["kind"] === "image" || value["kind"] === "file")
    && typeof value["name"] === "string"
    && typeof value["mimeType"] === "string"
    && typeof value["data"] === "string"
    && typeof value["size"] === "number";
}
