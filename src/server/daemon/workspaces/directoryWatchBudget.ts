import { readFileSync } from "node:fs";

/**
 * How many subfolder watches all workspace trees of one daemon may hold
 * together (issue #59).
 *
 * The per-workspace cap bounds one tree, but a daemon holding many session
 * folders would still multiply it, and inotify's limit is per user: every
 * other program of that user (editors, other daemons) draws from the same
 * `max_user_watches`. The daemon keeps itself to a quarter of that limit,
 * at most 16,384, and to 8,192 when the limit cannot be read. Tree roots are
 * not counted: each held folder always gets its own top-level watch. A tree
 * the budget refused resumes its walk when another tree gives folders back.
 */
export class DirectoryWatchBudget {
  private used = 0;
  private readonly waitingForRoom = new Set<() => void>();

  constructor(readonly size: number) {}

  take(): boolean {
    if (this.used >= this.size) return false;
    this.used += 1;
    return true;
  }

  give(count: number): void {
    if (count <= 0) return;
    this.used = Math.max(0, this.used - count);
    const waiting = [...this.waitingForRoom];
    this.waitingForRoom.clear();
    for (const resume of waiting) resume();
  }

  /** A tree the budget refused waits here; it is called once, the next time folders are given back. */
  whenRoomFrees(resume: () => void): () => void {
    this.waitingForRoom.add(resume);
    return () => { this.waitingForRoom.delete(resume); };
  }
}

const MAX_DAEMON_DIRECTORY_WATCHES = 16_384;
const UNKNOWN_LIMIT_DIRECTORY_WATCHES = 8_192;

export function directoryWatchBudgetSize(readMaxUserWatches: () => string = () => readFileSync("/proc/sys/fs/inotify/max_user_watches", "utf8")): number {
  try {
    const limit = Number.parseInt(readMaxUserWatches(), 10);
    return Number.isSafeInteger(limit) && limit > 0 ? Math.min(MAX_DAEMON_DIRECTORY_WATCHES, Math.floor(limit / 4)) : UNKNOWN_LIMIT_DIRECTORY_WATCHES;
  } catch {
    return UNKNOWN_LIMIT_DIRECTORY_WATCHES;
  }
}
