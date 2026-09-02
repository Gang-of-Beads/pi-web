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
 * so position is the correlation the runtime actually preserves.
 */
export interface QueuedPromptRecord {
  clientMessageId: string;
  text: string;
}

interface QueuedLike {
  text: string;
  clientMessageId?: string;
}

export function correlateQueuedPromptIds<T extends QueuedLike>(queued: readonly T[], records: readonly QueuedPromptRecord[]): T[] {
  if (records.length === 0) return [...queued];
  const remaining = [...records];
  return queued.map((entry) => {
    // An id already on the entry was set by whoever owns it; this only fills
    // gaps, so a re-read cannot reassign a message to a different sender.
    if (entry.clientMessageId !== undefined) return entry;
    const record = remaining.shift();
    return record === undefined ? entry : { ...entry, clientMessageId: record.clientMessageId };
  });
}
