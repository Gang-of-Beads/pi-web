import { describe, expect, it } from "vitest";
import { READ_PRESUMED_DEAD_MS, RunsRead } from "./runsRead.js";

function reader() {
  let now = 0;
  const calls: { sessionFile: string; resolve: (value: unknown) => void; reject: (error: unknown) => void }[] = [];
  const runs = new RunsRead(
    (sessionFile) => new Promise((resolve, reject) => { calls.push({ sessionFile, resolve, reject }); }),
    () => undefined,
    () => now,
  );
  return { runs, calls, advance: (ms: number) => { now += ms; } };
}

const rows = (agent: string): unknown => ({ known: true, runs: [{ runId: agent, agent, status: "running", elapsedMs: 1, startedAt: "2026-01-01T00:00:00.000Z", hasOutput: false }] });
const settle = async (): Promise<void> => { for (let index = 0; index < 4; index += 1) await Promise.resolve(); };

describe("RunsRead", () => {
  it("reads again after a read presumed dead, and drops that read's answer when it comes after a newer one", async () => {
    const { runs, calls, advance } = reader();
    runs.select("a");
    advance(READ_PRESUMED_DEAD_MS - 1);
    runs.tick();
    const beforeTheBound = calls.length;
    advance(1);
    runs.tick();
    calls[1]?.resolve(rows("newer"));
    await settle();
    calls[0]?.resolve(rows("older"));
    await settle();

    const shown = runs.view("a")?.state;
    expect({ beforeTheBound, calls: calls.length, shown: shown?.kind === "rows" ? shown.rows[0]?.agent : shown?.kind }).toEqual({ beforeTheBound: 1, calls: 2, shown: "newer" });
  });

  it("drops an answer for the session the reader left", async () => {
    const { runs, calls } = reader();
    runs.select("a");
    runs.select("b");
    calls[0]?.resolve(rows("from-a"));
    await settle();

    expect({ a: runs.view("a"), b: runs.view("b")?.state }).toEqual({ a: undefined, b: undefined });
  });

  it("says it could not ask when the first read fails, and keeps the rows it has when a later one fails until one succeeds", async () => {
    const { runs, calls } = reader();
    runs.select("a");
    calls[0]?.reject(new Error("down"));
    await settle();
    const firstFailed = runs.view("a")?.state?.kind;
    runs.tick();
    calls[1]?.resolve(rows("kept"));
    await settle();
    runs.tick();
    calls[2]?.reject(new Error("down"));
    await settle();
    const failedAfterRows = runs.view("a");
    runs.tick();
    calls[3]?.resolve(rows("fresh"));
    await settle();

    expect({
      firstFailed,
      failedAfterRows: { kind: failedAfterRows?.state?.kind, refreshFailed: failedAfterRows?.refreshFailed },
      recovered: runs.view("a")?.refreshFailed,
    }).toEqual({ firstFailed: "unknown", failedAfterRows: { kind: "rows", refreshFailed: true }, recovered: false });
  });
});
