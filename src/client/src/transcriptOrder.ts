import type { ChatLine } from "./components/shared";

/**
 * Where a message that has just arrived belongs.
 *
 * Messages are appended as they arrive, and a streaming reply arrives only
 * once it has finished. Send something while one is in flight and your own
 * bubble is appended first, so the reply that started before you typed lands
 * underneath it: the transcript claims you spoke first when the record says
 * you did not.
 *
 * Placement is by the timestamp the message carries, searching backwards from
 * the end because the ordinary case is that the new message is the newest and
 * the loop stops immediately. Ties keep arrival order, so a render cannot
 * reshuffle two messages that share a second.
 *
 * A message with no timestamp is appended rather than guessed at: inventing a
 * position for it would reorder the transcript on no evidence.
 */
export function placeByTimestamp(transcript: readonly ChatLine[], arriving: ChatLine): ChatLine[] {
  const arrivingAt = timestampOf(arriving);
  if (arrivingAt === undefined) return [...transcript, arriving];

  let index = transcript.length;
  while (index > 0) {
    const previous = transcript[index - 1];
    const previousAt = previous === undefined ? undefined : timestampOf(previous);
    // An untimestamped neighbour cannot be compared, so the search stops
    // rather than stepping over it on an assumption.
    if (previousAt === undefined || previousAt <= arrivingAt) break;
    index -= 1;
  }
  if (index === transcript.length) return [...transcript, arriving];
  return [...transcript.slice(0, index), arriving, ...transcript.slice(index)];
}

function timestampOf(line: ChatLine): number | undefined {
  const raw = line.meta?.timestamp;
  if (raw === undefined || raw === "") return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}
