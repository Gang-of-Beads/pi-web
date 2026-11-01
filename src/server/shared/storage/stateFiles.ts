import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Writing and removing PI WEB state files on terms Windows accepts.
 *
 * A state file is replaced in one step: the new contents are written beside it and renamed onto it,
 * so a reader, in this process or the other one, sees the old contents or the new, never a
 * half-written file. Windows refuses that rename, and a removal, while any handle holds the file
 * open, answering EPERM, EACCES or EBUSY: a reader in this process or the other PI WEB process, an
 * antivirus scan, the search indexer, a backup tool. Each holds it for a moment, so the operation is
 * tried again every 10 ms until a second has passed since the first refusal (`BUSY_FILE_PATIENCE_MS`),
 * timed rather than counted because Windows's timer stretches a 10 ms wait to about 16, and only then
 * fails. Measured on a
 * Windows 11 machine with real-time protection on: a freshly written file was never held, and a file
 * read every 50 ms was held about 15 ms per read. Retried every 50 ms instead, the rename fell into
 * step with such a reader and met it for a whole second, which left a message waiting in the inbox
 * instead of reaching pi. Elsewhere these codes do not clear: `replaceFile` and `removeFile` fail as
 * before, a second later, and `replaceFileSync` at once.
 */

const BUSY_FILE_CODES = ["EPERM", "EACCES", "EBUSY"];
export const BUSY_FILE_WAIT_MS = 10;
export const BUSY_FILE_PATIENCE_MS = 1_000;
const REFUSALS_CLEAR = process.platform === "win32";

export interface StateFileOptions {
  /**
   * The new file's permission bits. The write applies them through the umask, which can only narrow
   * them; a chmod then makes them exact where the filesystem allows one.
   */
  readonly mode?: number;
}

/**
 * One of the codes Windows answers while another handle holds a file open. Elsewhere they mean a
 * lasting refusal, which waiting does not clear.
 */
export function isBusyFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && BUSY_FILE_CODES.some((code) => error.code === code);
}

/** Whether a refusal first met at `since`, a `performance.now()`, is still worth waiting out. */
export function stillWaitingOut(since: number): boolean {
  return performance.now() - since < BUSY_FILE_PATIENCE_MS;
}

export async function replaceFile(path: string, contents: string, options: StateFileOptions = {}): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const staged = stagedPath(path);
  try {
    await writeFile(staged, contents, { encoding: "utf8", flag: "wx", ...modeOption(options) });
    if (options.mode !== undefined) await chmod(staged, options.mode).catch(() => undefined);
    await waitingOutRefusal(() => rename(staged, path));
  } finally {
    await rm(staged, { force: true }).catch(() => undefined);
  }
}

/**
 * `replaceFile` for the writers whose callers rely on the write having landed when they return. Its
 * wait blocks the whole process, so it waits only on Windows, where a refusal clears; elsewhere a
 * lasting refusal fails at once rather than stalling every session for a second. Blocked, this
 * process cannot finish its own asynchronous reads, so a hold by one of them lasts the whole wait:
 * it suits only files this process reads synchronously, as its callers' are, which only another
 * process can hold.
 */
export function replaceFileSync(path: string, contents: string, options: StateFileOptions = {}): void {
  mkdirSync(dirname(path), { recursive: true });
  const staged = stagedPath(path);
  try {
    writeFileSync(staged, contents, { encoding: "utf8", flag: "wx", ...modeOption(options) });
    if (options.mode !== undefined) chmodQuietlySync(staged, options.mode);
    waitingOutRefusalSync(() => { renameSync(staged, path); });
  } finally {
    removeQuietlySync(staged);
  }
}

/** Removes a state file that may already be gone. */
export async function removeFile(path: string): Promise<void> {
  await waitingOutRefusal(() => rm(path, { force: true }));
}

/** Beside the file, so the rename stays on its volume; dot-prefixed; unique to this write, so concurrent writers never share one. */
function stagedPath(path: string): string {
  return join(dirname(path), `.${basename(path)}.${String(process.pid)}.${randomUUID()}.tmp`);
}

function modeOption(options: StateFileOptions): { mode?: number } {
  return options.mode === undefined ? {} : { mode: options.mode };
}

async function waitingOutRefusal(operation: () => Promise<void>): Promise<void> {
  let refusedSince: number | undefined;
  for (;;) {
    try {
      await operation();
      return;
    } catch (error) {
      if (!isBusyFileError(error)) throw error;
      refusedSince ??= performance.now();
      if (!stillWaitingOut(refusedSince)) throw error;
    }
    await new Promise((resolve) => { setTimeout(resolve, BUSY_FILE_WAIT_MS); });
  }
}

function waitingOutRefusalSync(operation: () => void): void {
  let refusedSince: number | undefined;
  for (;;) {
    try {
      operation();
      return;
    } catch (error) {
      if (!REFUSALS_CLEAR || !isBusyFileError(error)) throw error;
      refusedSince ??= performance.now();
      if (!stillWaitingOut(refusedSince)) throw error;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BUSY_FILE_WAIT_MS);
  }
}

/** A filesystem that refuses chmod keeps the mode the write set, which is never wider than asked. */
function chmodQuietlySync(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    return;
  }
}

/** Removing the staged file must not replace the error that left it behind. */
function removeQuietlySync(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    return;
  }
}
