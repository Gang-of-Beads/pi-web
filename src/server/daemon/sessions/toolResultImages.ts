/**
 * Tool-result images travel as references, not bytes.
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
 * Tiny images (icons, badges) stay inline: a round trip costs more than the
 * bytes do.
 */
export const INLINE_IMAGE_BYTES = 8 * 1024;

/**
 * Where an image lives, in session terms only: the browser knows which
 * machine and session it is reading and completes the address itself, so the
 * daemon never spells a machine into a message.
 */
export interface ToolResultImageRef {
  toolCallId: string;
  index: number;
}

export type DeferredImageVerdict =
  | { kind: "inline"; reason: "small" | "not-image" | "no-tool-call-id" }
  | { kind: "deferred"; index: number };

export function deferredImageVerdict(part: unknown, index: number, toolCallId: string | undefined): DeferredImageVerdict {
  if (!isRecord(part) || part["type"] !== "image") return { kind: "inline", reason: "not-image" };
  const data = getString(part, "data");
  if (data === undefined) return { kind: "inline", reason: "not-image" };
  if (toolCallId === undefined || toolCallId === "") return { kind: "inline", reason: "no-tool-call-id" };
  if (base64ByteLength(data) <= INLINE_IMAGE_BYTES) return { kind: "inline", reason: "small" };
  return { kind: "deferred", index };
}

/** Replace deferrable image blocks with their reference; returns the same array when nothing changed. */
export function deferToolResultImages(content: unknown, toolCallId: string | undefined): unknown {
  if (!Array.isArray(content)) return content;
  const deferred = content.map((part: unknown, index: number) => deferredImageVerdict(part, index, toolCallId));
  if (!deferred.some((verdict) => verdict.kind === "deferred") || toolCallId === undefined) return content;
  return content.map((part: unknown, index: number) => {
    const verdict = deferred[index];
    if (verdict === undefined || verdict.kind === "inline") return part;
    const mimeType = getString(part, "mimeType") ?? "application/octet-stream";
    const ref: ToolResultImageRef = { toolCallId, index };
    return { type: "image", mimeType, ref };
  });
}

/** The image block at `index` of the tool result `toolCallId`, read from session entries. */
export function findToolResultImage(entries: Iterable<unknown>, toolCallId: string, index: number): { mimeType: string; data: string } | undefined {
  for (const entry of entries) {
    if (!isRecord(entry) || entry["type"] !== "message") continue;
    const message = entry["message"];
    if (!isRecord(message) || message["role"] !== "toolResult" || getString(message, "toolCallId") !== toolCallId) continue;
    const content = message["content"];
    if (!Array.isArray(content)) return undefined;
    const part: unknown = content[index];
    if (!isRecord(part) || part["type"] !== "image") return undefined;
    const data = getString(part, "data");
    const mimeType = getString(part, "mimeType");
    return data === undefined || mimeType === undefined ? undefined : { mimeType, data };
  }
  return undefined;
}

function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}
