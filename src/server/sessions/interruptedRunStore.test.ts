import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearInterruptedRuns, readInterruptedRuns, recordInterruptedRuns } from "./interruptedRunStore";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function tempFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-interrupted-"));
  roots.push(root);
  return join(root, "interrupted-runs.json");
}

/**
 * A drain is always bounded — systemd sends SIGKILL after its own timeout — so
 * a long run can still be cut off. The record is what keeps that from vanishing.
 */
describe("interrupted run record", () => {
  it("round-trips the runs a shutdown cut off", async () => {
    const path = await tempFile();
    await recordInterruptedRuns([{ sessionId: "s1", cwd: "/repo", interruptedAt: "2026-08-18T10:00:00.000Z" }], path);

    await expect(readInterruptedRuns(path)).resolves.toEqual({
      runs: [{ sessionId: "s1", cwd: "/repo", interruptedAt: "2026-08-18T10:00:00.000Z" }],
    });
  });

  it("reports nothing when no record exists", async () => {
    // The common case: the previous shutdown interrupted nothing.
    await expect(readInterruptedRuns(join(await tempFile(), "missing.json"))).resolves.toEqual({ runs: [] });
  });

  it("replaces rather than accumulating, so the record answers the last restart", async () => {
    const path = await tempFile();
    await recordInterruptedRuns([{ sessionId: "old", cwd: "/repo", interruptedAt: "1" }], path);
    await recordInterruptedRuns([{ sessionId: "new", cwd: "/repo", interruptedAt: "2" }], path);

    const record = await readInterruptedRuns(path);
    expect(record.runs.map((run) => run.sessionId)).toEqual(["new"]);
  });

  it("clears once the user has seen it", async () => {
    const path = await tempFile();
    await recordInterruptedRuns([{ sessionId: "s1", cwd: "/repo", interruptedAt: "1" }], path);
    await clearInterruptedRuns(path);

    await expect(readInterruptedRuns(path)).resolves.toEqual({ runs: [] });
  });

  it("treats a corrupt record as nothing interrupted rather than inventing work", async () => {
    // Sending the user chasing a run that finished normally is worse than
    // losing the record of one that did not.
    const path = await tempFile();
    await writeFile(path, "{not json", "utf8");
    await expect(readInterruptedRuns(path)).resolves.toEqual({ runs: [] });
  });

  it("skips entries that cannot identify a session", async () => {
    const path = await tempFile();
    await writeFile(path, JSON.stringify({ runs: [{ sessionId: "ok", cwd: "/repo" }, { cwd: "/repo" }, { sessionId: "no-cwd" }] }), "utf8");

    const record = await readInterruptedRuns(path);
    expect(record.runs.map((run) => run.sessionId)).toEqual(["ok"]);
  });

  it("never throws when the path cannot be written, so shutdown still completes", async () => {
    // Writing a convenience record must not keep the daemon alive. A file used
    // as a directory is the cheapest way to make the write fail immediately.
    const root = await mkdtemp(join(tmpdir(), "pi-web-interrupted-bad-"));
    roots.push(root);
    const blocker = join(root, "blocker");
    await writeFile(blocker, "not a directory", "utf8");

    await expect(recordInterruptedRuns(
      [{ sessionId: "s1", cwd: "/repo", interruptedAt: "1" }],
      join(blocker, "interrupted-runs.json"),
    )).resolves.toBeUndefined();
  });
});
