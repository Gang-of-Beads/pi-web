/**
 * Ordered application of one session's live stream: every frame applies once, in seq order,
 * with nothing missing.
 *
 * TCP keeps the socket ordered, so a seq jump means frames were never sent (the hub skips
 * serialization when nobody listened), lost across a reconnect, or dropped by a validator -
 * or were published between the snapshot's watermark and the subscription. The machine is
 * seeded with the snapshot's watermark, sees the jump itself, holds the revealing frame and
 * its successors, fetches the missed range, and applies the replayed and held frames merged
 * by seq. Held frames used to flush in arrival order after the replay, and the join flush
 * bypassed the machine, so a frame could apply out of order or twice.
 *
 * A seq space is one epoch of the daemon's numbering. A frame from another epoch - the
 * daemon restarted or evicted the ring - starts a new space; so does a lower seq on a frame
 * that carries no epoch, from a daemon too old to stamp one. Applied seqs of an old space
 * say nothing about the new one, and a new space first seen on a live frame says nothing
 * about the frames of it published before that one: the view is rebuilt from a full read,
 * whose snapshot seeds the new space. The same holds when the new space shows up among the
 * frames held during a repair: the replay answers for the old space, so it is dropped rather
 * than merged by a seq that means something else in the new one.
 *
 * States: `idle` (frames apply as they arrive), `repairing` (a gap was seen; live frames are
 * held while one replay is fetched and flushed). Anything that cannot be replayed - a resync
 * verdict, a failed request - falls back to the full read, exactly once.
 */

import type { SessionUiEvent } from "../../shared/apiTypes";

/** A replay reply, already parsed; `resync` and failures both mean fallback. */
export type GapReplayResult =
  | { ok: true; frames: SessionUiEvent[] }
  | { ok: false };

export interface GapRepairOptions {
  /** Apply one frame to the transcript, in order. */
  apply: (event: SessionUiEvent) => void;
  /** Fetch the frames after `sinceSeq` in `epoch`; resync verdict and failures resolve `{ ok: false }`. */
  request: (sinceSeq: number, epoch: string | undefined) => Promise<GapReplayResult>;
  /** Give up on replay and rebuild from the authoritative read, once. */
  resync: () => void;
  /** A replay landed: every frame after the frontier it asked from is applied. */
  caughtUp?: () => void;
  /**
   * Whether the transcript snapshot reflects this frame. Only transcript frames are: a dialog,
   * ask or inbox frame at or below the snapshot's seq still applies (its own revision scope drops
   * an old one), and its seq orders it and moves the frontier. Absent, every frame is.
   */
  reflectedBySnapshot?: (event: SessionUiEvent) => boolean;
}

/** Where the stream stands: the last seq applied or reflected, and the epoch it belongs to. */
export interface StreamFrontier {
  seq: number;
  epoch?: string;
}

export class SessionGapRepair {
  private state: "idle" | "repairing" = "idle";
  /** Live frames held since the gap was seen, in arrival order. */
  private buffer: SessionUiEvent[] = [];
  /** Every seq applied in the current space; with repairs out of order, "9 applied" must not imply "4 applied". */
  private readonly appliedSeqs = new Set<number>();
  /** The snapshot's seq: everything at or below it is reflected without having been applied here. */
  private reflectedThrough: number | undefined;
  /** The highest seq reflected or applied in the current space. */
  private frontier: number | undefined;
  /** The highest seq applied here in the current space; a revisioned frame below the snapshot can be applied without moving the frontier. */
  private highestApplied: number | undefined;
  private epoch: string | undefined;
  /**
   * The pass in flight asked too early or from too late: a seed moved the start back, or a doubt
   * arrived after its request went out, so its reply may predate what the doubt is about.
   */
  private repairAgainSince: number | undefined;
  /** The repair under way, so a catch-up that joins it can wait for it. */
  private inFlight: Promise<void> | undefined;

  constructor(private readonly options: GapRepairOptions) {}

  /** Whether live frames are currently being held instead of applied. */
  get holding(): boolean {
    return this.state !== "idle";
  }

  /** The highest seq reflected or applied in the current space: where the page stands. */
  get position(): number | undefined {
    return this.frontier;
  }

  /**
   * Start from a snapshot: everything at or below its seq is already reflected, and the next
   * frame is expected right after it. A frame published between the snapshot and the
   * subscription is then a gap like any other, not a silent loss.
   *
   * A seed replaces the view. Frames this space applied past the seed's seq went onto the view
   * being replaced - a reconnect refresh reads while live frames keep applying - so they are
   * fetched again at once rather than when the next frame happens to reveal the gap, which a
   * quiet session never sends.
   */
  seed(watermark: StreamFrontier): void {
    const replacedBeyond = this.epoch === watermark.epoch && this.frontier !== undefined && this.frontier > watermark.seq;
    this.appliedSeqs.clear();
    this.highestApplied = undefined;
    this.reflectedThrough = watermark.seq;
    this.frontier = watermark.seq;
    this.epoch = watermark.epoch;
    if (!replacedBeyond) return;
    if (this.state === "idle") void this.repair(watermark.seq);
    else this.repairAgainSince = watermark.seq;
  }

  /**
   * A live frame. In order, it applies; beyond a gap, it is held and the missed range is
   * fetched; during a repair, it is held until the replay is in.
   */
  onLiveFrame(event: SessionUiEvent, seq: number | undefined): void {
    if (this.state !== "idle") {
      this.buffer.push(event);
      return;
    }
    if (seq === undefined) {
      this.options.apply(event);
      return;
    }
    if (this.startsNewSpace(event, seq)) {
      this.enterSpace(frameEpoch(event));
      this.applyFrame(event, seq);
      this.options.resync();
      return;
    }
    if (this.alreadyApplied(event, seq)) return;
    const frontier = this.frontier;
    if (frontier !== undefined && seq > frontier + 1) {
      this.buffer.push(event);
      void this.repair(frontier);
      return;
    }
    this.applyFrame(event, seq);
  }

  /**
   * Ask for everything after the frontier, for a page that may have missed frames with nothing
   * after them to show it (back from the background, a turn that ended, a heartbeat ahead), and
   * settle once they are applied. During a repair the pass asks again when it lands: its reply
   * may have been taken before what prompted this. Undefined before a snapshot seeded the
   * frontier: there is no position to ask from yet.
   */
  catchUp(): Promise<void> | undefined {
    if (this.state !== "idle") {
      if (this.frontier !== undefined) this.repairAgainSince = Math.min(this.repairAgainSince ?? this.frontier, this.frontier);
      return this.inFlight;
    }
    if (this.frontier === undefined) return undefined;
    return this.repair(this.frontier);
  }

  /**
   * A gap seen elsewhere: everything after `lastSeen` is missing. Starts exactly one repair;
   * further gaps join it. Production asks through {@link catchUp}, from the frontier, which knows
   * what was applied rather than what arrived; this entry stays for the machine's own tests.
   */
  onGap(lastSeen: number): Promise<void> {
    if (this.state !== "idle") return Promise.resolve();
    return this.repair(lastSeen);
  }

  private repair(sinceSeq: number): Promise<void> {
    this.state = "repairing";
    this.inFlight = this.runRepair(sinceSeq);
    return this.inFlight;
  }

  private async runRepair(sinceSeq: number): Promise<void> {
    let result: GapReplayResult;
    try {
      result = await this.options.request(sinceSeq, this.epoch);
    } catch {
      result = { ok: false };
    }
    const again = this.repairAgainSince;
    this.repairAgainSince = undefined;
    if (again !== undefined) return this.runRepair(again);
    const held = this.buffer;
    this.buffer = [];
    this.state = "idle";
    const newSpace = held.map(frameEpoch).find((epoch) => epoch !== undefined && this.epoch !== undefined && epoch !== this.epoch);
    if (newSpace !== undefined) {
      this.enterSpace(newSpace);
      this.applyInSeqOrder(held.filter((frame) => frameEpoch(frame) === newSpace));
      this.options.resync();
      return;
    }
    if (!result.ok) {
      this.applyInSeqOrder(held);
      this.options.resync();
      return;
    }
    this.applyInSeqOrder([...result.frames, ...held]);
    this.options.caughtUp?.();
  }

  /**
   * Apply frames merged by seq: one copy per seq, lowest first, none already applied. Frames
   * without a seq keep their arrival order after the sequenced ones.
   */
  private applyInSeqOrder(frames: readonly SessionUiEvent[]): void {
    const bySeq = new Map<number, SessionUiEvent>();
    const unsequenced: SessionUiEvent[] = [];
    for (const frame of frames) {
      const seq = frameSeq(frame);
      if (seq === undefined) unsequenced.push(frame);
      else if (!bySeq.has(seq)) bySeq.set(seq, frame);
    }
    for (const seq of [...bySeq.keys()].sort((left, right) => left - right)) {
      const frame = bySeq.get(seq);
      if (frame !== undefined && !this.alreadyApplied(frame, seq)) this.applyFrame(frame, seq);
    }
    for (const frame of unsequenced) this.options.apply(frame);
  }

  /**
   * Whether a frame belongs to another seq space than the one applied so far: another epoch,
   * or - for a frame without an epoch - a live seq that went back below what this space has
   * already applied, which an ordered socket only delivers when the numbering restarted.
   */
  private startsNewSpace(event: SessionUiEvent, seq: number): boolean {
    const epoch = frameEpoch(event);
    if (epoch !== undefined) return this.epoch !== undefined && epoch !== this.epoch;
    return this.highestApplied !== undefined && seq < this.highestApplied;
  }

  private enterSpace(epoch: string | undefined): void {
    this.appliedSeqs.clear();
    this.highestApplied = undefined;
    this.reflectedThrough = undefined;
    this.frontier = undefined;
    this.epoch = epoch;
  }

  /** Applied since the seed, or a frame the snapshot reflects at or below its seq. */
  private alreadyApplied(event: SessionUiEvent, seq: number): boolean {
    if (this.appliedSeqs.has(seq)) return true;
    const reflected = this.options.reflectedBySnapshot?.(event) ?? true;
    return reflected && this.reflectedThrough !== undefined && seq <= this.reflectedThrough;
  }

  private applyFrame(event: SessionUiEvent, seq: number): void {
    this.appliedSeqs.add(seq);
    this.highestApplied = this.highestApplied === undefined ? seq : Math.max(this.highestApplied, seq);
    this.frontier = this.frontier === undefined ? seq : Math.max(this.frontier, seq);
    this.epoch ??= frameEpoch(event);
    this.options.apply(event);
  }
}

/** The wire stamp on a frame, read without asserting its shape. */
function frameSeq(event: SessionUiEvent): number | undefined {
  const seq: unknown = Reflect.get(event, "seq");
  return typeof seq === "number" && Number.isFinite(seq) ? seq : undefined;
}

function frameEpoch(event: SessionUiEvent): string | undefined {
  const epoch: unknown = Reflect.get(event, "epoch");
  return typeof epoch === "string" ? epoch : undefined;
}
