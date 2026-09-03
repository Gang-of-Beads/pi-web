/**
 * Give each queued prompt back the id the browser minted for it.
 *
 * The browser sends a clientMessageId so it can mark its own bubble instead of
 * listing the same message twice. The runtime's queue does not carry that id,
 * so the daemon has to re-attach it - and it used to do so by matching the
 * queue entry's text against the text that was submitted.
 *
 * Text equality is not identity. The runtime expands `/skill` and prompt
 * templates before queueing, so the committed text is not the typed text; a
 * prompt whose payload is an attachment carries little or no text at all, and
 * one empty string matches every other. Each mismatch leaves the entry without
 * an id, the browser fails to claim its bubble, and a second row appears for a
 * message already on screen. That duplicate was reported five times, and every
 * previous fix removed one way for the texts to differ rather than the reliance
 * on their being equal.
 *
 * Prompts enter the queue in submission order and leave it in the same order,
 * so position is the correlation the runtime actually preserves - but only
 * within a lane. The runtime keeps steering messages and follow-ups in separate
 * queues and the status lists them lane by lane, while submissions are recorded
 * in the order they arrive whatever their lane. Correlating across the whole
 * list therefore swapped ids between lanes the moment both were in use: a
 * follow-up sent first and a steer sent second were listed steer-first, so each
 * received the other's id and neither browser bubble could be claimed. That is
 * the duplicate again, in the one arrangement the position rule does not hold.
 */
export interface QueuedPromptRecord {
  clientMessageId: string;
  text: string;
  /** The lane this prompt was submitted into. Absent from records written by
   *  an older process, which are correlated as before. */
  kind?: string;
}

interface QueuedLike {
  kind?: string;
  text: string;
  clientMessageId?: string;
}

export function correlateQueuedPromptIds<T extends QueuedLike>(queued: readonly T[], records: readonly QueuedPromptRecord[]): T[] {
  if (records.length === 0) return [...queued];
  const remaining = [...dropDeliveredRecords(queued, records)];
  return queued.map((entry) => {
    // An id already on the entry was set by whoever owns it; this only fills
    // gaps, so a re-read cannot reassign a message to a different sender.
    if (entry.clientMessageId !== undefined) return entry;
    // Take the oldest record from this entry's own lane. A record with no lane
    // predates this and is taken in order, which is what it was written under.
    const index = remaining.findIndex((record) => record.kind === undefined || entry.kind === undefined || record.kind === entry.kind);
    if (index === -1) return entry;
    const [record] = remaining.splice(index, 1);
    return record === undefined ? entry : { ...entry, clientMessageId: record.clientMessageId };
  });
}

/**
 * Forget the records whose prompts have already left the queue.
 *
 * Records are written when a prompt is queued and, until now, were only removed
 * when one was recalled - never when one was simply delivered. A queue of two
 * that drains its first entry therefore left two records against one entry, and
 * the survivor took the departed prompt's id. The mismatch then fixed itself in
 * place: the cleanup pass keeps whichever record an entry is carrying, so the
 * wrong pairing was the one preserved and every later message inherited it.
 *
 * The queue is first-in first-out per lane, so when a lane holds fewer entries
 * than records, the oldest surplus records are the delivered ones. No text is
 * compared to work that out, which is the point: text is what this whole file
 * exists to stop relying on.
 */
function dropDeliveredRecords(queued: readonly QueuedLike[], records: readonly QueuedPromptRecord[]): QueuedPromptRecord[] {
  const wanted = new Map<string, number>();
  for (const entry of queued) {
    if (entry.clientMessageId !== undefined) continue;
    const lane = entry.kind ?? "";
    wanted.set(lane, (wanted.get(lane) ?? 0) + 1);
  }
  const perLane = new Map<string, QueuedPromptRecord[]>();
  for (const record of records) {
    const lane = record.kind ?? "";
    const bucket = perLane.get(lane) ?? [];
    bucket.push(record);
    perLane.set(lane, bucket);
  }
  const keep = new Set<QueuedPromptRecord>();
  for (const [lane, bucket] of perLane) {
    // A lane the caller cannot resolve keeps everything: dropping records on a
    // count nobody established would lose ids that are still owed a bubble.
    const room = lane === "" ? bucket.length : wanted.get(lane) ?? 0;
    for (const record of bucket.slice(Math.max(0, bucket.length - room))) keep.add(record);
  }
  return records.filter((record) => keep.has(record));
}
