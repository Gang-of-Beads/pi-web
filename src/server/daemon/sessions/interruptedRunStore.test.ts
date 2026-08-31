import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearInterruptedRuns, clearRunInFlight, markRunInFlight, readInterruptedRuns, recordInterruptedRuns, takeInterruptedRuns } from "./interruptedRunStore";

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

describe("read-and-clear semantics", () => {
  // The record answers "what did the last restart interrupt". Reporting the
  // same interruption after every reconnect would train the user to ignore it,
  // so handing it over has to spend it.
  it("reports nothing on a second read once cleared", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-interrupted-"));
    const file = join(dir, "interrupted-runs.json");

    await recordInterruptedRuns(
      [{ sessionId: "01a01367", cwd: "/home/u/project", interruptedAt: "2026-08-18T06:00:00.000Z" }],
      file,
    );

    const first = await readInterruptedRuns(file);
    expect(first.runs).toHaveLength(1);
    expect(first.runs[0]?.sessionId).toBe("01a01367");

    await clearInterruptedRuns(file);
    expect((await readInterruptedRuns(file)).runs).toEqual([]);
  });
});

describe("surviving a kill that leaves no shutdown window", () => {
  // The daemon runs under KillMode=control-group, so SIGTERM reaches the agent
  // subprocesses at the same instant as the daemon. The run being protected is
  // already dead by the time the drain looks, so the drain finds nothing to wait
  // for and a record written at shutdown records nothing. Observed in practice:
  // "shutting down" and "Stopped" in the same second, no drain line at all.
  //
  // The record therefore has to exist *before* the process dies: written when a
  // run starts, cleared when it ends, so whatever is left at startup is exactly
  // what did not finish -- which also covers SIGKILL, a crash and a power cut.
  it("reports a run that was in flight when the process died", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-inflight-"));
    const file = join(dir, "in-flight-runs.json");

    await markRunInFlight({ sessionId: "01a00616", cwd: "/home/u/project" }, file);
    // No clear: the process is killed here.

    const leftovers = await takeInterruptedRuns(file);
    expect(leftovers.map((run) => run.sessionId)).toEqual(["01a00616"]);
    // Taking them clears the file, so the next start does not re-report them.
    expect(await takeInterruptedRuns(file)).toEqual([]);
  });

  it("does not report a run that finished normally", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-inflight-"));
    const file = join(dir, "in-flight-runs.json");

    await markRunInFlight({ sessionId: "01a00616", cwd: "/home/u/project" }, file);
    await clearRunInFlight("01a00616", file);

    expect(await takeInterruptedRuns(file)).toEqual([]);
  });
});
