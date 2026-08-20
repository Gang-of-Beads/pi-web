import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GOALS_DIRECTORY } from "./goalStore.js";
import { extractGoalJsonBlock } from "./goalFile.js";

/**
 * Archive a goal from the browser, the way its owner would.
 *
 * Goal records belong to the `pi-goal-x` extension running inside an agent
 * process; pi-web only reads them. A paused goal, though, never leaves the
 * panel on its own, and the extension's own `/goal-clear` refuses without a
 * confirmable UI - which a web session does not have. So the browser needs a
 * way out, and the only safe one is to do exactly what the extension does:
 *
 *   1. take the extension's own lock, briefly;
 *   2. re-read the record under it and keep its prose body, because the
 *      objective is parsed from the prose and a JSON-only copy loses it;
 *   3. write the archived copy (temp + rename) with the revision advanced;
 *   4. unlink the active record;
 *   5. append one `goal_archived` line to the ledger;
 *   6. drop the pool snapshot, which is a cache that would otherwise keep
 *      claiming the goal is open.
 *
 * Step 6 matters more than it looks: the snapshot lives outside the goals
 * directory and is only invalidated by directory mtime or filename changes.
 *
 * What this cannot do is stop a *running* agent that is focused on the goal:
 * it holds the record in memory and rewrites it at the next turn boundary.
 * Callers are told so (`agentMayRecreate`) rather than being left to discover
 * a goal that came back.
 */

export interface ArchiveGoalResult {
  goalId: string;
  archivedPath: string;
  /** True when the goal was already gone: archiving is idempotent. */
  alreadyArchived: boolean;
  /**
   * True when an agent could still be holding this goal in memory, in which
   * case it needs `/goal-refresh` (and ideally `/goal-unfocus`) to let go.
   */
  agentMayRecreate: boolean;
}

export class GoalArchiveError extends Error {
  constructor(message: string, readonly code: "not-found" | "locked" | "invalid") {
    super(message);
    this.name = "GoalArchiveError";
  }
}

/** How long another process's lock is honoured before it counts as abandoned. */
const LOCK_STALE_MS = 30_000;
/** The extension waits ~100ms for this lock, so ours must be far shorter. */
const LOCK_ATTEMPTS = 5;
const LOCK_RETRY_MS = 12;

export interface ArchiveGoalOptions {
  /** Agent home whose `.pi/.goals-pool-snapshot.json` cache must be dropped. */
  home?: string;
  now?: () => Date;
}

export async function archiveWorkspaceGoal(workspacePath: string, goalId: string, options: ArchiveGoalOptions = {}): Promise<ArchiveGoalResult> {
  const safeId = goalIdForPath(goalId);
  const directory = join(workspacePath, GOALS_DIRECTORY);
  const now = options.now ?? (() => new Date());

  const release = await acquireGoalLock(directory, safeId, now);
  try {
    const active = await findActiveGoalFile(directory, goalId);
    if (active === undefined) {
      return { goalId, archivedPath: "", alreadyArchived: true, agentMayRecreate: false };
    }

    const record = parseGoalRecord(active.content);
    const archivedName = `goal_${archiveStamp(now())}_${safeId}.md`;
    const archivedPath = join(directory, "archived", archivedName);
    await mkdir(join(directory, "archived"), { recursive: true });

    const archivedContent = archivedGoalContent(active.content, record, {
      archivedPath: join(GOALS_DIRECTORY, "archived", archivedName),
      at: now().toISOString(),
    });
    const temporary = `${archivedPath}.${String(process.pid)}.${String(now().getTime())}.tmp`;
    await writeFile(temporary, archivedContent, "utf8");
    await rename(temporary, archivedPath);
    await unlink(active.path);

    appendGoalEvent(directory, {
      type: "goal_archived",
      goalId,
      archivePath: archivedPath,
      at: now().toISOString(),
      source: "pi-web",
    });
    await dropPoolSnapshot(options.home ?? homedir(), workspacePath);

    return { goalId, archivedPath, alreadyArchived: false, agentMayRecreate: true };
  } finally {
    await release();
  }
}

/**
 * The lock file the extension uses. `wx` is the whole mechanism: whoever
 * creates the file owns the goal. A lock left by a process that died is taken
 * over once it is older than the staleness window, since otherwise a crash
 * during a turn would make the goal permanently unarchivable.
 */
async function acquireGoalLock(directory: string, safeId: string, now: () => Date): Promise<() => Promise<void>> {
  const locks = join(directory, ".locks");
  const lockPath = join(locks, `${safeId}.lock`);
  await mkdir(locks, { recursive: true });

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: now().toISOString() }), { encoding: "utf8", flag: "wx" });
      return async () => { await rm(lockPath, { force: true }); };
    } catch {
      if (await lockIsStale(lockPath, now)) {
        await rm(lockPath, { force: true });
        continue;
      }
      await delay(LOCK_RETRY_MS);
    }
  }
  throw new GoalArchiveError("The goal is being written by another process; try again in a moment.", "locked");
}

async function lockIsStale(lockPath: string, now: () => Date): Promise<boolean> {
  try {
    const stats = await stat(lockPath);
    return now().getTime() - stats.mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

interface ActiveGoalFile { path: string; content: string }

async function findActiveGoalFile(directory: string, goalId: string): Promise<ActiveGoalFile | undefined> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.startsWith("active_goal_") || !entry.endsWith(".md")) continue;
    const path = join(directory, entry);
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch {
      continue;
    }
    const record = parseGoalRecord(content);
    if (record["id"] === goalId) return { path, content };
  }
  return undefined;
}

function parseGoalRecord(content: string): Record<string, unknown> {
  const block = extractGoalJsonBlock(content);
  if (block === undefined) throw new GoalArchiveError("The goal record has no JSON header to update.", "invalid");
  const parsed: unknown = JSON.parse(block);
  if (!isRecord(parsed)) throw new GoalArchiveError("The goal record's header is not an object.", "invalid");
  return { ...parsed };
}

/**
 * Rewrite the header and keep everything after it byte for byte: the prose is
 * where the objective actually lives, so a rewritten body would change the goal
 * while archiving it.
 */
function archivedGoalContent(content: string, record: Record<string, unknown>, archive: { archivedPath: string; at: string }): string {
  const block = extractGoalJsonBlock(content);
  if (block === undefined) throw new GoalArchiveError("The goal record has no JSON header to update.", "invalid");
  const status = record["status"];
  const nextRecord: Record<string, unknown> = {
    ...record,
    status: status === "complete" || status === "completed" ? status : "paused",
    stopReason: "user",
    archivedPath: archive.archivedPath,
    updatedAt: archive.at,
    revision: typeof record["revision"] === "number" ? record["revision"] + 1 : 1,
  };
  delete nextRecord["activePath"];
  const body = content.slice(content.indexOf(block) + block.length);
  return `${JSON.stringify(nextRecord, undefined, 2)}${body}`;
}

/**
 * The ledger is append-only and read line by line, and its own reader tolerates
 * a torn tail. One synchronous append keeps the record whole.
 */
function appendGoalEvent(directory: string, event: Record<string, unknown>): void {
  try {
    appendFileSync(join(directory, "goal_events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // A missing ledger is not a reason to leave the goal in place; the archived
    // file and the removed active file are the durable part of this operation.
  }
}

/**
 * Delete rather than rewrite: a missing snapshot costs one rescan, while a
 * stale one keeps reporting a goal that is no longer open.
 */
async function dropPoolSnapshot(home: string, workspacePath: string): Promise<void> {
  const candidates = [join(home, ".pi", ".goals-pool-snapshot.json"), join(workspacePath, ".pi", ".goals-pool-snapshot.json")];
  await Promise.all(candidates.map(async (candidate) => { await rm(candidate, { force: true }); }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function goalIdForPath(goalId: string): string {
  const safe = goalId.replace(/[^a-zA-Z0-9_-]/g, "-");
  if (safe === "" || safe.length > 128) throw new GoalArchiveError("That goal id cannot be used as a file name.", "invalid");
  return safe;
}

function archiveStamp(now: Date): string {
  return now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
