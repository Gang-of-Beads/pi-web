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
   * replacement acted on the session every device sends into (`/new`). `sender`: only the
   * browser that asked moves, through its command's answer.
   */
  readonly following: "everyViewer" | "sender";
  /**
   * `stops`: the replacement stops whatever the session is doing, as Stop does, once pi is
   * certain to switch, and hands what was queued back (`/new`, as in pi's terminal, owner
   * 2026-10-18); what reaches the old inbox while pi tears the session down is handed back with
   * it. `refuses`: the replacement is refused while the session works (fork, clone).
   */
  readonly whileWorking: "stops" | "refuses";
  /**
   * Whether an old session never written to a file is written first, so it stays listed as an
   * empty session rather than vanishing (owner, 2026-10-17). A fork or clone needs a written
   * session to start from.
   */
  readonly keepsOldSessionListed: boolean;
}

export const REPLACEMENT_POLICIES: Readonly<Record<ReplacementKind, ReplacementPolicy>> = {
  fork: { following: "sender", whileWorking: "refuses", keepsOldSessionListed: false },
  clone: { following: "sender", whileWorking: "refuses", keepsOldSessionListed: false },
  new: { following: "everyViewer", whileWorking: "stops", keepsOldSessionListed: true },
};
