import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface OwnedQueueEntry {
  clientMessageId?: string;
  lane: "steer" | "followUp";
  text: string;
  images: { type: "image"; data: string; mimeType: string }[];
  acceptedAt: string;
  echoUserMessage: boolean;
}

export function queueFilePath(cwd: string, sessionId: string): string {
  return join(cwd, ".pi", "queued-prompts", `${sessionId}.json`);
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
  private readonly chains = new Map<string, Promise<unknown>>();

  private serialize<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(sessionId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.chains.set(sessionId, next.catch(() => undefined));
    return next;
  }

  async open(sessionId: string, cwd: string): Promise<OwnedQueueEntry[]> {
    return this.serialize(sessionId, async () => {
      const path = queueFilePath(cwd, sessionId);
      this.filePaths.set(sessionId, path);
      let loaded: OwnedQueueEntry[] = [];
      let raw: string | undefined;
      try {
        raw = await readFile(path, "utf8");
      } catch {
        raw = undefined;
      }
      if (raw !== undefined) {
        try {
          loaded = parseEntries(JSON.parse(raw));
        } catch {
          // A file that exists but cannot be parsed is evidence of parked
          // prompts, not an empty queue; absence is not negation. Keep the
          // bytes for the operator and say so in the log.
          await rename(path, `${path}.corrupt`).catch(() => undefined);
          console.warn(`[ownedPromptQueue] corrupt queue file quarantined: ${path}.corrupt (session ${sessionId})`);
          loaded = [];
        }
      }
      const inMemory = this.perSession.get(sessionId) ?? [];
      const knownIds = new Set(inMemory.map((entry) => entry.clientMessageId).filter((id) => id !== undefined));
      const knownAnonymous = new Set(inMemory.filter((entry) => entry.clientMessageId === undefined).map((entry) => anonymousKey(entry)));
      const merged = [
        ...loaded.filter((entry) => entry.clientMessageId === undefined ? !knownAnonymous.has(anonymousKey(entry)) : !knownIds.has(entry.clientMessageId)),
        ...inMemory,
      ];
      if (merged.length !== loaded.length) await this.persist(sessionId, merged);
      this.perSession.set(sessionId, merged);
      return [...merged];
    });
  }

  entries(sessionId: string): OwnedQueueEntry[] {
    return [...(this.perSession.get(sessionId) ?? [])];
  }

  async push(sessionId: string, cwd: string, entry: OwnedQueueEntry): Promise<void> {
    return this.serialize(sessionId, async () => {
      if (!this.filePaths.has(sessionId)) this.filePaths.set(sessionId, queueFilePath(cwd, sessionId));
      const list = this.perSession.get(sessionId) ?? [];
      if (entry.clientMessageId !== undefined && list.some((queued) => queued.clientMessageId === entry.clientMessageId)) return;
      const next = [...list, entry];
      await this.persist(sessionId, next);
      this.perSession.set(sessionId, next);
    });
  }

  async takeNext(sessionId: string): Promise<OwnedQueueEntry | undefined> {
    return this.serialize(sessionId, async () => {
      const list = this.perSession.get(sessionId) ?? [];
      const at = list.findIndex((entry) => entry.lane === "steer");
      if (at === -1 && list.length === 0) return undefined;
      const index = at === -1 ? 0 : at;
      const taken = list[index];
      const next = [...list.slice(0, index), ...list.slice(index + 1)];
      await this.persist(sessionId, next);
      this.perSession.set(sessionId, next);
      return taken;
    });
  }

  /** Put a taken entry back at the head: the runtime refused its submission. */
  async restore(sessionId: string, entry: OwnedQueueEntry): Promise<void> {
    return this.serialize(sessionId, async () => {
      const list = this.perSession.get(sessionId) ?? [];
      const next = [entry, ...list];
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

  forgetSession(sessionId: string): void {
    this.perSession.delete(sessionId);
    this.filePaths.delete(sessionId);
    this.chains.delete(sessionId);
  }

  private async persist(sessionId: string, entries: readonly OwnedQueueEntry[]): Promise<void> {
    const path = this.filePaths.get(sessionId);
    if (path === undefined) throw new Error(`No queue path registered for session ${sessionId}`);
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
      await writeFile(staged, JSON.stringify(entries));
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
