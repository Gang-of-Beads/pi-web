/**
 * When a plugin that failed to load is tried again.
 *
 * A plugin's browser module that failed once, as on a phone whose link dropped while the page
 * booted, stayed missing for the life of the tab: every message the plugin draws read
 * "Unrecognized message" until a reload, and coming back online or into view did not help
 * (owner report, 2026-10-09, 8504; reproduced on 8505 by failing one module request). The page
 * now tries again after a growing pause while anything is missing, and at once when the browser
 * comes back online or into view. Past the last pause only those moments retry, so a plugin that
 * can never load does not retry forever.
 */

const RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 60_000, 300_000];

export interface PluginLoadRetry {
  /** A load left plugins missing: try again after the next pause. */
  failed(): void;
  /** The browser came back online or into view: try now if anything is missing. */
  wake(): void;
  dispose(): void;
}

/** `retry` loads what is missing, with the attempt's number, and says whether nothing is left missing. */
export function createPluginLoadRetry(retry: (attempt: number) => Promise<boolean>, delays: readonly number[] = RETRY_DELAYS_MS): PluginLoadRetry {
  let attempt = 0;
  let missing = false;
  let running = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (): void => {
    const delay = delays[attempt];
    if (disposed || timer !== undefined || running || delay === undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, delay);
  };
  const run = async (): Promise<void> => {
    if (disposed || running) return;
    cancel();
    running = true;
    attempt += 1;
    const complete = await retry(attempt).catch(() => false);
    running = false;
    missing = !complete;
    if (complete) attempt = 0;
    else schedule();
  };
  return {
    failed: () => {
      missing = true;
      schedule();
    },
    wake: () => {
      if (missing) void run();
    },
    dispose: () => {
      disposed = true;
      cancel();
    },
  };
}
