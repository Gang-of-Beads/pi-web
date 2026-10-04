import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm, stat, truncate } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

/**
 * Size-based retention for a log file this process writes through its service manager
 * (owner, 2026-10-04). launchd, systemd's `append:` and `tee -a` open the file for appending and
 * keep it open, so the process cannot reopen it: the file's last `maxFileMb` is copied to
 * `<name>.1` (older copies shift to `.2`, `.3`, …, the oldest beyond `keepFiles` is removed)
 * and the file is truncated in place, after which appended writes start again at the beginning.
 * Only the tail is copied because a copy holds at most `maxFileMb` anyway, and a log that grew
 * unchecked (8504's web.log reached 15.8 GB) must not need that much free disk to be trimmed.
 */
export interface LogRetentionSettings {
  readonly maxFileMb: number;
  readonly keepFiles: number;
}

const MB = 1024 * 1024;
const CHECK_INTERVAL_MS = 60_000;

export async function rotateWhenLarge(path: string, settings: LogRetentionSettings): Promise<boolean> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return false;
  }
  if (size <= settings.maxFileMb * MB) return false;
  const keep = Math.max(1, Math.floor(settings.keepFiles));
  await rm(`${path}.${String(keep)}`, { force: true });
  for (let index = keep - 1; index >= 1; index -= 1) {
    await rename(`${path}.${String(index)}`, `${path}.${String(index + 1)}`).catch(() => undefined);
  }
  const keptBytes = settings.maxFileMb * MB;
  await pipeline(createReadStream(path, { start: Math.max(0, size - keptBytes) }), createWriteStream(`${path}.1`));
  await truncate(path, 0);
  return true;
}

/**
 * Check the file once a minute with the settings current at that moment, so a change saved in
 * Settings applies at the next check. `onTick` lets the caller refresh anything else it reads from
 * the same settings (the request log level). The timer never holds the process open.
 */
export function startLogRetention(options: {
  readonly path: string;
  readonly settings: () => LogRetentionSettings;
  readonly onTick?: () => void;
  readonly onError?: (error: unknown) => void;
}): () => void {
  const tick = (): void => {
    options.onTick?.();
    rotateWhenLarge(options.path, options.settings()).catch((error: unknown) => { options.onError?.(error); });
  };
  tick();
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
  return () => { clearInterval(timer); };
}
