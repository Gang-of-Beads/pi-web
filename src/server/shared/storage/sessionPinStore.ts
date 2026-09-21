import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { piWebDataDir } from "../../../config.js";

/**
 * Which sessions are kept close on this machine.
 *
 * A pin used to live in the browser's local storage, which made it a property
 * of a device: the owner pinned on the phone and the desktop knew nothing
 * about it. A pin names a session, and a session belongs to a machine, so the
 * machine holds the set and every device that browses it sees the same pins.
 *
 * Writes are serialised through one tail so two devices pinning at the same
 * moment cannot lose one another's pin to a read-modify-write race.
 */

export function sessionPinStorePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const configured = env["PI_WEB_SESSION_PINS_FILE"];
  if (configured === undefined || configured === "") return join(piWebDataDir(env, cwd), "session-pins.json");
  return resolve(cwd, configured);
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function parsePinFile(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid session pin file");
  const pinned: unknown = Reflect.get(value, "pinnedSessionIds");
  if (!Array.isArray(pinned)) throw new Error("Invalid session pin file");
  return pinned.filter((id): id is string => typeof id === "string" && id !== "");
}

export class SessionPinStore {
  constructor(private readonly filePath = sessionPinStorePath()) {}

  private tail: Promise<unknown> = Promise.resolve();

  async list(): Promise<string[]> {
    try {
      return parsePinFile(JSON.parse(await readFile(this.filePath, "utf-8")));
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) return [];
      throw error;
    }
  }

  async pin(sessionId: string): Promise<string[]> {
    return this.change((pinned) => (pinned.includes(sessionId) ? pinned : [...pinned, sessionId]));
  }

  async unpin(sessionId: string): Promise<string[]> {
    return this.change((pinned) => pinned.filter((id) => id !== sessionId));
  }

  /** Adopt pins a device made before pins were machine-owned, losing none. */
  async adopt(sessionIds: readonly string[]): Promise<string[]> {
    return this.change((pinned) => [...new Set([...pinned, ...sessionIds])]);
  }

  private async change(apply: (pinned: string[]) => string[]): Promise<string[]> {
    const run = this.tail.then(async () => {
      const next = apply(await this.list());
      await this.write(next);
      return next;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async write(pinnedSessionIds: readonly string[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${String(process.pid)}.tmp`;
    await writeFile(temp, `${JSON.stringify({ pinnedSessionIds }, null, 2)}\n`, "utf-8");
    await rename(temp, this.filePath);
  }
}
