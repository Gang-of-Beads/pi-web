import { open, type FileHandle } from "node:fs/promises";
import { pipeline, Readable, Transform } from "node:stream";
import type { FileContentMediaType, PiWebPathAccessConfig } from "../../../shared/apiTypes.js";
import { classifyWorkspaceFile, workspaceFilePreviewByteLimit, workspaceFileName } from "../../../shared/workspaceFiles.js";
import { resolveWorkspacePathAccessTarget } from "./pathAccessPolicy.js";

export interface WorkspaceFilePreview {
  path: string;
  filename: string;
  mediaType?: FileContentMediaType;
  /** Byte count of `body`, safe to advertise as `Content-Length`. */
  size: number;
  modifiedAt: string;
  /**
   * Bytes taken from the descriptor that was validated: an exact snapshot for
   * inline previews, a size-bound stream for downloads and media.
   */
  body: Buffer | Readable;
  /**
   * Set when the response answers a satisfiable range request. `Content-Length`
   * then describes `size` (the served slice), and `contentRange` names the slice
   * within the whole file.
   */
  contentRange?: string;
  /** True when `body` streams from the descriptor instead of sitting in memory. */
  streamed?: boolean;
}

export interface ReadWorkspaceFilePreviewOptions {
  download?: boolean;
  /** Raw `Range` request header. Only a single satisfiable range is honoured. */
  range?: string | undefined;
}

/** A satisfiable single byte range within `size` bytes, per RFC 9110 §14.1. */
export function parseWorkspaceFileRange(range: string | undefined, size: number): { start: number; end: number } | undefined {
  if (range === undefined || range === "") return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (match === null) return undefined;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return undefined;
  if (rawStart === "") {
    // Open-ended suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix === 0) return undefined;
    const start = Math.max(size - suffix, 0);
    return size === 0 ? undefined : { start, end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start >= size) return undefined;
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  return end < start ? undefined : { start, end };
}

export async function readWorkspaceFilePreview(
  rootPath: string,
  path: string | undefined,
  pathAccess?: PiWebPathAccessConfig,
  options: ReadWorkspaceFilePreviewOptions = {},
): Promise<WorkspaceFilePreview> {
  if (path === undefined || path === "") throw new Error("path query parameter is required");
  const { target, displayPath } = await resolveWorkspacePathAccessTarget(rootPath, path, pathAccess);

  // Serve only from this descriptor. Path resolution is a snapshot: a rename,
  // symlink swap, or resize after validation must not be able to change which
  // bytes this response carries, how many of them it carries, or whether they
  // are still inside the workspace or an allowed root.
  const handle = await open(target, "r");
  let streamOwnsHandle = false;
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error("Path is not a file");
    const metadata = { path: displayPath, filename: workspaceFileName(displayPath), modifiedAt: stats.mtime.toISOString() };

    // Download mode serves any file as an opaque octet-stream attachment. No
    // size cap: the response is streamed, and the browser writes it straight to
    // disk. The stream still cannot exceed the validated size.
    if (options.download === true) {
      if (stats.size === 0) return { ...metadata, size: 0, body: Buffer.alloc(0) };
      streamOwnsHandle = true;
      return { ...metadata, size: stats.size, body: validatedFileStream(handle, stats.size), streamed: true };
    }

    const classification = classifyWorkspaceFile(displayPath);
    if (classification === undefined || !("previewMimeType" in classification)) throw new Error("Inline preview is not supported for this file type");
    const limit = workspaceFilePreviewByteLimit(classification);
    if (stats.size > limit.bytes) throw new Error(`File is too large to preview (limit ${limit.label})`);

    // Media is streamed so a file the size of the limit costs the same memory
    // as one the size of a thumbnail, and so a media element can seek with a
    // range request instead of refetching the whole clip.
    if (limit.streamed && stats.size > 0) {
      const range = parseWorkspaceFileRange(options.range, stats.size);
      streamOwnsHandle = true;
      if (range === undefined) {
        return { ...metadata, mediaType: classification.mediaType, size: stats.size, body: validatedFileStream(handle, stats.size), streamed: true };
      }
      const length = range.end - range.start + 1;
      return {
        ...metadata,
        mediaType: classification.mediaType,
        size: length,
        body: validatedFileStream(handle, length, range.start),
        contentRange: `bytes ${String(range.start)}-${String(range.end)}/${String(stats.size)}`,
        streamed: true,
      };
    }

    const body = await readValidatedSnapshot(handle, stats.size);
    return { ...metadata, mediaType: classification.mediaType, size: body.byteLength, body };
  } finally {
    if (!streamOwnsHandle) await handle.close();
  }
}

/**
 * Read exactly the validated number of bytes. Growth after validation is
 * ignored, and a file that shrank fails the request before any header is sent
 * instead of desynchronizing the advertised length.
 */
async function readValidatedSnapshot(handle: FileHandle, size: number): Promise<Buffer> {
  if (size === 0) return Buffer.alloc(0);
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
    if (bytesRead === 0) throw new Error("File changed while it was being read");
    offset += bytesRead;
  }
  return buffer;
}

/**
 * Stream the validated byte range from the open descriptor. Extra bytes written
 * after validation are never sent, and a short read fails the response instead
 * of silently truncating an advertised `Content-Length`.
 */
function validatedFileStream(handle: FileHandle, size: number, start = 0): Readable {
  const source = handle.createReadStream({ start, end: start + size - 1, autoClose: true });
  let streamed = 0;
  const exactLength = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      streamed += chunk.byteLength;
      done(null, chunk);
    },
    flush(done) {
      done(streamed === size ? null : new Error("File changed while it was being read"));
    },
  });
  // The callback keeps a teardown failure from becoming an unhandled error; the
  // returned stream still emits it, which fails the in-flight response.
  return pipeline(source, exactLength, () => { /* surfaced on the returned stream */ });
}
