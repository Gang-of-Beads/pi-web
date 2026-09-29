import type { CapturedAttachment } from "./promptAttachmentCapture";

/**
 * Attachments captured in a composer and not yet sent, held per session while the reader is
 * elsewhere.
 *
 * A session's text draft survived switching away and back; its images did not. The composer
 * emptied them on every switch so that session A's image could not go out with session B's
 * send, and the reader who came back to A found the image gone. They are held under the same
 * machine + session key as the text draft and handed back on return. Memory only: images run
 * to megabytes, which the storage the text draft uses cannot hold, so a reload still drops them.
 */
const held = new Map<string, readonly CapturedAttachment[]>();

/** Hold a session's unsent attachments, replacing what was held for it; none clears the hold. */
export function holdComposerAttachments(key: string, attachments: readonly CapturedAttachment[]): void {
  if (attachments.length === 0) held.delete(key);
  else held.set(key, [...attachments]);
}

/** Add to a session's hold: a file that finished reading after the reader left the session. */
export function addToHeldComposerAttachments(key: string, attachments: readonly CapturedAttachment[]): void {
  holdComposerAttachments(key, [...(held.get(key) ?? []), ...attachments]);
}

/** Hand a session's held attachments to the composer showing it; the hold empties. */
export function takeHeldComposerAttachments(key: string): CapturedAttachment[] {
  const attachments = held.get(key) ?? [];
  held.delete(key);
  return [...attachments];
}
