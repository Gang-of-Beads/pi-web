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

export type RevisionVerdict = "apply" | "ignore" | "resync" | "await";

export interface RevisionScopeSnapshot {
  /** Last revision applied to the surface, or 0 before any. */
  readonly revision: number;
  /** Whether a full read has populated the surface for the current selection. */
  readonly fresh: boolean;
  /** Whether a full read is on its way; absent means it is. */
  readonly reading?: boolean;
}

export function revisionVerdict(
  current: RevisionScopeSnapshot,
  incoming: { revision?: number; resync?: boolean },
): RevisionVerdict {
  if (incoming.revision === undefined) return "apply";
  if (incoming.revision <= current.revision) return "ignore";
  if (!current.fresh) return current.reading === false ? "resync" : "await";
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
  /** The daemon instance whose revision space this scope currently orders. */
  private daemonId: string | undefined;
  private resyncScheduled = false;
  private resyncRunning = false;
  /**
   * The highest revision a frame carried while the surface was not fresh. Its full read is on
   * its way and answers for every revision up to the one it reports (state-diagram D5, "An open
   * reads the session once"); only a frame past that proves the read stale.
   */
  private awaitedRevision: number | undefined;
  /** A scope starts with its selection's full read on its way; a failed read leaves none until a resync starts one. */
  private reading = true;

  constructor(private readonly options: RevisionScopeOptions) {}

  get revision(): number {
    return this.appliedRevision;
  }

  get isFresh(): boolean {
    return this.fresh;
  }

  /** A full read completed; the surface is current as of `revision`. */
  markFresh(revision: number, daemonInstanceId?: string): void {
    // A revision only orders frames within one daemon instance. A full read
    // reporting a new instance replaces the revision space outright - the old
    // high-water mark would silently deafen the surface to the restarted
    // daemon's low stamps until reselection.
    if (daemonInstanceId !== undefined && this.daemonId !== undefined && daemonInstanceId !== this.daemonId) {
      this.daemonId = daemonInstanceId;
      this.appliedRevision = revision;
      this.fresh = true;
      this.awaitedRevision = undefined;
      return;
    }
    if (daemonInstanceId !== undefined) this.daemonId = daemonInstanceId;
    this.appliedRevision = Math.max(this.appliedRevision, revision);
    this.fresh = true;
    this.settleAwaited();
  }

  /** The full read failed. A frame that waited for it is now a gap, and a frame that comes later has no read to wait for: both repair from another read. */
  readFailed(): void {
    this.reading = false;
    if (this.awaitedRevision === undefined) return;
    this.awaitedRevision = undefined;
    this.scheduleResync();
  }

  private settleAwaited(): void {
    const awaited = this.awaitedRevision;
    this.awaitedRevision = undefined;
    if (awaited !== undefined && awaited > this.appliedRevision) this.scheduleResync();
  }

  /**
   * Observe an incoming frame. `applyFrame` runs only on the `apply` verdict
   * and its return value is passed through, so callers keep their own ordering
   * and state handling; `ignore` and `resync` leave the surface untouched.
   */
  observe<T>(incoming: { revision?: number; resync?: boolean; daemonInstanceId?: string }, applyFrame: () => T): T | undefined {
    if (incoming.daemonInstanceId !== undefined) {
      // First identity sighting adopts the space; a different identity means
      // the daemon restarted and this scope's ordering is void - repair from
      // the authoritative read, which reports the new instance to markFresh.
      if (this.daemonId === undefined) this.daemonId = incoming.daemonInstanceId;
      else if (incoming.daemonInstanceId !== this.daemonId) {
        this.scheduleResync();
        return undefined;
      }
    }
    const verdict = revisionVerdict({ revision: this.appliedRevision, fresh: this.fresh, reading: this.reading }, incoming);
    if (verdict === "apply") {
      if (incoming.revision !== undefined) this.appliedRevision = Math.max(this.appliedRevision, incoming.revision);
      return applyFrame();
    }
    if (verdict === "resync") this.scheduleResync();
    if (verdict === "await") this.awaitedRevision = Math.max(this.awaitedRevision ?? 0, incoming.revision ?? 0);
    return undefined;
  }

  /** Request repair; concurrent requests while one is scheduled or running coalesce. */
  requestResync(): void {
    this.scheduleResync();
  }

  private scheduleResync(): void {
    if (this.resyncScheduled || this.resyncRunning) return;
    this.resyncScheduled = true;
    this.reading = true;
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
