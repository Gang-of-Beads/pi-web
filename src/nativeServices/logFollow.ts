import { closeSync, openSync, readSync, statSync } from "node:fs";

const pollIntervalMs = 500;
const initialTailBytes = 8 * 1024;

/**
 * `tail -F` for hosts without one (Windows): print the end of each log, then keep printing what is
 * appended. A file that shrinks was truncated by log retention and is read again from its start; a
 * file that does not exist yet is waited for. Runs until the process is interrupted.
 */
export function followLogFiles(paths: readonly string[], write: (chunk: string | Uint8Array) => void = (chunk) => { process.stdout.write(chunk); }): void {
  const offsets = new Map<string, number>();
  let lastWritten: string | undefined;
  const emit = (path: string, chunk: Uint8Array): void => {
    if (chunk.length === 0) return;
    if (paths.length > 1 && lastWritten !== path) write(`${lastWritten === undefined ? "" : "\n"}==> ${path} <==\n`);
    lastWritten = path;
    write(chunk);
  };

  for (const path of paths) {
    const size = fileSize(path);
    if (size === undefined) {
      write(`${path} does not exist yet; waiting for it.\n`);
      offsets.set(path, 0);
      continue;
    }
    const tail = readRange(path, Math.max(0, size - initialTailBytes), size);
    const firstLineBreak = size > initialTailBytes ? tail.indexOf(0x0a) : -1;
    emit(path, firstLineBreak < 0 ? tail : tail.subarray(firstLineBreak + 1));
    offsets.set(path, size);
  }

  setInterval(() => {
    for (const path of paths) {
      const size = fileSize(path);
      if (size === undefined) continue;
      const previous = offsets.get(path) ?? 0;
      const offset = size < previous ? 0 : previous;
      const appended = size > offset ? readRange(path, offset, size) : undefined;
      if (appended === undefined) continue;
      emit(path, appended);
      offsets.set(path, offset + appended.length);
    }
  }, pollIntervalMs);
}

function fileSize(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

/** The bytes between two offsets; a file removed by rotation since it was measured reads as empty. */
function readRange(path: string, start: number, end: number): Uint8Array {
  const buffer = Buffer.alloc(end - start);
  let descriptor: number;
  try {
    descriptor = openSync(path, "r");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return buffer.subarray(0, 0);
    throw error;
  }
  try {
    const length = readSync(descriptor, buffer, 0, buffer.length, start);
    return buffer.subarray(0, length);
  } finally {
    closeSync(descriptor);
  }
}
