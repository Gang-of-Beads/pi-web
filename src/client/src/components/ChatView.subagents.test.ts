// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { SessionSubagentInfo, SessionSubagentRunInfo } from "../../../shared/apiTypes";
import { ChatView, subagentRows, subagentRunDuration, subagentRunRows } from "./ChatView";

const SUBAGENTS: SessionSubagentInfo[] = [
  { sessionId: "01a0child-0001-0000-000000000001", cwd: "/repo/.pi/sub", status: "working" },
  { sessionId: "01a0child-0002-0000-000000000002", cwd: "/repo/.pi/sub", status: "idle" },
];

async function mount(subagents: readonly SessionSubagentInfo[]): Promise<{ host: HTMLElement | DocumentFragment; onOpenSubagent: ReturnType<typeof vi.fn> }> {
  const view = new ChatView();
  view.sessionId = "parent-1";
  view.subagents = subagents;
  const onOpenSubagent = vi.fn<(info: SessionSubagentInfo) => void>();
  view.onOpenSubagent = onOpenSubagent;
  document.body.append(view);
  await view.updateComplete;
  return { host: view.renderRoot, onOpenSubagent };
}

describe("subagents strip", () => {
  it("shows each subagent with its status and opens one on tap", async () => {
    const { host, onOpenSubagent } = await mount(SUBAGENTS);

    const rows = [...host.querySelectorAll(".subagent-row")];
    expect(rows.length).toBe(2);
    expect(host.textContent).toContain("Subagents (2)");
    expect(host.textContent).toContain("Working");
    expect(rows[0]?.getAttribute("aria-label")).toBe("Working subagent 00000001");
    expect(rows[1]?.getAttribute("aria-label")).toBe("idle subagent 00000002");

    rows[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenSubagent).toHaveBeenCalledExactlyOnceWith(SUBAGENTS[0]);
  });

  it("renders nothing when the session has no subagents", async () => {
    const { host } = await mount([]);
    expect(host.querySelector(".subagents-strip")).toBeNull();
  });
});

const RUNS: SessionSubagentRunInfo[] = [
  { runId: "run-live", agent: "scout", status: "running", elapsedMs: 42_000, startedAt: "2026-08-21T10:00:00.000Z", lastActivity: "bash", hasOutput: false },
  { runId: "run-done", agent: "reviewer", status: "done", elapsedMs: 125_000, startedAt: "2026-08-21T09:00:00.000Z", task: "review the diff", hasOutput: true },
];

async function mountRuns(runs: readonly SessionSubagentRunInfo[]): Promise<{ host: HTMLElement | DocumentFragment; onOpenSubagentRun: ReturnType<typeof vi.fn> }> {
  const view = new ChatView();
  view.sessionId = "parent-1";
  view.subagentRuns = runs;
  const onOpenSubagentRun = vi.fn<(run: SessionSubagentRunInfo) => void>();
  view.onOpenSubagentRun = onOpenSubagentRun;
  document.body.append(view);
  await view.updateComplete;
  return { host: view.renderRoot, onOpenSubagentRun };
}

describe("subagent tool runs", () => {
  it("lists runs with agent, status, elapsed time and current step", async () => {
    // These runs are not sessions, so this strip is the only place they are
    // visible anywhere in the UI.
    const { host } = await mountRuns(RUNS);

    expect(host.textContent).toContain("Subagents (2)");
    expect(host.textContent).toContain("scout");
    expect(host.textContent).toContain("Running");
    expect(host.textContent).toContain("42s");
    expect(host.textContent).toContain("bash");
    expect(host.textContent).toContain("review the diff");
  });

  it("opens the output of a finished run and leaves a running one inert", async () => {
    const { host, onOpenSubagentRun } = await mountRuns(RUNS);
    const rows = [...host.querySelectorAll(".subagent-row")];

    rows[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenSubagentRun).not.toHaveBeenCalled();

    rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenSubagentRun).toHaveBeenCalledExactlyOnceWith(RUNS[1]);
  });
});

describe("subagentRunRows", () => {
  it("shows the live step while running and the task once finished", () => {
    const [live, done] = subagentRunRows(RUNS);
    expect(live).toMatchObject({ statusLabel: "Running", duration: "42s", detail: "bash" });
    expect(done).toMatchObject({ statusLabel: "Done", duration: "2m 5s", detail: "review the diff" });
  });

  it("formats durations at every scale", () => {
    expect(subagentRunDuration(900)).toBe("1s");
    expect(subagentRunDuration(65_000)).toBe("1m 5s");
    expect(subagentRunDuration(3_900_000)).toBe("1h 5m");
  });
});

// The pure seam: rendered rows derive their fields once, so the strip stays a
// dumb map and this shape is what the template consumes.
describe("subagentRows", () => {
  it("shortens ids and labels status with a caption word", () => {
    expect(subagentRows(SUBAGENTS)).toEqual([
      { subagent: SUBAGENTS[0], shortId: "00000001", status: "working", statusLabel: "Working", cwd: "/repo/.pi/sub", ariaLabel: "Working subagent 00000001" },
      { subagent: SUBAGENTS[1], shortId: "00000002", status: "idle", statusLabel: "idle", cwd: "/repo/.pi/sub", ariaLabel: "idle subagent 00000002" },
    ]);
  });
});