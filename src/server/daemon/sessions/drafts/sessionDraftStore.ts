import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DraftSendClaim, DraftWrite, DraftWriteAnswer, SessionDraft } from "../../../../shared/apiTypes.js";
import { isRecord } from "../../../../shared/unknownValues.js";
import { isNodeErrorWithCode } from "../../../shared/workspaces/pathSafety.js";

/** The largest draft text kept on the daemon, in UTF-8 bytes (server-drafts.md, limits). */
export const DRAFT_TEXT_MAX_BYTES = 1_000_000;
/** A draft untouched this long is removed, matching the message ledger's retention (message-states.md). */
export const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const DRAFT_FILE = "draft.json";

/** The page and the last of its writes that a send covered. */
interface SentThrough {
  readonly deviceId: string;
  readonly seq: number;
}

interface StoredDraft {
  readonly revision: number;
  readonly text: string;
  readonly deviceId: string;
  readonly seq: number;
  readonly updatedAt: string;
  readonly sentThrough?: SentThrough;
}

export class DraftRefusedError extends Error {}

/**
 * One draft per session, shared by every device (server-drafts.md, owner 2026-10-05). It owns
 * `<dataDir>/drafts/<sessionId>/draft.json` (slice 2 of server-drafts.md keeps the draft's
 * attachments beside it) and the session's revision counter; without a data directory it keeps drafts in memory, as the
 * daemon's other ledgers do in tests. Every change to one session's draft runs after the one
 * before it, so two devices writing at once both get a revision and the later write wins.
 *
 * A write and a send are two requests and can arrive in either order. A send names the page it
 * came from and the number of that page's last write, and the draft remembers it: a write from
 * that page numbered no higher was made before the send, and arriving after it would bring the
 * sent text back, so it is refused.
 */
export class SessionDraftStore {
  private readonly memory = new Map<string, StoredDraft>();
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly dataDir: string | undefined, private readonly now: () => number = () => Date.now()) {}

  async read(sessionId: string): Promise<SessionDraft> {
    const stored = await this.load(checkedSessionId(sessionId));
    return stored === undefined ? { revision: 0 } : { revision: stored.revision, text: stored.text, updatedAt: stored.updatedAt };
  }

  /** Later write wins (owner), except a write the page's own send already covered. */
  async write(sessionId: string, write: DraftWrite): Promise<DraftWriteAnswer> {
    const id = checkedSessionId(sessionId);
    checkedDevice(write.deviceId, write.seq);
    if (Buffer.byteLength(write.text, "utf8") > DRAFT_TEXT_MAX_BYTES) throw new DraftRefusedError("A draft's text is limited to 1 MB");
    return await this.inOrder(id, async () => {
      const current = await this.load(id);
      if (current !== undefined && coveredBySend(current.sentThrough, write)) return { revision: current.revision, superseded: true as const };
      const revision = (current?.revision ?? 0) + 1;
      await this.save(id, { revision, text: write.text, deviceId: write.deviceId, seq: write.seq, updatedAt: this.stamp(), ...sentThroughOf(current) });
      return { revision };
    });
  }

  /**
   * Empties the draft a send was made from, and answers the draft's revision afterwards. The draft
   * is the one sent when it is still the revision the page knew, or when its latest write is the
   * page's own from before the send; one another device wrote later is kept, as it is not what was
   * sent. Either way the send is remembered, so a write still on its way cannot undo it.
   */
  async settleSend(sessionId: string, claim: DraftSendClaim): Promise<number> {
    const id = checkedSessionId(sessionId);
    checkedDevice(claim.deviceId, claim.seq);
    const sentThrough: SentThrough = { deviceId: claim.deviceId, seq: claim.seq };
    return await this.inOrder(id, async () => {
      const current = await this.load(id);
      if (current !== undefined && !sentFrom(current, claim)) {
        await this.save(id, { ...current, sentThrough });
        return current.revision;
      }
      const revision = (current?.revision ?? 0) + 1;
      await this.save(id, { revision, text: "", deviceId: claim.deviceId, seq: claim.seq, updatedAt: this.stamp(), sentThrough });
      return revision;
    });
  }

  forget(sessionId: string): Promise<void> {
    if (!ID_PATTERN.test(sessionId)) return Promise.resolve();
    return this.inOrder(sessionId, async () => {
      this.memory.delete(sessionId);
      if (this.dataDir !== undefined) await rm(join(draftsDir(this.dataDir), sessionId), { recursive: true, force: true });
    });
  }

  /** Removes drafts untouched for DRAFT_RETENTION_MS, and drafts that cannot be read; run at daemon start. */
  async sweep(): Promise<void> {
    const cutoff = this.now() - DRAFT_RETENTION_MS;
    for (const sessionId of await this.sessionIds()) {
      const stored = await this.load(sessionId).catch(() => undefined);
      if (stored === undefined || Date.parse(stored.updatedAt) < cutoff) await this.forget(sessionId);
    }
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  private async sessionIds(): Promise<string[]> {
    if (this.dataDir === undefined) return [...this.memory.keys()];
    const entries = await readdir(draftsDir(this.dataDir)).catch((error: unknown) => {
      if (isNodeErrorWithCode(error, "ENOENT")) return [];
      throw error;
    });
    return entries.filter((entry) => ID_PATTERN.test(entry));
  }

  private inOrder<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(sessionId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const tail = next.then(() => undefined, () => undefined);
    this.chains.set(sessionId, tail);
    void tail.then(() => {
      if (this.chains.get(sessionId) === tail) this.chains.delete(sessionId);
    });
    return next;
  }

  private async load(sessionId: string): Promise<StoredDraft | undefined> {
    if (this.dataDir === undefined) return this.memory.get(sessionId);
    let raw: string;
    try {
      raw = await readFile(join(draftsDir(this.dataDir), sessionId, DRAFT_FILE), "utf8");
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) return undefined;
      throw error;
    }
    return storedDraft(JSON.parse(raw));
  }

  private async save(sessionId: string, draft: StoredDraft): Promise<void> {
    if (this.dataDir === undefined) {
      this.memory.set(sessionId, draft);
      return;
    }
    const dir = join(draftsDir(this.dataDir), sessionId);
    await mkdir(dir, { recursive: true });
    const file = join(dir, DRAFT_FILE);
    const temporary = `${file}.${String(process.pid)}.tmp`;
    await writeFile(temporary, JSON.stringify(draft));
    await rename(temporary, file);
  }
}

/** A send's claim as the prompt route received it, or nothing when it carries none (an older page) or a malformed one. */
export function draftSendClaimOf(value: unknown): DraftSendClaim | undefined {
  if (!isRecord(value)) return undefined;
  const deviceId = value["deviceId"];
  const seq = value["seq"];
  const revision = value["revision"];
  if (typeof deviceId !== "string" || !ID_PATTERN.test(deviceId) || !isCount(seq)) return undefined;
  if (revision !== undefined && !isCount(revision)) return undefined;
  return { deviceId, seq, ...(revision === undefined ? {} : { revision }) };
}

/** A draft write as the route received it, or nothing when a field is missing or of the wrong type. */
export function draftWriteOf(body: Record<string, unknown>): DraftWrite | undefined {
  const deviceId = body["deviceId"];
  const seq = body["seq"];
  const text = body["text"];
  if (typeof deviceId !== "string" || !isCount(seq) || typeof text !== "string") return undefined;
  return { deviceId, seq, text };
}

function sentFrom(current: StoredDraft, claim: DraftSendClaim): boolean {
  return current.revision === claim.revision || (current.deviceId === claim.deviceId && current.seq <= claim.seq);
}

function coveredBySend(sentThrough: SentThrough | undefined, write: DraftWrite): boolean {
  return sentThrough?.deviceId === write.deviceId && write.seq <= sentThrough.seq;
}

function sentThroughOf(current: StoredDraft | undefined): { sentThrough?: SentThrough } {
  return current?.sentThrough === undefined ? {} : { sentThrough: current.sentThrough };
}

function draftsDir(dataDir: string): string {
  return join(dataDir, "drafts");
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function checkedSessionId(sessionId: string): string {
  if (!ID_PATTERN.test(sessionId)) throw new DraftRefusedError("A session id names a draft directory and must be 1-128 letters, digits, - or _");
  return sessionId;
}

function checkedDevice(deviceId: string, seq: number): void {
  if (!ID_PATTERN.test(deviceId)) throw new DraftRefusedError("deviceId must be 1-128 letters, digits, - or _");
  if (!isCount(seq)) throw new DraftRefusedError("seq must be a whole number of 0 or more");
}

function storedDraft(value: unknown): StoredDraft {
  if (!isRecord(value)) throw new Error("A saved draft is not a record");
  const { revision, text, deviceId, seq, updatedAt } = value;
  if (!isCount(revision) || typeof text !== "string" || typeof deviceId !== "string" || !isCount(seq) || typeof updatedAt !== "string") {
    throw new Error("A saved draft is missing its revision, text, device, number or time");
  }
  const sentThrough = storedSentThrough(value["sentThrough"]);
  return { revision, text, deviceId, seq, updatedAt, ...(sentThrough === undefined ? {} : { sentThrough }) };
}

function storedSentThrough(value: unknown): SentThrough | undefined {
  if (!isRecord(value)) return undefined;
  const { deviceId, seq } = value;
  return typeof deviceId === "string" && isCount(seq) ? { deviceId, seq } : undefined;
}
