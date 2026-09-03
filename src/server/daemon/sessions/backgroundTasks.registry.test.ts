import { mkdtemp, mkdir, writeFile, utimes, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { listBackgroundTasks, resetTaskRecordCache, resetTranscriptScanCache } from "./backgroundTasks.js";

/**
 * The poll's remaining costs after the transcript watermark: every registry
 * file re-read and re-parsed each time (480 files, most of them finished
 * tasks that will never change again), and a `ps` spawned per task pid -
 * including tasks that finished days ago. Same invariant as the transcript:
 * the expensive proof runs on new evidence, never on a timer.
 */
async function fixture(): Promise<{ cwd: string; transcript: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "bgreg-"));
  const dir = join(cwd, ".pi", "tasks", "session-1-1");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "done1.json"), JSON.stringify({
    id: "done1", name: "finished", command: "true", status: "completed",
    pid: 4242, startTime: Date.now() - 60_000, endTime: Date.now() - 50_000,
    outputPath: ".pi/tasks/session-1-1/done1.output",
  }));
  const transcript = join(cwd, "session.jsonl");
  await writeFile(transcript, "Output: .pi/tasks/session-1-1/done1.output\n");
  return { cwd, transcript };
}

beforeEach(() => {
  resetTranscriptScanCache();
  resetTaskRecordCache();
});

describe("the registry poll after the watermark", () => {
  it("never probes the process of a task that already finished", async () => {
    const { cwd, transcript } = await fixture();
    const probes: number[] = [];
    const tasks = await listBackgroundTasks(cwd, transcript, Date.now(), (pid) => { probes.push(pid); return Promise.resolve(undefined); });
    expect(tasks.map((task) => task.status)).toEqual(["completed"]);
    expect(probes).toEqual([]);
  });

  it("reuses the parsed record while the file is unchanged", async () => {
    const { cwd, transcript } = await fixture();
    const file = join(cwd, ".pi", "tasks", "session-1-1", "done1.json");
    // Pin the mtime to a whole millisecond first: utimes cannot restore the
    // sub-millisecond component the filesystem stamps on write.
    const pinned = new Date("2026-09-01T00:00:00.000Z");
    await utimes(file, pinned, pinned);
    await listBackgroundTasks(cwd, transcript, Date.now(), () => Promise.resolve(undefined));
    // Rewrite the file with different content but identical size and mtime:
    // an unchanged stat answers from the cache, so the old parse survives.
    const raw = (await stat(file)).size;
    const body = JSON.stringify({
      id: "done1", name: "fmnished", command: "true", status: "completed",
      pid: 4242, startTime: 1, endTime: 2,
      outputPath: ".pi/tasks/session-1-1/done1.output",
    }).padEnd(raw, " ");
    await writeFile(file, body);
    await utimes(file, pinned, pinned);
    const tasks = await listBackgroundTasks(cwd, transcript, Date.now(), () => Promise.resolve(undefined));
    expect(tasks.map((task) => task.name)).toEqual(["finished"]);
  });

  it("re-reads a record whose file changed", async () => {
    const { cwd, transcript } = await fixture();
    await listBackgroundTasks(cwd, transcript, Date.now(), () => Promise.resolve(undefined));
    const file = join(cwd, ".pi", "tasks", "session-1-1", "done1.json");
    await writeFile(file, JSON.stringify({
      id: "done1", name: "renamed", command: "true", status: "completed",
      pid: 4242, startTime: Date.now() - 60_000, endTime: Date.now() - 40_000,
      outputPath: ".pi/tasks/session-1-1/done1.output",
    }));
    const tasks = await listBackgroundTasks(cwd, transcript, Date.now(), () => Promise.resolve(undefined));
    expect(tasks.map((task) => task.name)).toEqual(["renamed"]);
  });
});
