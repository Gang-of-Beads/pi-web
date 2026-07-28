import { open } from "node:fs/promises";

/** Bytes read from a session file to parse its single-line JSON header. */
const HEADER_READ_BYTES = 4096;

/**
 * The header fields PI WEB reads directly from a Pi session file.
 *
 * Pi writes this as the first line of the `.jsonl` session file when the
 * session is created and never rewrites it, except for `parentSession`, which
 * PI WEB itself can clear when detaching a child. `cwd` and `id` are therefore
 * safe to treat as immutable for a given path.
 */
export interface SessionHeaderSummary {
  id: string;
  /** Working directory the session was started in. Absent in very old session files. */
  cwd?: string;
  /** Session file of the parent session, when this session was spawned or forked from one. */
  parentSession?: string;
}

/**
 * Read a Pi session file's header without loading the whole transcript.
 *
 * Returns undefined for any unreadable, non-JSON, or non-session first line:
 * callers use this to verify links between sessions, so an unusable header must
 * behave the same as a missing one rather than throwing.
 */
export async function readSessionHeaderSummary(sessionFile: string): Promise<SessionHeaderSummary | undefined> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(sessionFile, "r");
    const buffer = Buffer.alloc(HEADER_READ_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n", 1)[0];
    if (firstLine === undefined || firstLine === "") return undefined;
    const header: unknown = JSON.parse(firstLine);
    if (!isRecord(header) || header["type"] !== "session" || typeof header["id"] !== "string") return undefined;
    const cwd = nonEmptyStringField(header, "cwd");
    const parentSession = nonEmptyStringField(header, "parentSession");
    return {
      id: header["id"],
      ...(cwd === undefined ? {} : { cwd }),
      ...(parentSession === undefined ? {} : { parentSession }),
    };
  } catch {
    return undefined;
  } finally {
    await file?.close().catch(() => undefined);
  }
}

function nonEmptyStringField(header: Record<string, unknown>, key: string): string | undefined {
  const value = header[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
