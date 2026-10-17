/**
 * How the daemon follows a runtime that replaced its session with another under a new id.
 *
 * pi replaces the session inside the same runtime for `/fork`, `/clone` (and the tree's fork and
 * Continue in new session, which are forks) and `/new`, and calls the daemon's rebind hook once the
 * new session exists. What the old id leaves behind is the same for all of them; who moves to the
 * new session, and what becomes of the old one, depends on which it was.
 */
export type ReplacementKind = "fork" | "clone" | "new";

export interface ReplacementPolicy {
  /**
   * `everyViewer`: every browser showing the old session moves to the new one, because the
   * replacement ran from the queue and every device sent into it (`/new`). `sender`: only the
   * browser that asked moves, through its command's answer.
   */
  readonly following: "everyViewer" | "sender";
  /**
   * Whether messages that reached the old session while it was being replaced are dropped. Only
   * `/new` runs with a queue that can still grow behind it; the owner chose to drop what waited
   * behind it (2026-10-17).
   */
  readonly dropsLateMessages: boolean;
  /**
   * Whether an old session never written to a file is written first, so it stays listed as an
   * empty session rather than vanishing (owner, 2026-10-17). A fork or clone needs a written
   * session to start from.
   */
  readonly keepsOldSessionListed: boolean;
}

export const REPLACEMENT_POLICIES: Readonly<Record<ReplacementKind, ReplacementPolicy>> = {
  fork: { following: "sender", dropsLateMessages: false, keepsOldSessionListed: false },
  clone: { following: "sender", dropsLateMessages: false, keepsOldSessionListed: false },
  new: { following: "everyViewer", dropsLateMessages: true, keepsOldSessionListed: true },
};
