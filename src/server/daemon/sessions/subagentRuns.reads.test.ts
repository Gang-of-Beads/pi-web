import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The boundaries this file is about: how much of a file the listing pulls off
 * disk and how often it lists the shared artifact directory. The filesystem
 * functions keep doing their real work and are only watched.
 */
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile), readdir: vi.fn(actual.readdir) };
});

const { readFile, readdir } = await import("node:fs/promises");
const { createSubagentRunLister, listSubagentRuns, readSubagentRunOutput } = await import("./subagentRuns");

const PARENT = "2026-08-20T17-27-53-830Z_01a02037-0ce6-730d-95f5-625c398ae884";
/** Larger than every window the module reads, so a whole-file read is visible. */
const FILLER = "x".repeat(200_000);
/** The tool names a child after its own run, and that name carries a uuid. */
const LIVE_RUN = "3f2b1c04-9a7e-4f21-8b55-0c6d7e8f9a01";
const DONE_RUN = "7c1d2e35-4b6a-4c8d-9e10-2f3a4b5c6d7e";

function wholeFileReads(): string[] {
  return vi.mocked(readFile).mock.calls
    .map((call) => call[0])
    .filter((path): path is string => typeof path === "string")
    .filter((path) => path.endsWith("session.jsonl") || path.endsWith("_output.md"));
}

/**
 * A transcript that says who it belongs to in its first line, is still working
 * in its last, and carries a long conversation in between - the shape of every
 * real run, and the shape that made reading whole files expensive.
 */
async function writeLongTranscript(dir: string, runId: string): Promise<void> {
  const path = join(dir, PARENT, runId, "run-0");
  await mkdir(path, { recursive: true });
  const lines = [
    JSON.stringify({ type: "session_info", name: `subagent-scout-${runId}-0` }),
    JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: FILLER }] } }),
    JSON.stringify({ message: { role: "assistant", content: [{ toolName: "read" }] } }),
  ];
  await writeFile(join(path, "session.jsonl"), lines.join("\n"), "utf8");
}

describe("what the activity listing pulls off disk", () => {
  beforeEach(() => {
    vi.mocked(readFile).mockClear();
    vi.mocked(readdir).mockClear();
  });

  /**
   * Both readers sliced a window out of a string they had already read whole,
   * which is not a window at all. Measured on one open session: 129 runs and
   * 113 results came to 170MB of reads, repeated on every four-second poll, so
   * the list fell behind far enough to look frozen until the page was
   * reloaded.
   */
  it("reads a window of a transcript rather than the whole conversation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-reads-"));
    await writeLongTranscript(dir, LIVE_RUN);

    const [run] = await listSubagentRuns(dir, PARENT);

    // The window still has to answer the questions the row asks of it.
    expect(run).toMatchObject({ agent: "scout", status: "running", lastActivity: "read" });
    expect(wholeFileReads()).toEqual([]);
  });

  it("does not inspect shared artifacts for a parent that owns no runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-reads-"));
    await mkdir(join(dir, "subagent-artifacts"), { recursive: true });

    expect(await listSubagentRuns(dir, PARENT)).toEqual([]);
    expect(vi.mocked(readdir).mock.calls.some(([path]) => path === join(dir, "subagent-artifacts"))).toBe(false);
  });

  it("shares one artifact snapshot between parents in the same scan cycle", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-reads-"));
    const otherParent = "2026-08-20T17-27-54-830Z_11a02037-0ce6-730d-95f5-625c398ae884";
    await writeLongTranscript(dir, LIVE_RUN);
    const otherRun = "4f2b1c04-9a7e-4f21-8b55-0c6d7e8f9a02";
    const otherPath = join(dir, otherParent, otherRun, "run-0");
    await mkdir(otherPath, { recursive: true });
    await writeFile(join(otherPath, "session.jsonl"), JSON.stringify({ type: "session_info", name: `subagent-scout-${otherRun}-0` }), "utf8");
    await mkdir(join(dir, "subagent-artifacts"), { recursive: true });
    const list = createSubagentRunLister();

    await Promise.all([list(dir, PARENT), list(dir, otherParent)]);

    const artifactsDir = join(dir, "subagent-artifacts");
    expect(vi.mocked(readdir).mock.calls.filter(([path]) => path === artifactsDir)).toHaveLength(1);
  });

  it("reads the first line of a result rather than the whole document", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-reads-"));
    await writeLongTranscript(dir, DONE_RUN);
    const artifacts = join(dir, "subagent-artifacts");
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(artifacts, `${DONE_RUN}_scout_0_meta.json`), JSON.stringify({ agent: "scout", exitCode: 0, task: "[prompt redacted]" }), "utf8");
    await writeFile(join(artifacts, `${DONE_RUN}_scout_0_output.md`), `# What I found\n\n${FILLER}`, "utf8");

    const [run] = await listSubagentRuns(dir, PARENT);

    expect(run).toMatchObject({ status: "done", task: "What I found" });
    expect(wholeFileReads()).toEqual([]);
  });

  /**
   * Proving `readFile` was avoided is not the same as proving a window was
   * read: `readWindow(path, Infinity)` would pass that check and read the whole
   * file anyway. This puts the run's identity *past* the head window and
   * requires the reader to miss it, which only a genuinely bounded read does.
   */
  it("stops at the end of the head window rather than reading on", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-reads-"));
    const path = join(dir, PARENT, LIVE_RUN, "run-0");
    await mkdir(path, { recursive: true });
    // 8KB is the head window; this line begins well past it.
    const lines = [
      JSON.stringify({ message: { role: "assistant", content: [{ type: "text", text: "y".repeat(20_000) }] } }),
      JSON.stringify({ type: "session_info", name: `subagent-scout-${LIVE_RUN}-0` }),
    ];
    await writeFile(join(path, "session.jsonl"), lines.join("\n"), "utf8");

    const [run] = await listSubagentRuns(dir, PARENT);

    // Falls back to the generic name because the identity was out of window.
    expect(run?.agent).toBe("subagent");
    expect(wholeFileReads()).toEqual([]);
  });

  /**
   * The same for the other end: a step written before the tail window starts is
   * not the latest step, and must not be reported as one.
   */
  it("stops at the start of the tail window rather than reading back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-reads-"));
    const path = join(dir, PARENT, LIVE_RUN, "run-0");
    await mkdir(path, { recursive: true });
    // 64KB is the tail window; the only step sits before it and the rest of the
    // file carries no step at all.
    const lines = [
      JSON.stringify({ type: "session_info", name: `subagent-scout-${LIVE_RUN}-0` }),
      JSON.stringify({ message: { role: "assistant", content: [{ toolName: "out_of_window" }] } }),
      JSON.stringify({ note: "z".repeat(100_000) }),
    ];
    await writeFile(join(path, "session.jsonl"), lines.join("\n"), "utf8");

    const [run] = await listSubagentRuns(dir, PARENT);

    expect(run?.status).toBe("running");
    expect(run?.lastActivity).toBeUndefined();
    expect(wholeFileReads()).toEqual([]);
  });

  /**
   * Opening a run is a deliberate act by one reader, so its result is read in
   * full and only capped. The listing is what runs on a timer.
   */
  it("still hands over a whole result when someone opens the run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-reads-"));
    const artifacts = join(dir, "subagent-artifacts");
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(artifacts, "run-open_scout_0_output.md"), `# What I found\n\n${FILLER}`, "utf8");

    const output = await readSubagentRunOutput(dir, "run-open");

    expect(output).toContain(FILLER.slice(0, 1000));
  });
});
