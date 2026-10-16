import type { PromptAttachment } from "./api";
import { loadComposerAttachments, saveComposerAttachments } from "./composerAttachmentStore";
import { newClientMessageId } from "./messageDelivery";
import type { CapturedAttachment } from "./promptAttachmentCapture";
import { capturedAttachmentOf, type AttachmentShortfall } from "./returnedAttachments";

const PROMPT_HISTORY_LIMIT = 50;
const PROMPT_HISTORY_PREFIX = "pi-web:prompt-history:";
/**
 * How much of a session's history keeps its attachments' bytes (r64, a conservative first bound
 * the owner may change): the newest five entries with attachments, at most 8 MiB of their base64
 * together, and always the newest one whatever its size. An older entry keeps its text and says
 * how many attachments it had; only the bytes go.
 */
const KEPT_ATTACHMENT_ENTRIES = 5;
const KEPT_ATTACHMENT_CHARACTERS = 8 * 1024 * 1024;
/** This page's copy of the kept bytes, so a recall needs no IndexedDB read and works without it. */
const MEMORY_CHARACTERS = 16 * 1024 * 1024;

/**
 * What a remembered input carried besides its words. `stored`: the bytes are in this browser
 * (composerAttachmentStore, under the session's own key); `dropped`: the bound let them go and
 * only their number is left; `transcript`: an entry from the session's own messages, whose images
 * the transcript in hand still holds - never written to storage.
 */
export type HistoryAttachments =
  | { kept: "stored"; id: string; count: number; characters: number }
  | { kept: "dropped"; count: number }
  | { kept: "transcript"; attachments: PromptAttachment[] };

/** One remembered input. An input of attachments alone has empty text and is remembered too. */
export interface PromptHistoryEntry {
  text: string;
  attachments?: HistoryAttachments;
}

export function promptHistoryKey(sessionKey: string): string {
  return `${PROMPT_HISTORY_PREFIX}${sessionKey}`;
}

/** Entries written before attachments were remembered are plain strings and read as text alone. */
export function loadPromptHistory(sessionKey: string): PromptHistoryEntry[] {
  try {
    const raw = localStorage.getItem(promptHistoryKey(sessionKey));
    if (raw === null || raw === "") return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.flatMap(parseEntry) : [];
  } catch {
    return [];
  }
}

export function savePromptHistory(sessionKey: string, values: readonly PromptHistoryEntry[]): void {
  try {
    localStorage.setItem(promptHistoryKey(sessionKey), JSON.stringify(values.slice(0, PROMPT_HISTORY_LIMIT)));
  } catch {
    // Best-effort local convenience only.
  }
}

/**
 * Remember an input, newest first. Text alone replaces an earlier entry of the same words; an
 * input with attachments is always its own entry, its bytes kept within the bound above.
 */
export function rememberPromptHistory(sessionKey: string, prompt: string, attachments: readonly CapturedAttachment[] = []): PromptHistoryEntry[] {
  const text = prompt.trim();
  const current = loadPromptHistory(sessionKey);
  if (text === "" && attachments.length === 0) return current;
  const entry: PromptHistoryEntry = attachments.length === 0 ? { text } : { text, attachments: storeAttachments(sessionKey, attachments) };
  const next = boundAttachments(sessionKey, [entry, ...current.filter((earlier) => earlier.attachments !== undefined || entry.attachments !== undefined || earlier.text !== text)]);
  for (const evicted of next.slice(PROMPT_HISTORY_LIMIT)) forgetAttachments(sessionKey, evicted.attachments);
  const kept = next.slice(0, PROMPT_HISTORY_LIMIT);
  savePromptHistory(sessionKey, kept);
  return kept;
}

export interface RecalledAttachments {
  attachments: CapturedAttachment[];
  shortfall?: AttachmentShortfall;
}

/** The attachments a history entry brings back, or how many it cannot. */
export async function recallPromptHistoryAttachments(sessionKey: string, entry: PromptHistoryEntry): Promise<RecalledAttachments> {
  const attachments = entry.attachments;
  if (attachments === undefined) return { attachments: [] };
  if (attachments.kept === "transcript") return { attachments: attachments.attachments.map(capturedAttachmentOf) };
  if (attachments.kept === "dropped") return { attachments: [], shortfall: { missing: attachments.count, unknown: false } };
  const key = payloadKey(sessionKey, attachments.id);
  const found = memory.get(key) ?? await loadComposerAttachments(key).catch(() => undefined);
  if (found?.length !== attachments.count) return { attachments: [], shortfall: { missing: attachments.count, unknown: false } };
  remember(key, found);
  return { attachments: [...found] };
}

/** How the history sheet names an entry's attachments; undefined for words alone. */
export function historyAttachmentLabel(entry: PromptHistoryEntry): string | undefined {
  const attachments = entry.attachments;
  if (attachments === undefined) return undefined;
  const count = attachments.kept === "transcript" ? attachments.attachments.length : attachments.count;
  const label = `${String(count)} attachment${count === 1 ? "" : "s"}`;
  return attachments.kept === "dropped" ? `${label}, no longer kept` : label;
}

export function searchPromptHistory(sessionKey: string, query: string, sessionPrompts: readonly PromptHistoryEntry[] = []): PromptHistoryEntry[] {
  const local = loadPromptHistory(sessionKey);
  // The session's own user messages are the same history arrived by another
  // door; a fresh browser has an empty local list and still deserves them.
  const history = [...local, ...sessionPrompts.filter((entry) => entry.text === "" || !local.some((own) => own.text === entry.text))];
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return history;
  const tokens = normalized.split(/\s+/u).filter(Boolean);
  return filterPromptHistory(history, tokens);
}

const memory = new Map<string, readonly CapturedAttachment[]>();

function payloadKey(sessionKey: string, id: string): string {
  return `${promptHistoryKey(sessionKey)}#${id}`;
}

function storeAttachments(sessionKey: string, attachments: readonly CapturedAttachment[]): HistoryAttachments {
  const id = newClientMessageId();
  const kept = attachments.map(({ kind, name, mimeType, data, size }): CapturedAttachment => ({ kind, name, mimeType, data, size }));
  remember(payloadKey(sessionKey, id), kept);
  saveComposerAttachments(payloadKey(sessionKey, id), kept);
  return { kept: "stored", id, count: kept.length, characters: characters(kept) };
}

/** Walk newest to oldest: the first entries within the bound keep their bytes, the rest give them up. */
function boundAttachments(sessionKey: string, entries: readonly PromptHistoryEntry[]): PromptHistoryEntry[] {
  let keptEntries = 0;
  let keptCharacters = 0;
  return entries.map((entry) => {
    const attachments = entry.attachments;
    if (attachments?.kept !== "stored") return entry;
    const fits = keptEntries === 0 || (keptEntries < KEPT_ATTACHMENT_ENTRIES && keptCharacters + attachments.characters <= KEPT_ATTACHMENT_CHARACTERS);
    if (fits) {
      keptEntries += 1;
      keptCharacters += attachments.characters;
      return entry;
    }
    forgetAttachments(sessionKey, attachments);
    return { text: entry.text, attachments: { kept: "dropped", count: attachments.count } };
  });
}

function forgetAttachments(sessionKey: string, attachments: HistoryAttachments | undefined): void {
  if (attachments?.kept !== "stored") return;
  const key = payloadKey(sessionKey, attachments.id);
  memory.delete(key);
  saveComposerAttachments(key, []);
}

function remember(key: string, attachments: readonly CapturedAttachment[]): void {
  memory.delete(key);
  memory.set(key, attachments);
  let total = [...memory.values()].reduce((sum, entry) => sum + characters(entry), 0);
  for (const [oldest, entry] of memory) {
    if (memory.size <= 1 || total <= MEMORY_CHARACTERS) return;
    memory.delete(oldest);
    total -= characters(entry);
  }
}

function characters(attachments: readonly CapturedAttachment[]): number {
  return attachments.reduce((total, attachment) => total + attachment.data.length, 0);
}

function parseEntry(value: unknown): PromptHistoryEntry[] {
  if (typeof value === "string") return value.trim() === "" ? [] : [{ text: value }];
  if (typeof value !== "object" || value === null) return [];
  const text: unknown = Reflect.get(value, "text");
  const attachments = parseStoredAttachments(Reflect.get(value, "attachments"));
  if (typeof text !== "string" || (text.trim() === "" && attachments === undefined)) return [];
  return [attachments === undefined ? { text } : { text, attachments }];
}

function parseStoredAttachments(value: unknown): HistoryAttachments | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const kept: unknown = Reflect.get(value, "kept");
  const count: unknown = Reflect.get(value, "count");
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count <= 0) return undefined;
  if (kept === "dropped") return { kept, count };
  const id: unknown = Reflect.get(value, "id");
  const size: unknown = Reflect.get(value, "characters");
  return kept === "stored" && typeof id === "string" && typeof size === "number" ? { kept, id, count, characters: size } : undefined;
}

function filterPromptHistory(history: readonly PromptHistoryEntry[], tokens: readonly string[]): PromptHistoryEntry[] {
  return history.filter((entry) => {
    const haystack = entry.text.toLowerCase();
    return tokens.every((token) => haystack.includes(token) || isSubsequence(token, haystack));
  });
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const character of needle) {
    index = haystack.indexOf(character, index);
    if (index === -1) return false;
    index += character.length;
  }
  return true;
}

/**
 * Which way through history a key moves.
 *
 * Named rather than passed as +1/-1 because the two are easy to swap and the
 * result still looks plausible: ArrowUp reached the most recent entry and then
 * appeared to stop, while ArrowDown walked backwards through time. Every shell,
 * and pi's own terminal UI, treat Up as "further back".
 */
export type HistoryDirection = "older" | "newer";

/** Index 0 is the most recent entry, so going older means counting up. */
export function historyIndexStep(direction: HistoryDirection): 1 | -1 {
  return direction === "older" ? 1 : -1;
}
