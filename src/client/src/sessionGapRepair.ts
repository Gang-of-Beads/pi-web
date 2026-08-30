/**
 * Repairing a counted gap in the live session stream.
 *
 * TCP keeps the socket ordered, so a seq jump means frames were never sent
 * (the hub skips serialization when nobody listened), lost across a reconnect,
 * or dropped by a validator. "Highest seq seen" is not "set of frames
 * applied": the revealing frame and its live successors may already be in
 * hand while older frames are gone. The machine holds the live frames, puts
 * the missed range back in front of them, flushes, and is done - the replay
 * answers up to the ring's current, which is everything the server ever
 * stamped; anything beyond it does not exist yet and arrives live.
 *
 * The dedup invariant is structural, not bookkeeping: a frame applies iff its
 * seq was never applied and is not held in the buffer. Replayed frames below
 * the held frontier are the missing ones; replayed frames at or above it are
 * duplicates of held frames; held frames flush only if the replay did not
 * already cover them. Everything else - the resync verdict, a failed
 * request - falls back to the full read, exactly once.
 *
 * States: `idle` (frames apply as they arrive), `repairing` (a gap was seen;
 * live frames are held while one replay is fetched and flushed). The request
 * coalesces: gaps seen while a repair runs join it.
 */

import type { SessionUiEvent } from "../../shared/apiTypes";

/** A replay reply, already parsed; `resync` and failures both mean fallback. */
export type GapReplayResult =
  | { ok: true; frames: SessionUiEvent[] }
  | { ok: false };

export interface GapRepairOptions {
  /** Apply one frame to the transcript, in order. */
  apply: (event: SessionUiEvent) => void;
  /** Fetch the frames after `sinceSeq`; resync verdict and failures resolve `{ ok: false }`. */
  request: (sinceSeq: number) => Promise<GapReplayResult>;
  /** Give up on replay and rebuild from the authoritative read, once. */
  resync: () => void;
}

export class SessionGapRepair {
  private state: "idle" | "repairing" = "idle";
  /** Live frames held since the gap was seen, in arrival order. */
  private buffer: SessionUiEvent[] = [];
  private readonly heldSeqs = new Set<number>();
  /** Every seq this machine has applied. A set, not a watermark: repairs apply out of seq order (the held frontier flushes after the tail), so "9 applied" must not imply "4 applied". One number per applied frame - bounded by the transcript it mirrors. */
  private readonly appliedSeqs = new Set<number>();

  constructor(private readonly options: GapRepairOptions) {}

  /** Whether live frames are currently being held instead of applied. */
  get holding(): boolean {
    return this.state !== "idle";
  }

  /**
   * A live frame. During a repair it is held - applying it now would put it
   * ahead of the older frames the replay is about to bring back.
   */
  onLiveFrame(event: SessionUiEvent, seq: number | undefined): void {
    if (this.state === "idle") {
      this.markApplied(seq);
      this.options.apply(event);
      return;
    }
    if (seq !== undefined) this.heldSeqs.add(seq);
    this.buffer.push(event);
  }
  /**
   * The socket saw a seq jump: everything between the old watermark and this
   * point is missing. Starts exactly one repair; further gaps join it.
   * `lastSeen` is the watermark before the jump - the last seq applied.
   * Returns the repair's promise: production ignores it, tests await it.
   */
  onGap(lastSeen: number): Promise<void> {
    if (this.state !== "idle") return Promise.resolve();
    this.state = "repairing";
    return this.runRepair(lastSeen);
  }

  private async runRepair(sinceSeq: number): Promise<void> {
    let result: GapReplayResult;
    try {
      result = await this.options.request(sinceSeq);
    } catch {
      result = { ok: false };
    }
    if (!result.ok) {
      this.fallBackToResync();
      return;
    }
    for (const frame of result.frames) {
      if (this.alreadyCovered(frame)) continue;
      this.applyFrame(frame);
    }
    // Held frames the replay did not already cover are real arrivals: they
    // apply now, after everything older than them has been put back.
    const held = this.buffer;
    this.buffer = [];
    this.heldSeqs.clear();
    for (const event of held) {
      if (this.alreadyCovered(event)) continue;
      this.applyFrame(event);
    }
    this.state = "idle";
  }

  private alreadyCovered(event: SessionUiEvent): boolean {
    const seq = frameSeq(event);
    if (seq === undefined) return false;
    return this.appliedSeqs.has(seq) || this.heldSeqs.has(seq);
  }

  private applyFrame(event: SessionUiEvent): void {
    this.markApplied(frameSeq(event));
    this.options.apply(event);
  }

  private markApplied(seq: number | undefined): void {
    if (seq !== undefined) this.appliedSeqs.add(seq);
  }

  /**
   * The replay is not servable. The buffer's frames are real arrivals - they
   * apply, in order - and the missing range is rebuilt by the full read,
   * which also re-syncs every other surface at once. Exactly once: the
   * caller's resync replaces state wholesale, so this machine retires.
   */
  private fallBackToResync(): void {
    const held = this.buffer;
    this.buffer = [];
    this.heldSeqs.clear();
    for (const event of held) {
      if (this.alreadyCovered(event)) continue;
      this.applyFrame(event);
    }
    this.state = "idle";
    this.options.resync();
  }
}

/** The wire stamp on a frame, read without asserting its shape. */
function frameSeq(event: SessionUiEvent): number | undefined {
  const seq: unknown = Reflect.get(event, "seq");
  return typeof seq === "number" && Number.isFinite(seq) ? seq : undefined;
}
