import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSubagentRuns, parseSubagentSessionName, readSubagentRunOutput } from "./subagentRuns";

// The real layout: the run directory is named after the transcript *file*,
// timestamp prefix and all. The first version of this fixture used a bare id
// on both sides, which agreed with the code and disagreed with every actual
// session - the endpoint returned nothing on a session that had run eight
// subagents.
const PARENT = "2026-08-20T17-27-53-830Z_01a02037-0ce6-730d-95f5-625c398ae884";

async function sessionDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-web-subagent-runs-"));
}

async function writeTranscript(dir: string, runId: string, lines: unknown[], attempt = "run-0"): Promise<string> {
  const path = join(dir, PARENT, runId, attempt);
  await mkdir(path, { recursive: true });
  const file = join(path, "session.jsonl");
  await writeFile(file, lines.map((line) => JSON.stringify(line)).join("\n"), "utf8");
  return file;
}

async function writeArtifact(dir: string, runId: string, agent: string, meta: Record<string, unknown>, withOutput = true): Promise<void> {
  const artifacts = join(dir, "subagent-artifacts");
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, `${runId}_${agent}_0_meta.json`), JSON.stringify({ agent, ...meta }), "utf8");
  if (withOutput) await writeFile(join(artifacts, `${runId}_${agent}_0_output.md`), "result", "utf8");
}

/**
 * What a run puts in the shared artifacts directory the moment it launches: the
 * prompt it was handed and the transcript it will append to. `meta.json` is
 * absent until it reports, so this is the on-disk shape of a run in flight.
 * Measured on a live child: exactly `_input.md` and `_transcript.jsonl`, with
 * no run directory anywhere.
 */
/**
 * Move a run directory's creation time into the past. A run that has written
 * nothing is dated by its directory alone, so this is the only way to build the
 * one shape that matters here: a child that was spawned long ago and never
 * wrote. `utimes` moves `birthtime` back on the filesystems this runs on.
 */
async function ageDirectory(path: string, ageMs: number): Promise<void> {
  const when = new Date(Date.now() - ageMs);
  await utimes(path, when, when);
}

async function writeRunningArtifact(dir: string, runId: string, agent: string, ageMs = 0): Promise<void> {
  const artifacts = join(dir, "subagent-artifacts");
  await mkdir(artifacts, { recursive: true });
  await writeFile(join(artifacts, `${runId}_${agent}_0_input.md`), "the task", "utf8");
  const transcript = join(artifacts, `${runId}_${agent}_0_transcript.jsonl`);
  await writeFile(transcript, JSON.stringify({ recordType: "message", role: "assistant" }), "utf8");
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    await utimes(transcript, when, when);
  }
}

describe("listSubagentRuns", () => {
  it("reports a finished run from its artifact", async () => {
    const dir = await sessionDir();
    await writeTranscript(dir, "run-a", [{ role: "assistant", content: [{ type: "text", text: "done" }] }]);
    await writeArtifact(dir, "run-a", "scout", { exitCode: 0, durationMs: 4321, toolCount: 7, model: "anthropic/claude", task: "look around", timestamp: "2026-08-21T10:00:00.000Z" });

    const [run] = await listSubagentRuns(dir, PARENT);

    expect(run).toMatchObject({
      runId: "run-a",
      agent: "scout",
      status: "done",
      elapsedMs: 4321,
      toolCount: 7,
      task: "look around",
      hasOutput: true,
    });
  });

  it("labels a finished run with what it returned, not with a redacted prompt", async () => {
    // The tool redacts prompts, so every meta.json carries the literal string
    // "[prompt redacted]" - a row label that says nothing about 14 different
    // runs. The first line of the result does.
    const dir = await sessionDir();
    await writeTranscript(dir, "run-summary", [{ role: "assistant", content: [{ type: "text", text: "x" }] }]);
    await writeArtifact(dir, "run-summary", "scout", { exitCode: 0, durationMs: 5, task: "[prompt redacted]", timestamp: "2026-08-21T10:00:00.000Z" });
    await writeFile(join(dir, "subagent-artifacts", "run-summary_scout_0_output.md"), "# Code Context - the live update path\n\nbody", "utf8");

    const [run] = await listSubagentRuns(dir, PARENT);

    expect(run?.task).toBe("Code Context - the live update path");
  });

  it("reports a non-zero exit as failed", async () => {
    const dir = await sessionDir();
    await writeTranscript(dir, "run-b", [{ role: "assistant", content: [{ type: "text", text: "boom" }] }]);
    await writeArtifact(dir, "run-b", "worker", { exitCode: 1, durationMs: 10, timestamp: "2026-08-21T10:00:00.000Z" });

    const [run] = await listSubagentRuns(dir, PARENT);

    expect(run?.status).toBe("failed");
  });

  it("calls a run with no artifact and a fresh transcript running, and says what it is doing", async () => {
    // A run in flight has written nothing but its transcript, so the only
    // evidence that it is alive is that the file keeps growing.
    const dir = await sessionDir();
    await writeTranscript(dir, "run-c", [
      { role: "assistant", content: [{ type: "text", text: "thinking" }] },
      { role: "assistant", content: [{ type: "tool_call", toolName: "bash" }] },
    ]);

    const [run] = await listSubagentRuns(dir, PARENT);

    expect(run).toMatchObject({ runId: "run-c", status: "running", lastActivity: "bash" });
  });

  it("reads a real transcript line, where the message wraps the content", async () => {
    // What pi actually writes. The fixtures above use the flat shape the
    // reader assumed, so they agreed with the bug: every running run reported
    // no steps at all, its row could not say what the child was doing, and
    // opening it answered "No output for this subagent run".
    const dir = await sessionDir();
    await writeTranscript(dir, "run-live", [
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "reading the config" }] } },
      { type: "message", message: { role: "assistant", content: [{ type: "tool_call", toolName: "grep" }] } },
    ]);

    const [run] = await listSubagentRuns(dir, PARENT);
    expect(run).toMatchObject({ status: "running", lastActivity: "grep" });

    const progress = await readSubagentRunOutput(dir, "run-live", { parentSessionId: PARENT });
    expect(progress).toContain("has not written a result yet");
    expect(progress).toContain("grep");
  });

  it("keeps a quiet child running while the parent turn still is", async () => {
    // Measured from a real session: four reviewers reading a long design
    // document had been silent for 884-928s, past the 600s staleness window,
    // and were all reported "unknown" - so the drawer said "Nothing running"
    // while four agents were working. A child writes its transcript when it
    // calls a tool; thinking makes no writes at all.
    const dir = await sessionDir();
    const file = await writeTranscript(dir, "run-thinking", [
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "reading" }] } },
    ]);
    const longAgo = new Date(Date.now() - 20 * 60 * 1000);
    await utimes(file, longAgo, longAgo);

    // With the parent idle there is no tool call in flight to be waiting on, so
    // a child that wrote and then went quiet has stopped.
    const [idleParent] = await listSubagentRuns(dir, PARENT);
    expect(idleParent).toMatchObject({ status: "lost" });

    // While the parent turn runs the window is wider, because a child spends a
    // long model call writing nothing at all.
    const [activeParent] = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });
    expect(activeParent).toMatchObject({ status: "running" });
  });

  it("still reports a finished run from its artifact while the parent runs", async () => {
    const dir = await sessionDir();
    await writeTranscript(dir, "run-done", [{ role: "assistant", content: [{ type: "text", text: "x" }] }]);
    await writeArtifact(dir, "run-done", "reviewer", { exitCode: 0 });

    const [run] = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    // A result outranks the parent's state: the run is over even if the turn
    // that started it is still going.
    expect(run).toMatchObject({ status: "done" });
  });

  it("does not leave a killed run listed as running forever", async () => {
    // No artifact and no writes for a long time means the child died with its
    // parent. Claiming it is still working would be a ghost in the list.
    const dir = await sessionDir();
    const file = await writeTranscript(dir, "run-d", [{ role: "assistant", content: [{ type: "text", text: "hi" }] }]);
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(file, longAgo, longAgo);

    const [run] = await listSubagentRuns(dir, PARENT);

    expect(run?.status).toBe("lost");
  });

  // 139 minutes is the shortest quiet time measured on a real dead run.
  it("does not resurrect a killed run when the parent starts a new turn", async () => {
    const dir = await sessionDir();
    const file = await writeTranscript(dir, "run-orphan", [{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "working" }] } }]);
    const killedLongAgo = new Date(Date.now() - 139 * 60 * 1000);
    await utimes(file, killedLongAgo, killedLongAgo);

    const [run] = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    expect(run?.status).toBe("lost");
  });

  it("reports a child that has just written as running", async () => {
    const dir = await sessionDir();
    const file = await writeTranscript(dir, "run-live", [{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "working" }] } }]);
    const justNow = new Date(Date.now() - 30 * 1000);
    await utimes(file, justNow, justNow);

    const [idle] = await listSubagentRuns(dir, PARENT);
    expect(idle?.status).toBe("running");
  });

  it("reads the latest attempt of a retried run", async () => {
    const dir = await sessionDir();
    await writeTranscript(dir, "run-e", [{ role: "assistant", content: [{ type: "tool_call", toolName: "first-attempt" }] }], "run-0");
    await writeTranscript(dir, "run-e", [{ role: "assistant", content: [{ type: "tool_call", toolName: "second-attempt" }] }], "run-1");

    const [run] = await listSubagentRuns(dir, PARENT);

    expect(run?.lastActivity).toBe("second-attempt");
  });

  it("puts running work first and finished work newest-first", async () => {
    const dir = await sessionDir();
    await writeTranscript(dir, "old-done", [{ role: "assistant", content: [{ type: "text", text: "x" }] }]);
    await writeArtifact(dir, "old-done", "scout", { exitCode: 0, durationMs: 1, timestamp: "2026-08-21T09:00:00.000Z" });
    await writeTranscript(dir, "new-done", [{ role: "assistant", content: [{ type: "text", text: "x" }] }]);
    await writeArtifact(dir, "new-done", "scout", { exitCode: 0, durationMs: 1, timestamp: "2026-08-21T11:00:00.000Z" });
    await writeTranscript(dir, "live", [{ role: "assistant", content: [{ type: "tool_call", toolName: "read" }] }]);

    const runs = await listSubagentRuns(dir, PARENT);

    expect(runs.map((run) => run.runId)).toEqual(["live", "new-done", "old-done"]);
  });

  it("returns nothing for a session that never started a subagent", async () => {
    const dir = await sessionDir();

    await expect(listSubagentRuns(dir, PARENT)).resolves.toEqual([]);
  });

  it("survives a partially written transcript line", async () => {
    // The tail is read mid-write often enough that a broken last line is
    // normal, and a truncated first line is guaranteed once the file is large.
    const dir = await sessionDir();
    const path = join(dir, PARENT, "run-f", "run-0");
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "session.jsonl"), `${JSON.stringify({ role: "assistant", content: [{ type: "tool_call", toolName: "grep" }] })}\n{"role":"assist`, "utf8");

    const [run] = await listSubagentRuns(dir, PARENT);

    expect(run?.lastActivity).toBe("grep");
  });
});

describe("parseSubagentSessionName", () => {
  it("reads the agent and originating run id a child session names itself after", () => {
    expect(parseSubagentSessionName("subagent-researcher-428284b1-2706-46f8-aa1b-b9efc4766fc7-1"))
      .toEqual({ agent: "researcher", runId: "428284b1-2706-46f8-aa1b-b9efc4766fc7" });
    // Agent names may contain dashes of their own.
    expect(parseSubagentSessionName("subagent-code-reviewer-428284b1-2706-46f8-aa1b-b9efc4766fc7"))
      .toEqual({ agent: "code-reviewer", runId: "428284b1-2706-46f8-aa1b-b9efc4766fc7" });
  });

  it("ignores names that are not subagent sessions", () => {
    expect(parseSubagentSessionName("Gree")).toBeUndefined();
    expect(parseSubagentSessionName("subagent-researcher-not-a-uuid")).toBeUndefined();
  });
});

describe("runs whose directory and artifacts use different ids", () => {
  // The layout this repository actually produces: the run directory carries the
  // child session id while the artifacts carry the tool's run id. Without
  // following the child's own session name every finished run reported
  // "unknown", lost its agent name and task, and could not be opened.
  it("joins them through the child session name", async () => {
    const dir = await sessionDir();
    const childSessionId = "91c34f97-a9a1-4c8c-85b3-2061fe772ae2";
    const toolRunId = "428284b1-2706-46f8-aa1b-b9efc4766fc7";
    await writeTranscript(dir, childSessionId, [
      { type: "session", version: 3, id: "01a02f78-68fa-7385-a64d-9b08b52f7cd7" },
      { type: "session_info", name: `subagent-researcher-${toolRunId}-1` },
      { type: "message", role: "assistant" },
    ]);
    await writeArtifact(dir, toolRunId, "researcher", { task: "research SpaceX", exitCode: 0, timestamp: "2026-08-23T16:33:34.000Z", durationMs: 5000 });

    const [run] = await listSubagentRuns(dir, PARENT);

    expect(run).toMatchObject({ runId: toolRunId, agent: "researcher", status: "done", task: "research SpaceX", hasOutput: true });
  });

  it("still describes a run whose transcript names no tool run", async () => {
    const dir = await sessionDir();
    await writeTranscript(dir, "91c34f97-a9a1-4c8c-85b3-2061fe772ae2", [{ type: "session", version: 3 }]);

    const [run] = await listSubagentRuns(dir, PARENT);

    expect(run).toMatchObject({ runId: "91c34f97-a9a1-4c8c-85b3-2061fe772ae2", agent: "subagent", hasOutput: false });
  });

  // A child that runs in a fork of the parent context writes its transcript to
  // the sibling `forks/` directory and leaves its own run directory empty for
  // its whole life. Measured on a real session: two children were working while
  // the drawer said "Nothing running right now", and six of sixteen run
  // directories were empty. Dropping the empty directory hid exactly the runs
  // worth watching, and they appeared only once they finished and wrote an
  // artifact.
  it("reports a run that has started but written nothing while the parent is streaming", async () => {
    const dir = await sessionDir();
    await mkdir(join(dir, PARENT, "5d2ddee7-ad67-46e5-82a6-5a89b7e796cb"), { recursive: true });

    const [run] = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    expect(run).toMatchObject({ runId: "5d2ddee7-ad67-46e5-82a6-5a89b7e796cb", status: "running", agent: "subagent" });
  });

  // Only the parent can vouch for a child that has written nothing. Without a
  // streaming parent the honest answer is that nobody knows, not that it is
  // working - otherwise a directory left by a crash would claim to be running
  // forever.
  it("admits it cannot tell when the parent is not streaming either", async () => {
    const dir = await sessionDir();
    await mkdir(join(dir, PARENT, "5d2ddee7-ad67-46e5-82a6-5a89b7e796cb"), { recursive: true });

    const [run] = await listSubagentRuns(dir, PARENT);

    expect(run).toMatchObject({ runId: "5d2ddee7-ad67-46e5-82a6-5a89b7e796cb", status: "unknown" });
  });

  // The parent streaming is a fact about the parent. Letting it vouch for a
  // child of any age turned six directories abandoned by children that died
  // before writing - empty for 158 to 274 minutes - into rows that claimed to
  // be running agents, and the owner asked why nobody was handling agents that
  // had been working for hours. Measured across 198 real runs on this machine,
  // a child's first transcript line lands a median of 7s and at most 55s after
  // its directory appears, so silence past the grace period is not a slow
  // start.
  it("stops calling a run that never wrote anything running once a launch cannot explain the silence", async () => {
    const dir = await sessionDir();
    const runDir = join(dir, PARENT, "5d2ddee7-ad67-46e5-82a6-5a89b7e796cb");
    await mkdir(runDir, { recursive: true });
    await ageDirectory(runDir, 158 * 60 * 1000);

    const [run] = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    expect(run).toMatchObject({ runId: "5d2ddee7-ad67-46e5-82a6-5a89b7e796cb", status: "lost" });
  });

  // Being wrong in the other direction is worse than the bug: a child really is
  // silent for the first seconds of its life, and calling that dead would hide
  // every run at the moment it starts.
  it("still vouches for a child young enough to be mid-launch", async () => {
    const dir = await sessionDir();
    const runDir = join(dir, PARENT, "5d2ddee7-ad67-46e5-82a6-5a89b7e796cb");
    await mkdir(runDir, { recursive: true });
    await ageDirectory(runDir, 30 * 1000);

    const [run] = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    expect(run).toMatchObject({ runId: "5d2ddee7-ad67-46e5-82a6-5a89b7e796cb", status: "running" });
  });

  // The row is the point: a dead child should be reported as dead, not dropped.
  // Hiding it again is the defect the empty-directory admission was fixing.
  it("keeps reporting the abandoned run rather than hiding it", async () => {
    const dir = await sessionDir();
    const runDir = join(dir, PARENT, "5d2ddee7-ad67-46e5-82a6-5a89b7e796cb");
    await mkdir(runDir, { recursive: true });
    await ageDirectory(runDir, 274 * 60 * 1000);

    const runs = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.hasOutput).toBe(false);
  });

  it("keeps a run that left an artifact behind but no transcript", async () => {
    const dir = await sessionDir();
    await mkdir(join(dir, PARENT, "79eeba3d-46c5-45bd-8e74-32a3f1eb7957"), { recursive: true });
    await writeArtifact(dir, "79eeba3d-46c5-45bd-8e74-32a3f1eb7957", "worker", { exitCode: 0, timestamp: "2026-08-25T10:00:00.000Z" });

    const [run] = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    expect(run).toMatchObject({ runId: "79eeba3d-46c5-45bd-8e74-32a3f1eb7957", agent: "worker", hasOutput: true });
  });

  it("ignores a neighbour directory that holds no run attempts", async () => {
    const dir = await sessionDir();
    const forks = join(dir, PARENT, "forks");
    await mkdir(forks, { recursive: true });
    await writeFile(join(forks, "2026-08-25T15-06-10-152Z_01a03975.jsonl"), "{}", "utf8");

    expect(await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true })).toEqual([]);
  });

  // The empty run directory and the `forks` neighbour are both directories with
  // no run attempt inside, so admitting the first must not admit the second.
  // What separates them is the name: a run directory carries the child session
  // id. Checked against every session on this machine - `forks` and
  // `subagent-artifacts` were the only non-uuid entries.
  it("tells an empty run directory apart from a neighbour by its name", async () => {
    const dir = await sessionDir();
    await mkdir(join(dir, PARENT, "5d2ddee7-ad67-46e5-82a6-5a89b7e796cb"), { recursive: true });
    await mkdir(join(dir, PARENT, "forks"), { recursive: true });
    await mkdir(join(dir, PARENT, "scratch"), { recursive: true });

    const runs = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    expect(runs.map((run) => run.runId)).toEqual(["5d2ddee7-ad67-46e5-82a6-5a89b7e796cb"]);
  });
});

/**
 * A fork-context child never gets a run directory at all: its transcript goes
 * to the shared `forks/` folder and the only trace it leaves under its own id
 * is the artifact it writes when it finishes. Enumerating directories alone
 * therefore lost the run permanently, not merely while it was working.
 *
 * Measured on this machine's session 01a04701: the run directory for
 * 49b702d6-836e-4e3b-a1d5-d490ca7464ae was absent for the whole 90s the child
 * ran and stayed absent afterwards, while four `<runId>_*` artifacts existed.
 */
describe("a fork child that never gets a run directory", () => {
  /**
   * The reported symptom, in the shape measured on a live child: no directory,
   * an input and a transcript in the shared artifacts folder, and no
   * `meta.json` because the run has not finished. Enumerating directories
   * alone left it out of the list for its whole life.
   */
  it("lists it while it is still working", async () => {
    const dir = await sessionDir();
    await writeRunningArtifact(dir, "7666849d-3eb3-4daf-b9f4-b8f34a0c4e42", "worker");

    const [run] = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    expect(run).toMatchObject({ runId: "7666849d-3eb3-4daf-b9f4-b8f34a0c4e42", status: "running" });
  });

  /**
   * A run writes its prompt and opens its transcript at launch, so treating
   * any artifact as the run's verdict would mark a child finished the moment
   * it started - a row claiming the work was over while it was being done.
   */
  it("does not call it done merely because artifacts exist", async () => {
    const dir = await sessionDir();
    await writeRunningArtifact(dir, "7666849d-3eb3-4daf-b9f4-b8f34a0c4e42", "worker");

    const [run] = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    expect(run?.status).not.toBe("done");
    expect(run?.hasOutput).toBe(false);
  });

  /** The filename carries the agent, so the row need not say "subagent". */
  it("names the agent from the artifact it is writing", async () => {
    const dir = await sessionDir();
    await writeRunningArtifact(dir, "7666849d-3eb3-4daf-b9f4-b8f34a0c4e42", "worker");

    const [run] = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    expect(run?.agent).toBe("worker");
  });

  /**
   * Once it reports, the artifact's own verdict takes over. The row has to
   * survive that moment: a child vanishing from the list exactly when it
   * finishes is the same defect from the other side.
   */
  it("switches to the reported result when the run finishes", async () => {
    const dir = await sessionDir();
    const reportedAt = "2026-08-28T09:21:42.000Z";
    await writeRunningArtifact(dir, "49b702d6-836e-4e3b-a1d5-d490ca7464ae", "worker");
    await writeArtifact(dir, "49b702d6-836e-4e3b-a1d5-d490ca7464ae", "worker", { exitCode: 0, timestamp: reportedAt });

    const [run] = await listSubagentRuns(dir, PARENT, Date.parse(reportedAt) + 1_000, { parentActive: true });

    expect(run).toMatchObject({ agent: "worker", status: "done", hasOutput: true });
  });

  /**
   * A run that reported long ago is history, and the artifacts directory is
   * shared, so it belongs to whichever session owns its directory.
   */
  it("does not adopt a run that reported long ago", async () => {
    const dir = await sessionDir();
    const reportedAt = "2026-08-28T09:21:42.000Z";
    await writeArtifact(dir, "a1948bde-5a26-46ec-b1ea-e8b0b7e492cc", "worker", { exitCode: 0, timestamp: reportedAt });

    const runs = await listSubagentRuns(dir, PARENT, Date.parse(reportedAt) + 60 * 60 * 1000, { parentActive: true });

    expect(runs).toEqual([]);
  });

  /** Reaching a run by artifact must not duplicate the row its directory made. */
  it("does not list a run twice when it has a directory too", async () => {
    const dir = await sessionDir();
    await mkdir(join(dir, PARENT, "79eeba3d-46c5-45bd-8e74-32a3f1eb7957"), { recursive: true });
    await writeRunningArtifact(dir, "79eeba3d-46c5-45bd-8e74-32a3f1eb7957", "worker");

    const runs = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    expect(runs.map((run) => run.runId)).toEqual(["79eeba3d-46c5-45bd-8e74-32a3f1eb7957"]);
  });
});

/**
 * Nothing in an artifact names the session that started the run: `meta.json`
 * carries `runId`, `agent`, a `cwd` that is the whole project, and a
 * `transcriptPath` pointing back into the shared artifacts folder. Measured on
 * one project, two sessions shared 35 artifacts of which 19 belonged to the
 * other session, and their lifetimes overlapped - so neither the files nor a
 * time window can attribute a finished run to its parent.
 *
 * A transcript still being appended to is different: it is work happening now,
 * under the parent streaming now.
 */
describe("whose run an artifact belongs to", () => {
  it("claims nothing while this parent is idle", async () => {
    const dir = await sessionDir();
    await writeRunningArtifact(dir, "a1948bde-5a26-46ec-b1ea-e8b0b7e492cc", "worker");

    const runs = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: false });

    expect(runs).toEqual([]);
  });

  /**
   * Measured on the same project: three runs had a transcript and no
   * `meta.json`, and two had been silent for twelve hours. Those are dead runs
   * belonging to whichever session owns their directory, not this one's work.
   */
  it("leaves a long-silent transcript to the session that owns its directory", async () => {
    const dir = await sessionDir();
    await writeRunningArtifact(dir, "33bced81-5997-49c6-9f1a-2b7c4d5e6f70", "worker", 12 * 60 * 60 * 1000);

    const runs = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    expect(runs).toEqual([]);
  });

  /**
   * The grace period that stops an empty directory claiming to run forever must
   * not reach a run that is demonstrably alive. This path only admits a run
   * whose transcript was written moments ago, and that write is evidence about
   * the child itself - exactly what an empty directory lacks - so it decides
   * the status and the launch grace period never applies. A run whose directory
   * is hours old but which is writing right now is working, not lost.
   */
  it("keeps a run that is still writing alive however old its directory is", async () => {
    const dir = await sessionDir();
    const runDir = join(dir, PARENT, "c8b9220c-4f1a-4e2b-9d3c-7a6b5c4d3e2f");
    await mkdir(runDir, { recursive: true });
    await ageDirectory(runDir, 274 * 60 * 1000);
    await writeRunningArtifact(dir, "c8b9220c-4f1a-4e2b-9d3c-7a6b5c4d3e2f", "worker");

    const [run] = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: true });

    expect(run).toMatchObject({ runId: "c8b9220c-4f1a-4e2b-9d3c-7a6b5c4d3e2f", status: "running" });
  });

  /** A directory is proof of ownership, so an idle parent still keeps its own. */
  it("still lists a run this session owns a directory for while idle", async () => {
    const dir = await sessionDir();
    await mkdir(join(dir, PARENT, "79eeba3d-46c5-45bd-8e74-32a3f1eb7957"), { recursive: true });
    await writeArtifact(dir, "79eeba3d-46c5-45bd-8e74-32a3f1eb7957", "worker", { exitCode: 0, timestamp: "2026-08-25T10:00:00.000Z" });

    const runs = await listSubagentRuns(dir, PARENT, Date.now(), { parentActive: false });

    expect(runs.map((run) => run.runId)).toEqual(["79eeba3d-46c5-45bd-8e74-32a3f1eb7957"]);
  });
});
