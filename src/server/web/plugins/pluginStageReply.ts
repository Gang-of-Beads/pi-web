import { open, type FileHandle } from "node:fs/promises";
import type { Readable } from "node:stream";
import type { ServerPluginStageRequest } from "../../../server-plugin-api.js";
import { rgbaToThumbHash } from "../../../shared/thumbhash.js";
import type { StageHost } from "../media/stageHost.js";
import { sendPluginFile, type FileReply } from "./pluginFileReply.js";

/**
 * The host's answer to `reply.sendStage`: a derived stage of a file a plugin route opened, from the
 * stage cache or made by the route's producer (see `ServerPluginReply.sendStage`). The source file
 * is only stat'ed and closed at once: a producer's tools read it by path. A cached stage goes out
 * through the same file answer as `sendFile`, with a strong `ETag` and a year-long cache header,
 * since the file's version is part of the key; a request that already holds that `ETag` gets 304.
 * Refusals and failures answer JSON and are never cached. No answer may be sniffed into another type.
 */

export interface StageReply extends FileReply {
  readonly request: FileReply["request"] & { readonly headers: FileReply["request"]["headers"] & { readonly "if-none-match"?: string | undefined } };
  /** Without a payload for a 304, which then carries no `Content-Length`. */
  send(payload?: Buffer | Readable): unknown;
}

const STAGE_CACHE_CONTROL = "private, max-age=31536000, immutable";

export async function sendPluginStage(reply: StageReply, pluginId: string, request: ServerPluginStageRequest, host: StageHost): Promise<void> {
  reply.header("X-Content-Type-Options", "nosniff");
  const { size, modifiedMs } = await versionThenClose(request.file);
  const version = `${String(size)}-${String(modifiedMs)}`;
  if (request.version !== undefined && request.version !== version) {
    await answerJson(reply, 409, { error: "the file changed", version });
    return;
  }
  const tools = await host.tools();
  const outcome = await host.cache.obtain(
    { pluginId, path: request.path, size, modifiedMs, stage: request.stage },
    (output, signal) => request.produce({
      output,
      tools,
      signal,
      thumbHash: (image) => Buffer.from(rgbaToThumbHash(image)).toString("base64"),
    }),
  );
  if (outcome.kind === "unavailable") {
    await answerJson(reply, 422, { stage: request.stage, reason: outcome.reason });
    return;
  }
  if (outcome.kind === "failed") {
    await answerJson(reply, 500, { stage: request.stage, reason: outcome.reason });
    return;
  }
  reply.header("ETag", outcome.etag);
  reply.header("Cache-Control", STAGE_CACHE_CONTROL);
  if (reply.request.headers["if-none-match"] === outcome.etag) {
    reply.code(304);
    await reply.send();
    return;
  }
  let cached: FileHandle;
  try {
    cached = await open(outcome.path, "r");
  } catch {
    await answerJson(reply, 503, { stage: request.stage, reason: "the cached stage was removed while it was asked for; ask again" });
    return;
  }
  reply.header("Content-Type", request.contentType);
  await sendPluginFile(reply, cached);
}

/**
 * The file's size and modification time in the whole milliseconds its `mtime` date holds, the same
 * ones a listing's `modifiedAt` shows, so a browser can name the version it was shown; Node rounds
 * that date from `mtimeMs`, so truncating `mtimeMs` would differ for most files.
 */
async function versionThenClose(file: FileHandle): Promise<{ size: number; modifiedMs: number }> {
  try {
    const stats = await file.stat();
    return { size: stats.size, modifiedMs: stats.mtime.getTime() };
  } finally {
    await file.close().catch(() => undefined);
  }
}

async function answerJson(reply: StageReply, status: number, body: Record<string, string>): Promise<void> {
  reply.code(status);
  reply.header("Content-Type", "application/json; charset=utf-8");
  reply.header("Cache-Control", "no-store");
  await reply.send(Buffer.from(JSON.stringify(body)));
}
