import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listBackgroundTasks, readTaskOutput, runningTaskIds, taskIdsForSession } from "./backgroundTasks.js";
import { taskProcessIsOriginal } from "./backgroundTasks";

/**
 * These fixtures copy a real registry directory rather than the reader's own
 * assumptions - the subagent reader shipped with fourteen green tests and read
 * nothing, because its fixture used the same wrong key the code did.
 *
 * The shape below was taken from
 * ~/.pi/tasks/session-494694-494694/*.json on 2026-08-21: the directory is
 * named after the *server* pid because BackgroundTaskContext.sessionId is
 * declared optional and never supplied, and the records carry no session
 * field at all. That is why ownership has to come from the transcript.
 */

const RUNNING_PID = process.pid;

/** The probe a healthy world offers: the runner's pid was born with the seeded start. */
const fakeProbe = (pid: number): Promise<number | undefined> =>
  // 健康世界:runner 的 pid 出生时间 ≈ 种子里 5 秒前的 startTime
  Promise.resolve(pid === RUNNING_PID ? Date.now() - 5_000 : undefined);

async function fixture(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "bgtasks-"));
  const dir = join(cwd, ".pi", "tasks", "session-494694-494694");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "b96da5ec8.json"), JSON.stringify({
    id: "b96da5ec8",
    name: "deploy 1.202608.13",
    command: "bash scripts/deploy.sh",
    status: "running",
    outputPath: ".pi/tasks/session-494694-494694/b96da5ec8.output",
    // 活任务的开始时间必须是现实的:出生时间核对会把一个声称 2023 年就
    // 开始、进程却刚出生的记录判成 pid 复用 —— 那正是新规则要抓的情形。
    startTime: Date.now() - 5_000,
    pid: RUNNING_PID,
    bytesWritten: 0,
  }));
  await writeFile(join(dir, "b25b68e87.json"), JSON.stringify({
    id: "b25b68e87",
    name: "verify",
    command: "npm test",
    status: "completed",
    outputPath: ".pi/tasks/session-494694-494694/b25b68e87.output",
    startTime: 1_699_999_000_000,
    endTime: 1_699_999_132_000,
    exitCode: 0,
    pid: 999_999,
    bytesWritten: 317,
  }));
  // A record left claiming to run by a machine that went down under it.
  await writeFile(join(dir, "stale111.json"), JSON.stringify({
    id: "stale111",
    name: "old deploy",
    command: "true",
    status: "running",
    outputPath: ".pi/tasks/session-494694-494694/stale111.output",
    startTime: 1_600_000_000_000,
    pid: 999_998,
    bytesWritten: 0,
  }));
  // A task another session in this same server started: same directory, and it
  // must not appear in this session's list.
  await writeFile(join(dir, "other999.json"), JSON.stringify({
    id: "other999", name: "someone else", command: "true", status: "completed", pid: 1, bytesWritten: 0,
  }));
  await writeFile(join(dir, "b96da5ec8.output"), "deploying...\n");
  return cwd;
}

async function transcript(cwd: string): Promise<string> {
  const path = join(cwd, "session.jsonl");
  // The literal form the task tool writes into its own result.
  await writeFile(path, [
    JSON.stringify({ role: "tool", content: "Started background task deploy (b96da5ec8)\nOutput: .pi/tasks/session-494694-494694/b96da5ec8.output" }),
    JSON.stringify({ role: "tool", content: "Output: .pi/tasks/session-494694-494694/b25b68e87.output" }),
    JSON.stringify({ role: "tool", content: "Output: .pi/tasks/session-494694-494694/stale111.output" }),
  ].join("\n"));
  return path;
}

describe("background tasks", () => {
  it("lists only the tasks this session's transcript claims", async () => {
    const cwd = await fixture();
    const tasks = await listBackgroundTasks(cwd, await transcript(cwd), Date.now(), fakeProbe);

    // other999 exists in the same directory and belongs to another session.
    expect(tasks.map((task) => task.id).sort()).toEqual(["b25b68e87", "b96da5ec8", "stale111"]);
  });

  it("reads status, duration and exit code from the record", async () => {
    const cwd = await fixture();
    const tasks = await listBackgroundTasks(cwd, await transcript(cwd), Date.now(), fakeProbe);
    const done = tasks.find((task) => task.id === "b25b68e87");

    expect(done).toMatchObject({ name: "verify", status: "completed", exitCode: 0, durationMs: 132_000, bytesWritten: 317 });
  });

  it("keeps a live task running and calls a dead one lost", async () => {
    const cwd = await fixture();
    const tasks = await listBackgroundTasks(cwd, await transcript(cwd), Date.now(), fakeProbe);

    expect(tasks.find((task) => task.id === "b96da5ec8")?.status).toBe("running");
    // Nothing rewrites the file when the process dies, so the reader must not
    // take "running" at face value.
    expect(tasks.find((task) => task.id === "stale111")?.status).toBe("lost");
  });

  it("measures a running task's duration against now", async () => {
    const cwd = await fixture();
    const tasks = await listBackgroundTasks(cwd, await transcript(cwd), Date.now(), fakeProbe);

    expect(tasks.find((task) => task.id === "b96da5ec8")?.durationMs).toBeGreaterThan(4_000);
  });

  it("names the live tasks in a workspace without reading any transcript", async () => {
    const cwd = await fixture();

    // stale111 still says "running" on disk and other999/b25b68e87 are done, so
    // only the record whose process really exists may be reported live. This is
    // the cheap probe the per-session count uses before paying for a transcript.
    expect(await runningTaskIds(cwd, fakeProbe)).toEqual(new Set(["b96da5ec8"]));
  });

  it("finds task ids in the output paths the tool reports", async () => {
    const cwd = await fixture();

    expect(await taskIdsForSession(await transcript(cwd))).toEqual(new Set(["b96da5ec8", "b25b68e87", "stale111"]));
  });

  it("returns nothing for a session with no transcript and no tasks", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "bgtasks-empty-"));

    expect(await listBackgroundTasks(cwd, join(cwd, "missing.jsonl"))).toEqual([]);
  });

  it("reads a task's log through its recorded output path", async () => {
    const cwd = await fixture();

    expect(await readTaskOutput(cwd, "b96da5ec8")).toBe("deploying...\n");
    expect(await readTaskOutput(cwd, "no-such-task")).toBeUndefined();
  });
});

/**
 * A pid is a number the operating system hands out again. Measured live: a
 * web-server task that died on August 24 still reported running on August 29
 * because its pid had been handed to /usr/libexec/microstackshot. Life of the
 * number is not life of the task - the start time is the identity.
 */
describe("whether a running record's pid is still the task's own process", () => {
  const START = Date.parse("2026-08-24T10:14:23Z");

  it("keeps running when the pid's start time matches the task's", () => {
    expect(taskProcessIsOriginal(START + 2_000, 69946, START)).toBe(true);
  });

  it("calls it lost when the number was handed to a later process", () => {
    expect(taskProcessIsOriginal(START + 5 * 86_400_000, 69946, START)).toBe(false);
  });

  it("calls it lost when the process cannot be probed at all", () => {
    expect(taskProcessIsOriginal(undefined, 69946, START)).toBe(false);
  });

  it("calls it lost when there is no pid to check", () => {
    expect(taskProcessIsOriginal(START, undefined, START)).toBe(false);
  });
});

describe("a running record whose pid was recycled", () => {
  /**
   * The tracker trusts its own lifecycle events, but a kill from outside it -
   * a restart script, tmux, anything - leaves the record claiming to run. The
   * pid-liveness check then met a recycled pid: measured live, pid 69946 had
   * become /usr/libexec/microstackshot, and the card counted 123 hours of a
   * process that died days before. A process's own birth time is the
   * identity: the real one starts with the task; a recycled one starts long
   * after.
   */
  it("reports lost when the pid belongs to a process born long after the task", async () => {
    const cwd = await fixture();
    const tenDays = 10 * 24 * 60 * 60 * 1000;
    const recent = Date.now() - 60 * 1000;
    // 把 running 记录的 startTime 挪到 10 天前;pid 仍是本测试进程(活着,
    // 但出生时间远晚于任务开始 —— 与实测的复用现场同构)。
    const file = join(cwd, ".pi", "tasks", "session-494694-494694", "b96da5ec8.json");
    const record = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(file, "utf8")));
    record.startTime = recent - tenDays;
    await (await import("node:fs/promises")).writeFile(file, JSON.stringify(record));

    const tasks = await listBackgroundTasks(cwd, await transcript(cwd), Date.now(), fakeProbe);

    expect(tasks.find((task) => task.id === "b96da5ec8")?.status).toBe("lost");
  });
});
