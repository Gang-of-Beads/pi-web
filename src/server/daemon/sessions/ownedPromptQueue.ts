import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface OwnedQueueEntry {
  clientMessageId?: string;
  lane: "steer" | "followUp";
  text: string;
  images: { type: "image"; data: string; mimeType: string }[];
  acceptedAt: string;
  echoUserMessage: boolean;
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
    if (stored?.cwd !== undefined && stored.entries.length > 0) waiting.push({ sessionId: name.slice(0, -".json".length), cwd: stored.cwd });
  }
  return waiting;
}

async function readInboxFile(path: string): Promise<{ cwd?: string; entries: OwnedQueueEntry[] } | undefined> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return undefined; }
  const parsed: unknown = JSON.parse(raw);
  if (Array.isArray(parsed)) return { entries: parseEntries(parsed) };
  if (typeof parsed !== "object" || parsed === null) return { entries: [] };
  const cwd = field(parsed, "cwd");
  return { ...(typeof cwd === "string" ? { cwd } : {}), entries: parseEntries(field(parsed, "entries")) };
}

let stagedCounter = 0;

/**
 * The daemon's own durable parking lot for prompts accepted while the runtime
 * is busy. Every mutating operation is serialized per session on a promise
 * chain: the reviewers demonstrated that an open() racing a push() could
 * persist before reading and destroy the previously parked entries on disk,
 * and that two concurrent persists sharing one staged filename could commit
 * torn bytes. One writer at a time makes both impossible by construction.
 */
export class OwnedPromptQueue {
  private readonly perSession = new Map<string, OwnedQueueEntry[]>();
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
      const loaded = path === undefined ? [] : await loadQuarantiningCorruption(path, sessionId);
      const migrated = path === undefined || path === legacyPath ? [] : await loadQuarantiningCorruption(legacyPath, sessionId);
      const merged = [...migrated, ...loaded, ...(this.perSession.get(sessionId) ?? [])].reduce<OwnedQueueEntry[]>(
        (kept, entry) => kept.some((known) => sameEntry(known, entry)) ? kept : [...kept, entry],
        [],
      );
      if (merged.length !== loaded.length) await this.persist(sessionId, merged);
      if (migrated.length > 0) await unlink(legacyPath).catch(() => undefined);
      this.perSession.set(sessionId, merged);
      return [...merged];
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
      const next = [...list, entry];
      await this.persist(sessionId, next);
      this.perSession.set(sessionId, next);
    });
  }

  /** Take the oldest `count` entries, in acceptance order. */
  async take(sessionId: string, count: number): Promise<OwnedQueueEntry[]> {
    return this.serialize(sessionId, async () => {
      const list = this.perSession.get(sessionId) ?? [];
      const taken = list.slice(0, count);
      if (taken.length === 0) return [];
      const next = list.slice(taken.length);
      await this.persist(sessionId, next);
      this.perSession.set(sessionId, next);
      return taken;
    });
  }

  /**
   * Put entries back ahead of everything waiting: the runtime was momentarily busy, or they
   * were taken back out of the runtime's own queue. They were accepted before anything still
   * here, so the head is where acceptance order puts them.
   */
  async restoreFront(sessionId: string, entries: readonly OwnedQueueEntry[]): Promise<void> {
    if (entries.length === 0) return;
    return this.serialize(sessionId, async () => {
      const list = this.perSession.get(sessionId) ?? [];
      const next = [...entries, ...list];
      await this.persist(sessionId, next);
      this.perSession.set(sessionId, next);
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
      await this.persist(sessionId, next);
      this.perSession.set(sessionId, next);
      return taken;
    });
  }

  async clear(sessionId: string): Promise<OwnedQueueEntry[]> {
    return this.serialize(sessionId, async () => {
      const list = this.perSession.get(sessionId) ?? [];
      if (list.length > 0) await this.persist(sessionId, []);
      this.perSession.set(sessionId, []);
      return list;
    });
  }


  private async persist(sessionId: string, entries: readonly OwnedQueueEntry[]): Promise<void> {
    const path = this.filePaths.get(sessionId);
    if (path === undefined) return;
    if (entries.length === 0) {
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
      await writeFile(staged, JSON.stringify({ cwd: this.cwds.get(sessionId), entries }));
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

function anonymousKey(entry: OwnedQueueEntry): string {
  return `${entry.lane}\u0000${entry.text}\u0000${entry.acceptedAt}`;
}

function sameEntry(a: OwnedQueueEntry, b: OwnedQueueEntry): boolean {
  if (a.clientMessageId !== undefined || b.clientMessageId !== undefined) return a.clientMessageId === b.clientMessageId;
  return anonymousKey(a) === anonymousKey(b);
}

/**
 * A file that exists but cannot be parsed is evidence of parked prompts, not an empty queue;
 * absence is not negation. Keep the bytes for the operator and say so in the log.
 */
async function loadQuarantiningCorruption(path: string, sessionId: string): Promise<OwnedQueueEntry[]> {
  try {
    return (await readInboxFile(path))?.entries ?? [];
  } catch {
    await rename(path, `${path}.corrupt`).catch(() => undefined);
    console.warn(`[ownedPromptQueue] corrupt queue file quarantined: ${path}.corrupt (session ${sessionId})`);
    return [];
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
    const rawAccepted = field(raw, "acceptedAt");
    const acceptedAt = typeof rawAccepted === "string" ? rawAccepted : "";
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
    entries.push({ ...(clientMessageId === undefined ? {} : { clientMessageId }), lane, text, images, acceptedAt, echoUserMessage });
  }
  return entries;
}
