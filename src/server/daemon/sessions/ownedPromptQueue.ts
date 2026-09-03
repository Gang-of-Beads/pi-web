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

export class OwnedPromptQueue {
  private readonly perSession = new Map<string, OwnedQueueEntry[]>();
  private readonly filePaths = new Map<string, string>();

  async open(sessionId: string, cwd: string): Promise<OwnedQueueEntry[]> {
    const path = queueFilePath(cwd, sessionId);
    this.filePaths.set(sessionId, path);
    try {
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      const entries = parseEntries(parsed);
      this.perSession.set(sessionId, entries);
      return [...entries];
    } catch {
      this.perSession.set(sessionId, []);
      return [];
    }
  }

  entries(sessionId: string): OwnedQueueEntry[] {
    return [...(this.perSession.get(sessionId) ?? [])];
  }

  async push(sessionId: string, entry: OwnedQueueEntry): Promise<void> {
    const list = this.perSession.get(sessionId) ?? [];
    list.push(entry);
    this.perSession.set(sessionId, list);
    await this.persist(sessionId);
  }

  async takeNext(sessionId: string): Promise<OwnedQueueEntry | undefined> {
    const list = this.perSession.get(sessionId) ?? [];
    const at = list.findIndex((entry) => entry.lane === "steer");
    const taken = at !== -1 ? list.splice(at, 1)[0] : list.shift();
    if (taken !== undefined) await this.persist(sessionId);
    return taken;
  }

  async recall(sessionId: string, match: { clientMessageId?: string; lane?: string; text?: string }): Promise<OwnedQueueEntry | undefined> {
    const list = this.perSession.get(sessionId) ?? [];
    const at = list.findIndex((entry) =>
      match.clientMessageId !== undefined
        ? entry.clientMessageId === match.clientMessageId
        : (match.lane === undefined || entry.lane === match.lane) && entry.text === match.text);
    if (at === -1) return undefined;
    const [taken] = list.splice(at, 1);
    await this.persist(sessionId);
    return taken;
  }

  async clear(sessionId: string): Promise<OwnedQueueEntry[]> {
    const list = this.perSession.get(sessionId) ?? [];
    this.perSession.set(sessionId, []);
    if (list.length > 0) await this.persist(sessionId);
    return list;
  }

  forgetSession(sessionId: string): void {
    this.perSession.delete(sessionId);
    this.filePaths.delete(sessionId);
  }

  private async persist(sessionId: string): Promise<void> {
    const path = this.filePaths.get(sessionId);
    if (path === undefined) return;
    const list = this.perSession.get(sessionId) ?? [];
    try {
      if (list.length === 0) {
        await unlink(path).catch(() => undefined);
        return;
      }
      await mkdir(dirname(path), { recursive: true });
      const staged = `${path}.${String(process.pid)}.tmp`;
      await writeFile(staged, JSON.stringify(list));
      await rename(staged, path);
    } catch {
      return;
    }
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
