import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { pipeline, Transform, type Readable } from "node:stream";

/**
 * Answering with a file a plugin route opened and validated: the host side of
 * `ServerPluginReply.sendFile`.
 *
 * The route decides which file may be answered: it resolves the path, opens the
 * descriptor and validates it. From the hand-over the host owns the descriptor,
 * so byte ranges, validators, exact lengths and the descriptor's life stay in one
 * place. Plugins used to stream their own descriptors, and one whose client left
 * before the first read was closed only by garbage collection, which Node 25
 * turned into a process-ending ERR_INVALID_STATE (Gang-of-Beads/pi-web#71).
 */

/** The faces of one exchange that answering with a file needs; a fastify reply has them. */
export interface FileReply {
  readonly request: {
    readonly method: string;
    readonly headers: { readonly range?: string | undefined; readonly "if-range"?: string | undefined };
  };
  readonly sent: boolean;
  readonly log: { warn(message: string): void };
  code(status: number): unknown;
  header(name: string, value: string): unknown;
  send(payload: Buffer | Readable): unknown;
}

interface ServedBytes {
  readonly start: number;
  readonly length: number;
  /** The served slice within the whole file, set when the answer is a 206. */
  readonly contentRange?: string;
}

interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Answers with as many bytes as the file held when the call was made, or the one
 * satisfiable range a GET asked for, and closes the descriptor however the answer
 * ends: sent, failed, or left by the client before or during the transfer. A reply
 * that was already sent, by a route that answered twice or did not wait for this
 * call, gets nothing more: fastify would ignore the body and leave it unread, so
 * the file is closed unsent and the route's mistake is logged.
 */
export async function sendPluginFile(reply: FileReply, file: FileHandle): Promise<void> {
  const stats = await statOrClose(file);
  if (reply.sent) {
    await file.close();
    reply.log.warn("a plugin route answered with a file after its reply was sent; the file was closed unsent");
    return;
  }
  const lastModified = stats.mtime.toUTCString();
  const bytes = servedBytes(reply.request, stats.size, lastModified);
  reply.header("Last-Modified", lastModified);
  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Length", String(bytes.length));
  if (bytes.contentRange !== undefined) {
    reply.code(206);
    reply.header("Content-Range", bytes.contentRange);
  }
  if (bytes.length === 0) {
    await file.close();
    await reply.send(Buffer.alloc(0));
    return;
  }
  const body = exactBytes(file, bytes.start, bytes.length);
  try {
    await reply.send(body);
  } catch (error) {
    body.destroy();
    throw error;
  }
}

async function statOrClose(file: FileHandle): Promise<Stats> {
  try {
    return await file.stat();
  } catch (error) {
    await file.close();
    throw error;
  }
}

/**
 * Range handling is defined for GET alone (RFC 9110 §14.2), and an `If-Range`
 * other than the file's own `Last-Modified` asks for the whole file (§13.1.5),
 * so a resumed transfer does not splice a file changed in a later second onto
 * what it already holds; `Last-Modified` counts whole seconds.
 */
function servedBytes(request: FileReply["request"], size: number, lastModified: string): ServedBytes {
  const ifRange = request.headers["if-range"];
  const rangeApplies = request.method === "GET" && (ifRange === undefined || ifRange === lastModified);
  const range = rangeApplies ? satisfiableRange(request.headers.range, size) : undefined;
  if (range === undefined) return { start: 0, length: size };
  return {
    start: range.start,
    length: range.end - range.start + 1,
    contentRange: `bytes ${String(range.start)}-${String(range.end)}/${String(size)}`,
  };
}

/**
 * The single satisfiable byte range a `Range` header asks for within `size`
 * bytes, per RFC 9110 §14.1.2: `first-last`, `first-`, or the suffix `-length`.
 * Anything else (absent, malformed, several ranges, or past the end) is answered
 * with the whole file, which every media element accepts.
 */
function satisfiableRange(header: string | undefined, size: number): ByteRange | undefined {
  if (header === undefined || size === 0) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (match === null) return undefined;
  const [, first = "", last = ""] = match;
  if (first === "") {
    const suffix = Number(last);
    if (last === "" || !Number.isSafeInteger(suffix) || suffix === 0) return undefined;
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(first);
  if (!Number.isSafeInteger(start) || start >= size) return undefined;
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  return end < start ? undefined : { start, end };
}

/**
 * Exactly `length` bytes from `start` of the descriptor. Nothing past that
 * length is sent even if the file grew, and a file that shrank fails the answer
 * instead of cutting short the `Content-Length` it advertised. The read stream
 * closes the descriptor when it ends or is destroyed, and destroying the returned
 * stream, as fastify does when the client leaves, destroys the read stream. The
 * returned stream carries any failure to the answer, so the pipeline's own
 * callback has nothing left to do.
 */
function exactBytes(file: FileHandle, start: number, length: number): Readable {
  const source = file.createReadStream({ start, end: start + length - 1, autoClose: true });
  let sent = 0;
  const exactLength = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      sent += chunk.byteLength;
      done(null, chunk);
    },
    flush(done) {
      done(sent === length ? null : new Error("File changed while it was being read"));
    },
  });
  return pipeline(source, exactLength, () => undefined);
}
