/**
 * The notification inbox's revision contract, generalised for every sequenced
 * surface.
 *
 * The inbox has enforced this since its revision was added: a frame applies
 * only when its revision is exactly the applied revision plus one; a frame at
 * or below it carries nothing new; anything else — a skip, an unread surface,
 * or a server-declared resync — proves the client's copy is missing something
 * and must be repaired by a full read. Sessions that lose a frame used to keep
 * the stale copy until an unrelated refetch; this gate is what turns detected
 * loss into repair.
 *
 * Frames without a revision fail open (`apply`, revision untouched): a
 * federation peer that has not been upgraded degrades to today's behaviour
 * instead of breaking, while a gap between sequenced frames is always
 * actionable.
 */

export type RevisionVerdict = "apply" | "ignore" | "resync";

export interface RevisionScopeSnapshot {
  /** Last revision applied to the surface, or 0 before any. */
  readonly revision: number;
  /** Whether a full read has populated the surface for the current selection. */
  readonly fresh: boolean;
}

export function revisionVerdict(
  current: RevisionScopeSnapshot,
  incoming: { revision?: number; resync?: boolean },
): RevisionVerdict {
  if (incoming.revision === undefined) return "apply";
  if (incoming.revision <= current.revision) return "ignore";
  if (!current.fresh) return "resync";
  if (incoming.resync === true) return "resync";
  if (incoming.revision !== current.revision + 1) return "resync";
  return "apply";
}

export interface RevisionScopeOptions {
  /**
   * Repair for this scope: refetch the whole surface from the server. Called
   * at most once at a time — concurrent gap detections coalesce, because one
   * refetch answers every gap it covers and a later gap schedules its own.
   */
  readonly resync: () => Promise<void> | void;
}

export class RevisionScope {
  private appliedRevision = 0;
  private fresh = false;
  private resyncScheduled = false;
  private resyncRunning = false;

  constructor(private readonly options: RevisionScopeOptions) {}

  get revision(): number {
    return this.appliedRevision;
  }

  get isFresh(): boolean {
    return this.fresh;
  }

  /** A full read completed; the surface is current as of `revision`. */
  markFresh(revision: number): void {
    this.appliedRevision = Math.max(this.appliedRevision, revision);
    this.fresh = true;
  }

  /**
   * The surface must not apply frames blind: a read failed, or the selection
   * moved and the retained state belongs to another key. Frames now resync
   * instead of applying, until the next full read.
   */
  markUnfresh(): void {
    this.fresh = false;
  }

  /**
   * Observe an incoming frame. `applyFrame` runs only on the `apply` verdict
   * and its return value is passed through, so callers keep their own ordering
   * and state handling; `ignore` and `resync` leave the surface untouched.
   */
  observe<T>(incoming: { revision?: number; resync?: boolean }, applyFrame: () => T): T | undefined {
    const verdict = revisionVerdict({ revision: this.appliedRevision, fresh: this.fresh }, incoming);
    if (verdict === "apply") {
      if (incoming.revision !== undefined) this.appliedRevision = Math.max(this.appliedRevision, incoming.revision);
      return applyFrame();
    }
    if (verdict === "resync") this.scheduleResync();
    return undefined;
  }

  /** Request repair; concurrent requests while one is scheduled or running coalesce. */
  requestResync(): void {
    this.scheduleResync();
  }

  private scheduleResync(): void {
    if (this.resyncScheduled || this.resyncRunning) return;
    this.resyncScheduled = true;
    void Promise.resolve().then(() => {
      this.resyncScheduled = false;
      // In flight means until the repair settles: a gap observed while the
      // refetch runs is answered by that refetch, but a new gap after it must
      // schedule its own.
      this.resyncRunning = true;
      void Promise.resolve(this.options.resync()).finally(() => {
        this.resyncRunning = false;
      });
    });
  }
}
