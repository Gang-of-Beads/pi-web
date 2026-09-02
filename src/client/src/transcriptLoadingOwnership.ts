/** What moves the transcript's loading flag. */
export type TranscriptLoadingEvent =
  | { event: "readStarted" }
  | { event: "readSettled"; readSeq: number; currentSeq: number }
  | { event: "selectionAbandoned" }
  | { event: "selectedWithoutRead" };

/**
 * Whether a transcript should still read as loading after `event`.
 *
 * The flag exists so an unread transcript is not drawn as an empty one, and
 * clearing it is restricted to the selection that set it: a superseded read
 * finishing late would otherwise clear the flag of the newer read still in
 * flight, and that newer session would be called empty mid-read.
 *
 * The restriction assumed a newer selection always exists to take the flag
 * over. Abandoning the selection breaks that: deselecting, or disposing the
 * controller, advances the selection counter without starting a read, so the
 * in-flight read finds itself superseded and declines to clear, and no
 * successor clears it either. The transcript then reads "Loading this
 * session..." with nothing loading behind it.
 *
 * So abandonment ends the flag outright: nobody is waiting, so nothing is
 * loading. Selecting something with no transcript to read - a session this
 * browser has only just asked for, which cannot have history yet - ends it for
 * the same reason, and it advances the counter too, so leaving it out stranded
 * the flag exactly as abandonment did. Only a settled read has to prove it
 * still owns the flag.
 */
export function transcriptLoadingAfter(event: TranscriptLoadingEvent): boolean {
  switch (event.event) {
    case "readStarted":
      return true;
    case "selectionAbandoned":
    case "selectedWithoutRead":
      return false;
    case "readSettled":
      return event.readSeq !== event.currentSeq;
  }
}
