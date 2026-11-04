import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, open, stat, unlink, utimes } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { renamePath } from "../../shared/storage/stateFiles.js";
import { tryParseEntry } from "./sessionFileFormat.js";

/** The header fields a folder move changes: where the session ran, and the file of its parent. */
export interface SessionHeaderPaths {
  readonly cwd?: string | undefined;
  readonly parentSession?: string | undefined;
}

/**
 * What a rewrite found. `rewritten`: the header held the expected paths and now holds the new
 * ones. `unchanged`: it already held the new ones. `elsewhere`: it holds neither, or the file has
 * no session header - what the file says is not what the caller planned for.
 */
export type SessionHeaderRewrite = "rewritten" | "unchanged" | "elsewhere";

const HEADER_READ_CAP_BYTES = 262144;
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/**
 * Give a session file's header new paths, keeping every other byte as it was.
 *
 * A project rename moves the folder a session ran in, and Pi reads the folder from the header:
 * a header left naming the old folder opens nowhere. The header is the first line that parses,
 * as `readSessionHeaderSummary` finds it (lines before it that do not parse stay as they are), and
 * changing it changes its length, so the file is written again - beside the original under a name
 * of its own and moved onto it, so a reader sees the old file or the new one and a crash leaves
 * the original whole. The new file keeps the old one's mode and times: a session's modification
 * time is its last activity in every list, and moving its folder is not activity. The header is
 * changed only while it holds `expected`, so applying a rewrite twice, or undoing one that never
 * happened, changes nothing.
 */
export async function rewriteSessionHeaderPaths(file: string, expected: SessionHeaderPaths, next: SessionHeaderPaths): Promise<SessionHeaderRewrite> {
  const line = await readHeaderLine(file);
  if (line === undefined) return "elsewhere";
  if (holds(line.header, next)) return "unchanged";
  if (!holds(line.header, expected)) return "elsewhere";
  const rewritten = withPaths(line.header, next);
  const staged = join(dirname(file), `.${basename(file)}.${randomUUID()}.rewrite`);
  const { mode, atime, mtime } = await stat(file);
  try {
    await writeStaged(staged, file, line, `${JSON.stringify(rewritten)}${line.lineEnd}`);
    await chmod(staged, mode & 0o7777);
    await utimes(staged, atime, mtime);
    await renamePath(staged, file);
  } catch (error) {
    await unlink(staged).catch(() => undefined);
    throw error;
  }
  return "rewritten";
}

interface HeaderLine {
  readonly header: Record<string, unknown>;
  /** Where the header line starts: the bytes before it are kept. */
  readonly start: number;
  readonly lineEnd: string;
  /** Where the rest of the file starts, after the header's line end. */
  readonly restStart: number;
}

/** The value as the header reader reads it: a string that is not empty, or nothing. */
function pathField(header: Record<string, unknown>, key: keyof SessionHeaderPaths): string | undefined {
  const value = header[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function holds(header: Record<string, unknown>, paths: SessionHeaderPaths): boolean {
  return pathField(header, "cwd") === paths.cwd && pathField(header, "parentSession") === paths.parentSession;
}

/** The header with `next`'s paths, every other field kept, and in its place. */
function withPaths(header: Record<string, unknown>, next: SessionHeaderPaths): Record<string, unknown> {
  const rewritten: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(header)) {
    const changes = (key === "cwd" || key === "parentSession") && next[key] !== pathField(header, key);
    const replaced = changes ? next[key] : value;
    if (replaced !== undefined) rewritten[key] = replaced;
  }
  for (const key of ["cwd", "parentSession"] as const) {
    const value = next[key];
    if (value !== undefined && !(key in rewritten)) rewritten[key] = value;
  }
  return rewritten;
}

async function writeStaged(staged: string, source: string, line: HeaderLine, header: string): Promise<void> {
  const output = createWriteStream(staged, { flags: "wx" });
  if (line.start > 0) await pipeline(createReadStream(source, { start: 0, end: line.start - 1 }), output, { end: false });
  await new Promise<void>((resolve, reject) => {
    output.once("error", reject);
    output.write(header, (error) => { if (error === null || error === undefined) resolve(); else reject(error); });
  });
  await pipeline(createReadStream(source, { start: line.restStart }), output);
  const handle = await open(staged, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * The first line of `file` that parses, when it is a session header; lines that do not parse are
 * passed over, as Pi passes over them. A file whose only line has no line end ends at the header.
 */
async function readHeaderLine(file: string): Promise<HeaderLine | undefined> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(HEADER_READ_CAP_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const read = buffer.subarray(0, bytesRead);
    let start = 0;
    while (start < bytesRead) {
      const newlineAt = read.indexOf(NEWLINE, start);
      const ended = newlineAt !== -1;
      if (!ended && bytesRead === buffer.length) return undefined;
      const end = ended ? newlineAt : bytesRead;
      const carriageReturn = end > start && read[end - 1] === CARRIAGE_RETURN;
      const entry = tryParseEntry(read.toString("utf8", start, carriageReturn ? end - 1 : end));
      if (entry !== undefined) {
        if (entry["type"] !== "session") return undefined;
        return { header: entry, start, lineEnd: ended ? (carriageReturn ? "\r\n" : "\n") : "", restStart: ended ? end + 1 : end };
      }
      start = end + 1;
    }
    return undefined;
  } finally {
    await handle.close();
  }
}
