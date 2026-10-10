import { isRecord } from "../../shared/unknownValues";
import { browserLocalStorage } from "./browserLocalStorage";

/**
 * The half-typed answer of an open extension input or editor dialog, kept in this browser so a
 * reload keeps it. Owner, 2026-10-10: drafts stay in the browser that typed them, so another
 * device does not see it. Keyed by machine + session + dialog, as a questions screen's half
 * answers are (askDrafts.ts). It goes when this page sees the dialog close. One left behind, its
 * dialog having closed while this page showed another session (a session's frames reach only the
 * page showing it) or while no page was open, is removed by the first dialog-answer read of a
 * page once it is older than 30 days.
 */

const STORAGE_PREFIX = "pi-web:dialog-answer-draft:";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
let swept = false;

function storageKey(sessionKey: string, dialogId: string): string {
  return `${STORAGE_PREFIX}${sessionKey}:${dialogId}`;
}

/** What was typed into the dialog in this browser, or undefined when nothing was. */
export function loadDialogAnswerDraft(sessionKey: string, dialogId: string, storage = browserLocalStorage()): string | undefined {
  if (!swept) {
    swept = true;
    sweep(storage, Date.now());
  }
  try {
    return textOf(storage?.getItem(storageKey(sessionKey, dialogId)));
  } catch {
    return undefined;
  }
}

/**
 * Keep what is typed into the dialog; a browser that refuses keeps nothing and the dialog still
 * works. A refused save drops the older kept answer, so a reload never shows stale text as current.
 */
export function saveDialogAnswerDraft(sessionKey: string, dialogId: string, text: string, storage = browserLocalStorage()): void {
  try {
    storage?.setItem(storageKey(sessionKey, dialogId), JSON.stringify({ text, savedAt: Date.now() }));
  } catch {
    clearDialogAnswerDraft(sessionKey, dialogId, storage);
  }
}

/** The dialog closed: what was typed into it has nothing left to wait for. */
export function clearDialogAnswerDraft(sessionKey: string, dialogId: string, storage = browserLocalStorage()): void {
  try {
    storage?.removeItem(storageKey(sessionKey, dialogId));
  } catch {
    return;
  }
}

function textOf(stored: string | null | undefined): string | undefined {
  if (stored === null || stored === undefined) return undefined;
  const record = recordOf(stored);
  const text = record?.["text"];
  return typeof text === "string" ? text : undefined;
}

function recordOf(stored: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(stored);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Remove answers older than the retention, and any this page cannot read. */
function sweep(storage: Storage | undefined, now: number): void {
  if (storage === undefined) return;
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key?.startsWith(STORAGE_PREFIX) === true);
    for (const key of keys) {
      const savedAt = recordOf(storage.getItem(key) ?? "")?.["savedAt"];
      if (typeof savedAt !== "number" || now - savedAt > RETENTION_MS) storage.removeItem(key);
    }
  } catch {
    return;
  }
}
