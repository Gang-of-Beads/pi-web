import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Gives one test run a throwaway PI_WEB_DATA_DIR and removes it afterwards.
 *
 * Every module that keeps state (pins, projects, unread marks, archived
 * sessions, plugin storage, the runs in flight) defaults its file to
 * PI_WEB_DATA_DIR, and the owner's live instance runs with it unset, which is
 * ~/.pi-web. A suite run from a PI WEB session inherited that default, so the
 * daemon tests' runs were marked in the live ~/.pi-web/in-flight-runs.json and
 * the next 8504 restart reported thirteen test sessions as interrupted runs
 * (2026-10-11). Vitest starts its workers from this process's environment
 * after global setup, so setting the variable here reaches every test file; a
 * test that needs another directory still passes its own environment or stubs
 * this one.
 */
export default async function throwawayDataDir(): Promise<() => Promise<void>> {
  const dataDir = await mkdtemp(join(tmpdir(), "pi-web-test-data-"));
  process.env["PI_WEB_DATA_DIR"] = dataDir;
  return async () => {
    await rm(dataDir, { recursive: true, force: true });
  };
}
