/**
 * Which of two status facts about the selected session is newer.
 *
 * A status arrives two ways: as a frame on the session's stream, stamped with its seq and
 * epoch, and as the answer to an HTTP read. A read requested before a frame and answered after
 * it used to overwrite the frame, so the view said idle while the daemon had just published
 * "streaming". A read now carries the stream position it was computed at; one from before the
 * last applied frame, in the same seq space, is stale. A read without a position - from a
 * daemon too old to stamp one - is stale if a status frame was applied while it was in
 * flight: a later fact beats a reply that may predate it.
 *
 * Pure: the controller records what it applied and asks.
 */

/** Where a status fact sits in its session's stream: a frame's seq, or the seq a read saw. */
export interface StatusPosition {
  seq: number;
  epoch?: string;
}

export interface StatusRead {
  /** The stream position the daemon computed the read at, when it says. */
  position: StatusPosition | undefined;
  /** Whether a status frame was applied between the read's request and its answer. */
  frameAppliedWhileReading: boolean;
}

export type StatusReadVerdict = "apply" | "stale";

export function statusReadVerdict(read: StatusRead, lastApplied: StatusPosition | undefined): StatusReadVerdict {
  if (read.position === undefined) return read.frameAppliedWhileReading ? "stale" : "apply";
  if (lastApplied === undefined || lastApplied.epoch !== read.position.epoch) return "apply";
  return read.position.seq < lastApplied.seq ? "stale" : "apply";
}
