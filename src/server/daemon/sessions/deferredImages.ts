/**
 * Transcript images travel as references, not bytes: a tool result's, and one the reader sent.
 *
 * The text bound (toolResultBounds.ts) left image blocks untouched, so a
 * session with screenshots still answered a transcript page with megabytes of
 * base64 - the same "the session never loads" failure on a phone, and the one
 * that made the browser's per-session history cache skip exactly those
 * sessions. The session file keeps every byte; on the wire an image block is
 * replaced by the address the browser can fetch it from when it scrolls into
 * view. Nothing is omitted, so nothing needs a "missing" marker: the row says
 * an image is there and the bytes follow on demand.
 *
 * Images the reader sent stayed inline after tool results stopped being: scrolling up through a
 * 1018-message session on a weak link (1.6 Mbps, 150 ms), two history pages each carried one
 * photo as 2.8 MB of base64, took 9.4 s and 9.9 s, and were 19.8 s of the 23.1 s the reader
 * waited at the top (r158). A message on a page names its session entry, so its images are
 * addressed by the entry. A live frame of a just-sent message still carries its image to each
 * browser watching then, twice: the acceptance echo and the committed `message_end` each carry it,
 * and both are published before pi writes the entry (pi `AgentSession` emits `message_end` to
 * listeners, then appends), so there is no entry to name yet. Every later read gets the reference.
 *
 * Tiny images (icons, badges) stay inline: a round trip costs more than the
 * bytes do.
 */
import type { DeferredImageRef } from "../../../shared/apiTypes.js";
import { getString, isRecord } from "../../../shared/unknownValues.js";
export const INLINE_IMAGE_BYTES = 8 * 1024;

/** Whose image it is: a tool result names its call, a message the reader sent names its session entry. */
type ImageOwner = { toolCallId: string } | { entryId: string };

export type DeferredImageVerdict =
  | { kind: "inline"; reason: "small" | "not-image" | "no-owner" }
  | { kind: "deferred"; index: number };

export function deferredImageVerdict(part: unknown, index: number, owner: ImageOwner | undefined): DeferredImageVerdict {
  if (!isRecord(part) || part["type"] !== "image") return { kind: "inline", reason: "not-image" };
  const data = getString(part, "data");
  if (data === undefined) return { kind: "inline", reason: "not-image" };
  if (owner === undefined || ownerId(owner) === "") return { kind: "inline", reason: "no-owner" };
  if (base64ByteLength(data) <= INLINE_IMAGE_BYTES) return { kind: "inline", reason: "small" };
  return { kind: "deferred", index };
}

/** Replace deferrable image blocks with their reference; returns the same array when nothing changed. */
export function deferImages(content: unknown, owner: ImageOwner | undefined): unknown {
  if (!Array.isArray(content) || owner === undefined) return content;
  const deferred = content.map((part: unknown, index: number) => deferredImageVerdict(part, index, owner));
  if (!deferred.some((verdict) => verdict.kind === "deferred")) return content;
  return content.map((part: unknown, index: number) => {
    const verdict = deferred[index];
    if (verdict === undefined || verdict.kind === "inline") return part;
    const mimeType = getString(part, "mimeType") ?? "application/octet-stream";
    const ref: DeferredImageRef = { ...owner, index };
    return { type: "image", mimeType, ref };
  });
}

/** A tool result's owner, when its call has an id to address its images by. */
export function toolCallOwner(toolCallId: string | undefined): ImageOwner | undefined {
  return toolCallId === undefined ? undefined : { toolCallId };
}

/** The image block a reference names, read from session entries. */
export function findDeferredImage(entries: Iterable<unknown>, ref: DeferredImageRef): { mimeType: string; data: string } | undefined {
  for (const entry of entries) {
    if (!isRecord(entry) || entry["type"] !== "message") continue;
    const message = entry["message"];
    if (!isRecord(message) || !ownsImage(entry, message, ref)) continue;
    return imageBlockAt(message["content"], ref.index);
  }
  return undefined;
}

function ownsImage(entry: Record<string, unknown>, message: Record<string, unknown>, ref: DeferredImageRef): boolean {
  if ("toolCallId" in ref) return message["role"] === "toolResult" && getString(message, "toolCallId") === ref.toolCallId;
  return message["role"] === "user" && getString(entry, "id") === ref.entryId;
}

function imageBlockAt(content: unknown, index: number): { mimeType: string; data: string } | undefined {
  if (!Array.isArray(content)) return undefined;
  const part: unknown = content[index];
  if (!isRecord(part) || part["type"] !== "image") return undefined;
  const data = getString(part, "data");
  const mimeType = getString(part, "mimeType");
  return data === undefined || mimeType === undefined ? undefined : { mimeType, data };
}

function ownerId(owner: ImageOwner): string {
  return "toolCallId" in owner ? owner.toolCallId : owner.entryId;
}

function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}
