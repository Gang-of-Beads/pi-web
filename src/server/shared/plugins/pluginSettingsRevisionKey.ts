import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isNodeErrorWithCode } from "../workspaces/pathSafety.js";

/**
 * The host-local key that settings revisions covering a plugin's private `serverSettings` are
 * keyed with. A revision leaves the process that computed it (the session daemon reports it to the
 * web process, which compares it with its own), so an unsalted hash would let anyone who reads it
 * confirm a guessed secret offline. Both processes of one host read the same file from the PI WEB
 * data directory, so they compute the same revision; the key never leaves the host.
 */
const PLUGIN_SETTINGS_REVISION_KEY_FILE = "plugin-settings-revision.key";

const KEY_BYTES = 32;
const KEY_TEXT = /^[0-9a-f]{64}$/u;
const KEY_TEXT_PREFIX = /^[0-9a-f]{0,63}$/u;
const KEY_SETTLE_ATTEMPTS = 20;
const KEY_SETTLE_DELAY_MS = 50;

const loadedKeys = new Map<string, Promise<Buffer>>();

/** The key of this data directory, created on first use; loaded once per process. */
export function pluginSettingsRevisionKey(dataDir: string): Promise<Buffer> {
  const keyPath = join(dataDir, PLUGIN_SETTINGS_REVISION_KEY_FILE);
  const loaded = loadedKeys.get(keyPath);
  if (loaded !== undefined) return loaded;
  const loading = readOrCreateKey(dataDir, keyPath);
  loadedKeys.set(keyPath, loading);
  loading.catch(() => { loadedKeys.delete(keyPath); });
  return loading;
}

/** What `link` answers on a filesystem that has no hard links (FAT and exFAT, some network mounts). */
const NO_HARD_LINK_CODES = ["EPERM", "ENOSYS", "EXDEV"];

/**
 * The key is staged in a private temporary file and published with `link`, which fails when the
 * key already exists: the web process and the session daemon may start together, and the one that
 * loses the race reads the complete key the other published, never a half-written one. Where the
 * filesystem has no hard links, the key is written in place with an exclusive create instead. That
 * still keeps whichever key was written first, and a process that starts at the same moment may find
 * it still being written: a hex prefix of a key is read again for up to a second before it counts as
 * malformed.
 */
async function readOrCreateKey(dataDir: string, keyPath: string): Promise<Buffer> {
  const existing = await readKeyFile(keyPath);
  if (existing !== undefined) return existing;
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const key = `${randomBytes(KEY_BYTES).toString("hex")}\n`;
  const stagedPath = `${keyPath}.${String(process.pid)}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(stagedPath, key, { flag: "wx", mode: 0o600 });
  try {
    await link(stagedPath, keyPath).catch(async (error: unknown) => {
      if (isNodeErrorWithCode(error, "EEXIST")) return;
      if (!NO_HARD_LINK_CODES.some((code) => isNodeErrorWithCode(error, code))) throw error;
      await writeFile(keyPath, key, { flag: "wx", mode: 0o600 }).catch((writeError: unknown) => {
        if (!isNodeErrorWithCode(writeError, "EEXIST")) throw writeError;
      });
    });
  } finally {
    await unlink(stagedPath).catch(() => undefined);
  }
  const created = await readKeyFile(keyPath);
  if (created === undefined) throw new Error(`PI WEB could not create its plugin settings revision key: ${keyPath}`);
  return created;
}

async function readKeyFile(keyPath: string): Promise<Buffer | undefined> {
  for (let attempt = 1; ; attempt += 1) {
    const text = await readFile(keyPath, "utf8").catch((error: unknown) => {
      if (isNodeErrorWithCode(error, "ENOENT")) return undefined;
      throw error;
    });
    if (text === undefined) return undefined;
    const hex = text.trim();
    if (KEY_TEXT.test(hex)) return Buffer.from(hex, "hex");
    if (!KEY_TEXT_PREFIX.test(hex) || attempt >= KEY_SETTLE_ATTEMPTS) {
      throw new Error(`PI WEB plugin settings revision key is malformed; delete it to have a new one created: ${keyPath}`);
    }
    await delay(KEY_SETTLE_DELAY_MS);
  }
}
