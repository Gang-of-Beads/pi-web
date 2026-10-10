import { loadComposerAttachments, saveComposerAttachments } from "./composerAttachmentStore";
import type { CapturedAttachment } from "./promptAttachmentCapture";

/**
 * Attachments captured in a composer and not yet sent: this page's copy of every session's,
 * the session on screen included (the composer holds them on every change), written through
 * to this browser so a reload keeps them.
 *
 * A session's text draft survived switching away and back; its images did not. The composer
 * emptied them on every switch so that session A's image could not go out with session B's
 * send, and the reader who came back to A found the image gone. They are held under the same
 * machine + session key as the text draft and handed back on return.
 *
 * The write-through goes to composerAttachmentStore (owner D2). A session's record is written
 * only once this page has read it, so a fresh page never writes over attachments it has not
 * seen yet; what the read finds goes before anything attached meanwhile. A record that cannot
 * be read is never written, so the session stays in memory for this page and a later page can
 * still read it.
 */
const held = new Map<string, readonly CapturedAttachment[]>();
const reads = new Map<string, Promise<readonly CapturedAttachment[]>>();
const readable = new Set<string>();
const movedTo = new Map<string, string>();

/** Hold a session's unsent attachments, replacing what was held for it; none clears the hold. */
export function holdComposerAttachments(key: string, attachments: readonly CapturedAttachment[]): void {
  const target = forwarded(key);
  if (attachments.length === 0) held.delete(target);
  else held.set(target, [...attachments]);
  if (readable.has(target)) saveComposerAttachments(target, attachments);
}

/** Add to a session's hold: a file that finished reading after the reader left the session. */
export function addToHeldComposerAttachments(key: string, attachments: readonly CapturedAttachment[]): void {
  const target = forwarded(key);
  holdComposerAttachments(target, [...(held.get(target) ?? []), ...attachments]);
}

/** Hand a session's held attachments to the composer switching to it and clear the entry; the composer's next update holds them again. */
export function takeHeldComposerAttachments(key: string): CapturedAttachment[] {
  const attachments = held.get(key) ?? [];
  held.delete(key);
  return [...attachments];
}

/**
 * Read this browser's record of a session, once per page. What it finds is held before
 * anything attached meanwhile, and answered (once) so the composer showing the session can put
 * it back on screen; a session read before answers none.
 */
export function restoreHeldComposerAttachments(key: string): Promise<readonly CapturedAttachment[]> {
  if (reads.has(key)) return Promise.resolve([]);
  const read = loadComposerAttachments(key).then((stored) => {
    if (stored === undefined) return [];
    readable.add(key);
    const target = forwarded(key);
    if (target !== key) saveComposerAttachments(key, []);
    holdComposerAttachments(target, [...stored, ...(held.get(target) ?? [])]);
    return stored;
  });
  reads.set(key, read);
  return read;
}

/** A session that was still starting got its id: its attachments go with it, as its text does (moveDraft). */
export function moveHeldComposerAttachments(fromKey: string, toKey: string): void {
  const attachments = held.get(fromKey) ?? [];
  held.delete(fromKey);
  if (readable.has(fromKey)) saveComposerAttachments(fromKey, []);
  movedTo.delete(toKey);
  movedTo.set(fromKey, toKey);
  reads.set(toKey, Promise.resolve([]));
  readable.add(toKey);
  holdComposerAttachments(toKey, attachments);
}

/** Where a session's attachments live now: a session that was starting moved to its real id, perhaps more than once. */
function forwarded(key: string): string {
  const next = movedTo.get(key);
  return next === undefined ? key : forwarded(next);
}
