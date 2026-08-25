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

    const [idleParent] = await listSubagentRuns(dir, PARENT);
    expect(idleParent).toMatchObject({ status: "unknown" });

    // The tool call that spawned it has not returned, which is a fact rather
    // than an inference from how recently a file changed.
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

    expect(run?.status).toBe("unknown");
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
});
