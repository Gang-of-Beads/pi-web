import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface OwnedQueueEntry {
  clientMessageId?: string;
  /** The daemon's own key for a message sent without a client id, minted when it is accepted. */
  inboxId?: string;
  lane: "steer" | "followUp";
  text: string;
  images: { type: "image"; data: string; mimeType: string }[];
  acceptedAt: string;
  /** The time the message is shown with (B5): its sender's send time, never after acceptance. */
  sentAt?: string;
  echoUserMessage: boolean;
}

/**
 * How a message is known to the inbox and to the held-steer records while pi holds it: its sender's
 * id, or a local id built from the daemon's own key. A local id starts with a space, which no
 * accepted client id can (`parseClientMessageId` trims), so it never leaves the daemon.
 */
export const LOCAL_HOLD_ID_PREFIX = " local-hold:";

export function entryKey(entry: OwnedQueueEntry): string {
  return entry.clientMessageId ?? `${LOCAL_HOLD_ID_PREFIX}${entry.inboxId ?? ""}`;
}

function keyed(entry: OwnedQueueEntry): OwnedQueueEntry {
  return entry.clientMessageId !== undefined || entry.inboxId !== undefined ? entry : { ...entry, inboxId: randomUUID() };
}

/** Where daemons before the inbox kept a session's parked prompts: inside the workspace. */
export function queueFilePath(cwd: string, sessionId: string): string {
  return join(cwd, ".pi", "queued-prompts", `${sessionId}.json`);
}

/**
 * Where a session's inbox file lives, or undefined to keep it in memory only.
 *
 * The inbox belongs to the daemon, not the workspace: every prompt passes through it, so a
 * read-only or missing workspace must not refuse prompts, and a startup scan must find every
 * waiting session without knowing its project first (ordering F8, F9).
 */
export type InboxLocation = (sessionId: string, cwd: string) => string | undefined;

export const legacyInboxLocation: InboxLocation = (sessionId, cwd) => queueFilePath(cwd, sessionId);
export const memoryInboxLocation: InboxLocation = () => undefined;

export function inboxDirectory(dataDir: string): string {
  return join(dataDir, "inbox");
}

export function dataDirInboxLocation(dataDir: string): InboxLocation {
  return (sessionId) => join(inboxDirectory(dataDir), `${sessionId}.json`);
}

export interface WaitingInbox {
  sessionId: string;
  cwd: string;
}

/** Sessions whose inbox file still holds prompts, for the daemon's startup drain. */
export async function listWaitingInboxes(dataDir: string): Promise<WaitingInbox[]> {
  const directory = inboxDirectory(dataDir);
  let names: string[];
  try { names = await readdir(directory); } catch { return []; }
  const waiting: WaitingInbox[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const stored = await readInboxFile(join(directory, name)).catch(() => undefined);
    if (stored?.cwd !== undefined && stored.entries.length + stored.handed.length > 0) waiting.push({ sessionId: name.slice(0, -".json".length), cwd: stored.cwd });
  }
  return waiting;
}

interface InboxFile { cwd?: string; entries: OwnedQueueEntry[]; handed: OwnedQueueEntry[] }

async function readInboxFile(path: string): Promise<InboxFile | undefined> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return undefined; }
  const parsed: unknown = JSON.parse(raw);
  if (Array.isArray(parsed)) return { entries: parseEntries(parsed), handed: [] };
  if (typeof parsed !== "object" || parsed === null) return { entries: [], handed: [] };
  const cwd = field(parsed, "cwd");
  return { ...(typeof cwd === "string" ? { cwd } : {}), entries: parseEntries(field(parsed, "entries")), handed: parseEntries(field(parsed, "handed")) };
}

let stagedCounter = 0;

/**
 * The daemon's own durable inbox: every prompt it accepted and pi has not read yet.
 *
 * Two lists, one record per message (state-diagram D1). `waiting` is what pi has not been given;
 * every existing reader (take, recall, clear, the handoff count, hasWaiting, resume) means that.
 * `handed` is what was given to pi and is not yet known read, refused or withdrawn: a message in
 * pi's steering lane waits there for the whole reply that pi will next poll at (B33), and a crash
 * meanwhile used to lose it. Only settle, take-back and restart touch `handed`.
 *
 * Every mutating operation is serialized per session on a promise chain: the reviewers
 * demonstrated that an open() racing a push() could persist before reading and destroy the
 * previously parked entries on disk, and that two concurrent persists sharing one staged filename
 * could commit torn bytes. One writer at a time makes both impossible by construction.
 */
export class OwnedPromptQueue {
  private readonly perSession = new Map<string, OwnedQueueEntry[]>();
  private readonly handedPerSession = new Map<string, OwnedQueueEntry[]>();
  private readonly handedFromDisk = new Set<string>();
  private readonly filePaths = new Map<string, string>();
  private readonly cwds = new Map<string, string>();
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly location: InboxLocation = legacyInboxLocation) {}

  private serialize<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(sessionId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.chains.set(sessionId, next.catch(() => undefined));
    return next;
  }

  async open(sessionId: string, cwd: string): Promise<OwnedQueueEntry[]> {
    return this.serialize(sessionId, async () => {
      const path = this.location(sessionId, cwd);
      this.cwds.set(sessionId, cwd);
      if (path !== undefined) this.filePaths.set(sessionId, path);
      const legacyPath = queueFilePath(cwd, sessionId);
      const loaded = path === undefined ? { entries: [], handed: [] } : await loadQuarantiningCorruption(path, sessionId);
      const migrated = path === undefined || path === legacyPath ? [] : (await loadQuarantiningCorruption(legacyPath, sessionId)).entries;
      const remembered = this.perSession.get(sessionId);
      const current = remembered ?? loaded.entries;
      const keptHanded = this.handedPerSession.get(sessionId);
      const handed = keptHanded ?? loaded.handed;
      if (keptHanded === undefined && handed.length > 0) this.handedFromDisk.add(sessionId);
      const knownIds = new Set(current.map((entry) => entry.clientMessageId).filter((id) => id !== undefined));
      const moved = migrated.filter((entry) => entry.clientMessageId === undefined || !knownIds.has(entry.clientMessageId));
      const merged = [...moved, ...current];
      if (moved.length > 0 || (remembered !== undefined && remembered.length !== loaded.entries.length)) await this.persist(sessionId, merged, handed);
      if (migrated.length > 0) await unlink(legacyPath).catch(() => undefined);
      this.perSession.set(sessionId, merged);
      this.handedPerSession.set(sessionId, handed);
      return [...merged];
    });
  }

  /**
   * After a restart, once the session's runtime is bound: a handed message that ended before it -
   * pi wrote it, or it was withdrawn or refused - is done, and every other one goes back to the
   * head of `waiting`, in the order it was handed. They were accepted before anything still
   * waiting. `ended` says which; only a message with its sender's id can be recognised, so one
   * without returns.
   *
   * Only a handed list read from the file at `open` is reconciled. One this process kept itself
   * belongs to a runtime whose settle paths are live, and handing it back on a rebind would run a
   * message that runtime is still reading - found over the real SDK, where a reopen of the live
   * session returned the message being answered and pi read it twice.
   */
  async returnHanded(sessionId: string, ended: (entry: OwnedQueueEntry) => boolean): Promise<{ ended: OwnedQueueEntry[]; returned: OwnedQueueEntry[] }> {
    return this.serialize(sessionId, async () => {
      if (!this.handedFromDisk.delete(sessionId)) return { ended: [], returned: [] };
      const handed = this.handedPerSession.get(sessionId) ?? [];
      if (handed.length === 0) return { ended: [], returned: [] };
      const done = handed.filter((entry) => ended(entry));
      const returned = handed.filter((entry) => !ended(entry));
      const waitingKeys = new Set((this.perSession.get(sessionId) ?? []).map(entryKey));
      const next = [...returned.filter((entry) => !waitingKeys.has(entryKey(entry))), ...(this.perSession.get(sessionId) ?? [])];
      await this.persist(sessionId, next, []);
      this.perSession.set(sessionId, next);
      this.handedPerSession.set(sessionId, []);
      return { ended: done, returned };
    });
  }

  handed(sessionId: string): OwnedQueueEntry[] {
    return [...(this.handedPerSession.get(sessionId) ?? [])];
  }

  /** A handed message pi read, refused or gave back to its sender: it is no longer the inbox's. */
  async settleHanded(sessionId: string, key: string): Promise<void> {
    return this.serialize(sessionId, async () => {
      const handed = this.handedPerSession.get(sessionId) ?? [];
      const next = handed.filter((entry) => entryKey(entry) !== key);
      if (next.length === handed.length) return;
      await this.persist(sessionId, this.perSession.get(sessionId) ?? [], next);
      this.handedPerSession.set(sessionId, next);
    });
  }

  /**
   * Whether messages wait for a session, open or not: its entries once this process opened it,
   * else its inbox file or legacy file. A file that cannot be read counts as waiting - absence
   * is not negation.
   */
  async hasWaiting(sessionId: string, cwd: string): Promise<boolean> {
    return this.serialize(sessionId, async () => {
      const remembered = this.perSession.get(sessionId);
      if (remembered !== undefined) return remembered.length + (this.handedPerSession.get(sessionId)?.length ?? 0) > 0;
      for (const path of new Set([this.location(sessionId, cwd), queueFilePath(cwd, sessionId)])) {
        if (path === undefined) continue;
        const waiting = await readInboxFile(path).then((file) => (file?.entries.length ?? 0) + (file?.handed.length ?? 0) > 0, () => true);
        if (waiting) return true;
      }
      return false;
    });
  }

  entries(sessionId: string): OwnedQueueEntry[] {
    return [...(this.perSession.get(sessionId) ?? [])];
  }

  async push(sessionId: string, cwd: string, entry: OwnedQueueEntry): Promise<void> {
    return this.serialize(sessionId, async () => {
      this.cwds.set(sessionId, cwd);
      const path = this.filePaths.get(sessionId) ?? this.location(sessionId, cwd);
      if (path !== undefined) this.filePaths.set(sessionId, path);
      const list = this.perSession.get(sessionId) ?? [];
      if (entry.clientMessageId !== undefined && list.some((queued) => queued.clientMessageId === entry.clientMessageId)) return;
      const next = [...list, keyed(entry)];
      await this.persist(sessionId, next, this.handedPerSession.get(sessionId) ?? []);
      this.perSession.set(sessionId, next);
    });
  }

  /** Take the oldest `count` entries, in acceptance order, into `handed`: the caller gives them to pi. */
  async take(sessionId: string, count: number): Promise<OwnedQueueEntry[]> {
    return this.serialize(sessionId, async () => {
      const list = this.perSession.get(sessionId) ?? [];
      const taken = list.slice(0, count);
      if (taken.length === 0) return [];
      const next = list.slice(taken.length);
      const handed = [...(this.handedPerSession.get(sessionId) ?? []), ...taken];
      await this.persist(sessionId, next, handed);
      this.perSession.set(sessionId, next);
      this.handedPerSession.set(sessionId, handed);
      return taken;
    });
  }

  /**
   * Put entries back ahead of everything waiting: the runtime was momentarily busy, or they
   * were taken back out of the runtime's own queue. They were accepted before anything still
   * here, so the head is where acceptance order puts them. They leave `handed`.
   */
  async restoreFront(sessionId: string, entries: readonly OwnedQueueEntry[]): Promise<void> {
    if (entries.length === 0) return;
    return this.serialize(sessionId, async () => {
      const restored = entries.map(keyed);
      const keys = new Set(restored.map(entryKey));
      const list = (this.perSession.get(sessionId) ?? []).filter((entry) => !keys.has(entryKey(entry)));
      const handed = (this.handedPerSession.get(sessionId) ?? []).filter((entry) => !keys.has(entryKey(entry)));
      const next = [...restored, ...list];
      await this.persist(sessionId, next, handed);
      this.perSession.set(sessionId, next);
      this.handedPerSession.set(sessionId, handed);
    });
  }

  async recall(sessionId: string, match: { clientMessageId?: string; lane?: string; text?: string }): Promise<OwnedQueueEntry | undefined> {
    return this.serialize(sessionId, async () => {
      const list = this.perSession.get(sessionId) ?? [];
      const at = list.findIndex((entry) =>
        match.clientMessageId !== undefined
          ? entry.clientMessageId === match.clientMessageId
          : (match.lane === undefined || entry.lane === match.lane) && entry.text === match.text);
      if (at === -1) return undefined;
      const taken = list[at];
      const next = [...list.slice(0, at), ...list.slice(at + 1)];
      await this.persist(sessionId, next, this.handedPerSession.get(sessionId) ?? []);
      this.perSession.set(sessionId, next);
      return taken;
    });
  }

  async clear(sessionId: string): Promise<OwnedQueueEntry[]> {
    return this.serialize(sessionId, async () => {
      const list = this.perSession.get(sessionId) ?? [];
      if (list.length > 0) await this.persist(sessionId, [], this.handedPerSession.get(sessionId) ?? []);
      this.perSession.set(sessionId, []);
      return list;
    });
  }


  private async persist(sessionId: string, entries: readonly OwnedQueueEntry[], handed: readonly OwnedQueueEntry[]): Promise<void> {
    const path = this.filePaths.get(sessionId);
    if (path === undefined) return;
    if (entries.length === 0 && handed.length === 0) {
      try {
        await unlink(path);
      } catch (error: unknown) {
        if (!isMissingFileError(error)) throw error;
      }
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    stagedCounter += 1;
    const staged = `${path}.${String(process.pid)}.${String(stagedCounter)}.tmp`;
    try {
      await writeFile(staged, JSON.stringify({ cwd: this.cwds.get(sessionId), entries, ...(handed.length === 0 ? {} : { handed }) }));
      await rename(staged, path);
    } catch (error) {
      await unlink(staged).catch(() => undefined);
      throw error;
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * A file that exists but cannot be parsed is evidence of parked prompts, not an empty queue;
 * absence is not negation. Keep the bytes for the operator and say so in the log.
 */
async function loadQuarantiningCorruption(path: string, sessionId: string): Promise<{ entries: OwnedQueueEntry[]; handed: OwnedQueueEntry[] }> {
  try {
    const file = await readInboxFile(path);
    return { entries: file?.entries ?? [], handed: file?.handed ?? [] };
  } catch {
    await rename(path, `${path}.corrupt`).catch(() => undefined);
    console.warn(`[ownedPromptQueue] corrupt queue file quarantined: ${path}.corrupt (session ${sessionId})`);
    return { entries: [], handed: [] };
  }
}

function field(value: object, name: string): unknown {
  return Reflect.get(value, name);
}

function parseEntries(value: unknown): OwnedQueueEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: OwnedQueueEntry[] = [];
  for (const item of value) {
    const raw: unknown = item;
    if (typeof raw !== "object" || raw === null) continue;
    const lane = field(raw, "lane");
    const text = field(raw, "text");
    if ((lane !== "steer" && lane !== "followUp") || typeof text !== "string") continue;
    const rawId = field(raw, "clientMessageId");
    const clientMessageId = typeof rawId === "string" ? rawId : undefined;
    const rawInboxId = field(raw, "inboxId");
    const inboxId = typeof rawInboxId === "string" ? rawInboxId : clientMessageId === undefined ? randomUUID() : undefined;
    const rawAccepted = field(raw, "acceptedAt");
    const acceptedAt = typeof rawAccepted === "string" ? rawAccepted : "";
    const rawSentAt = field(raw, "sentAt");
    const sentAt = typeof rawSentAt === "string" && Number.isFinite(Date.parse(rawSentAt)) ? rawSentAt : acceptedAt === "" ? undefined : acceptedAt;
    const rawImages = field(raw, "images");
    const images: OwnedQueueEntry["images"] = [];
    if (Array.isArray(rawImages)) {
      for (const rawImage of rawImages) {
        const image: unknown = rawImage;
        if (typeof image !== "object" || image === null) continue;
        const data = field(image, "data");
        const mimeType = field(image, "mimeType");
        if (field(image, "type") === "image" && typeof data === "string" && typeof mimeType === "string") images.push({ type: "image", data, mimeType });
      }
    }
    const echoUserMessage = field(raw, "echoUserMessage") !== false;
    entries.push({ ...(clientMessageId === undefined ? {} : { clientMessageId }), ...(inboxId === undefined ? {} : { inboxId }), lane, text, images, acceptedAt, ...(sentAt === undefined ? {} : { sentAt }), echoUserMessage });
  }
  return entries;
}
