// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoalRecordSummary } from "../api";
import { GoalPanel } from "./GoalPanel";

afterEach(() => { document.body.replaceChildren(); });

describe("goal-panel", () => {
  it("summarises each goal with its status and completion ratio", async () => {
    const root = await mount([goal(), goal({ id: "g2", objective: "Second goal", status: "complete", completedTaskCount: 4, totalTaskCount: 4 })]);

    const headers = [...root.querySelectorAll(".goal-header")];
    expect(headers).toHaveLength(2);
    expect(headers[0]?.textContent).toContain("Ship the mobile work");
    expect(headers[0]?.textContent).toContain("Paused");
    expect(headers[0]?.textContent).toContain("1/3");
    expect(headers[1]?.textContent).toContain("Complete");
    expect(headers[1]?.textContent).toContain("4/4");
  });

  it("exposes progress to assistive technology as a real progressbar", async () => {
    const root = await mount([goal()]);

    const bar = root.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("1");
    expect(bar?.getAttribute("aria-valuemax")).toBe("3");
    // Scaled rather than resized so the animation stays on the compositor; the
    // fraction is what matters, however it is expressed.
    const fill = root.querySelector<HTMLElement>(".goal-bar-fill")?.getAttribute("style") ?? "";
    const scale = Number(/scaleX\(([0-9.]+)\)/u.exec(fill)?.[1] ?? "-1");
    expect(scale).toBeCloseTo(1 / 3, 2);
  });

  it("keeps goals collapsed but still names the task in progress", async () => {
    const root = await mount([goal()]);

    expect(root.querySelector(".task-list")).toBeNull();
    expect(root.querySelector(".goal-meta")?.textContent).toContain("Now: Global switcher");
  });

  it("reveals the task tree, contracts, and the focused task when expanded", async () => {
    const panel = await mountPanel([goal()]);
    const root = shadow(panel);

    root.querySelector<HTMLButtonElement>(".goal-header")?.click();
    await panel.updateComplete;

    const tasks = [...shadow(panel).querySelectorAll(".task")];
    expect(tasks).toHaveLength(3);
    expect(tasks[0]?.classList.contains("done")).toBe(true);
    expect(tasks[1]?.classList.contains("current")).toBe(true);
    expect(tasks[2]?.textContent).toContain("Nested subtask");
    expect(shadow(panel).textContent).toContain("Chat height grows");
  });

  it("surfaces why a goal stopped", async () => {
    const root = await mount([goal({ pauseReason: "Waiting on the user to confirm the container port" })]);
    expect(root.querySelector(".goal-reason")?.textContent).toContain("Waiting on the user");
  });

  it("distinguishes an empty workspace from a loading one", async () => {
    expect(shadow(await mountPanel([])).querySelector(".empty")?.textContent).toContain("No goals recorded");

    const loading = new GoalPanel();
    loading.goalsLoad = { state: "loading", key: "test-key", data: [] };
    document.body.append(loading);
    await loading.updateComplete;
    expect(shadow(loading).querySelector(".empty")?.textContent).toContain("Loading goals");
  });

  // The owner's screenshot: the goal file was active on disk while the panel
  // said "No goals recorded for this workspace", because a slot whose key does
  // not match the selection reached this panel as an empty loaded list. The
  // key gate lives in the reader (goalsForSelectedWorkspace, tested in
  // appState.test.ts); this panel's contract is that anything not loaded -
  // and therefore not a completed read - never claims emptiness.
  it("never claims an empty workspace for a slot that has not completed its read", async () => {
    const unloaded = new GoalPanel();
    unloaded.goalsLoad = { state: "unloaded", key: undefined, data: [] };
    document.body.append(unloaded);
    await unloaded.updateComplete;
    expect(shadow(unloaded).querySelector(".empty")?.textContent).not.toContain("No goals recorded");
    expect(shadow(unloaded).querySelector(".empty")?.textContent).toContain("Loading goals");
  });

  // A paused goal has no other way out of the panel: the extension's own clear
  // command refuses without a confirmable UI, which a web session has not got.
  it("archives only after a second, explicit press", async () => {
    const onArchive = vi.fn<(goal: GoalRecordSummary) => void>();
    const panel = await mountPanel([goal()], undefined, onArchive);
    shadow(panel).querySelector<HTMLButtonElement>(".goal-header")?.click();
    await panel.updateComplete;

    shadow(panel).querySelector<HTMLButtonElement>(".goal-archive")?.click();
    await panel.updateComplete;
    expect(onArchive).not.toHaveBeenCalled();
    expect(shadow(panel).querySelector(".goal-archive")?.textContent).toContain("Confirm archive");
    expect(shadow(panel).querySelector(".goal-archive-warning")?.textContent).toContain("archived/");

    shadow(panel).querySelector<HTMLButtonElement>(".goal-archive")?.click();
    await panel.updateComplete;
    expect(onArchive).toHaveBeenCalledOnce();
  });

  it("warns that an agent already working the goal keeps its own copy", async () => {
    const panel = await mountPanel([goal()], undefined, vi.fn());
    shadow(panel).querySelector<HTMLButtonElement>(".goal-header")?.click();
    await panel.updateComplete;
    shadow(panel).querySelector<HTMLButtonElement>(".goal-archive")?.click();
    await panel.updateComplete;

    expect(shadow(panel).querySelector(".goal-archive-warning")?.textContent).toContain("until it is told to reload");
  });

  it("offers no archive control when the host does not provide one", async () => {
    const panel = await mountPanel([goal()]);
    shadow(panel).querySelector<HTMLButtonElement>(".goal-header")?.click();
    await panel.updateComplete;

    expect(shadow(panel).querySelector(".goal-archive")).toBeNull();
  });

  it("requests a refresh on demand", async () => {
    const onRefresh = vi.fn();
    const panel = await mountPanel([goal()], onRefresh);

    shadow(panel).querySelector<HTMLButtonElement>(".refresh-entry")?.click();

    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

describe("the goals heading", () => {
  /**
   * A bare numeral beside a heading states nothing: it could be a count, an
   * index, or a badge. It also counted every record, so a workspace whose
   * goals were all finished still advertised a number as if work were
   * outstanding.
   */
  it("says what it counts, and counts only unfinished goals", async () => {
    const root = await mount([
      goal({ id: "g1", status: "paused" }),
      goal({ id: "g2", status: "complete" }),
    ]);

    const count = root.querySelector(".section-count");
    expect(count?.textContent.trim()).toBe("1 open");
  });

  it("says nothing when every goal is finished", async () => {
    const root = await mount([goal({ id: "g1", status: "complete" })]);

    expect(root.querySelector(".section-count")?.textContent.trim() ?? "").toBe("");
  });
});

describe("goal lifecycle controls", () => {
  it("offers resume for a paused goal and pause for a running one", async () => {
    const paused = await mount([goal({ status: "paused" })]);
    expect(commandLabels(paused)).toContain("Resume");
    expect(commandLabels(paused)).not.toContain("Pause");

    const active = await mount([goal({ status: "active" })]);
    expect(commandLabels(active)).toContain("Pause");
    expect(commandLabels(active)).not.toContain("Resume");
  });

  it("offers nothing to run once a goal is finished", async () => {
    const done = await mount([goal({ status: "complete" })]);
    expect(commandLabels(done)).toEqual([]);
  });

  /**
   * The command text is the contract. The extension owns goal state, and its
   * slash commands are the only entry point that keeps the audit, accounting
   * and focus rules intact, so the button must send exactly what a person
   * would type rather than reach for the record on disk.
   */
  it("runs the same slash command a person would type, for that goal", async () => {
    const onRunCommand = vi.fn();
    const panel = await mountPanel([goal({ status: "paused" })], undefined, undefined, onRunCommand);
    button(shadow(panel), "Resume").click();

    expect(onRunCommand).toHaveBeenCalledOnce();
    expect(onRunCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }), "/goal-resume");
  });

  it("sends the abandon command rather than the draft-cancel command", async () => {
    const onRunCommand = vi.fn();
    const panel = await mountPanel([goal({ status: "paused" })], undefined, undefined, onRunCommand);
    button(shadow(panel), "Abandon").click();

    // `/goal-cancel` cancels an in-progress draft; abandoning a goal is
    // `/goal-clear`. The two read alike and do different things.
    expect(onRunCommand).toHaveBeenCalledWith(expect.anything(), "/goal-clear");
  });

  it("disables the controls when there is no session to run them in", async () => {
    const panel = new GoalPanel();
    panel.goalsLoad = { state: "loaded", key: "test-key", data: [goal({ status: "paused" })] };
    panel.canRunCommands = false;
    document.body.append(panel);
    await panel.updateComplete;

    const resume = button(shadow(panel), "Resume");
    expect(resume.disabled).toBe(true);
    expect(resume.title).toMatch(/session/iu);
  });

  it("quietly names the source root only when two roots contributed rows", async () => {
    const workspaceCopy = goal({ id: "g1", sourceRoot: "/repo" });
    const sessionCopy = goal({ id: "g2", objective: "Written beside a sibling checkout", sourceRoot: "/repo.checkout" });
    const multiRoot = await mount([workspaceCopy, sessionCopy]);
    const roots = [...multiRoot.querySelectorAll(".goal-root")].map((el) => el.textContent.trim());
    expect(roots).toEqual(["/repo", "/repo.checkout"]);

    // One root is the everyday shape: no qualifier at all, so the panel looks
    // exactly as it did before the union read existed.
    const singleRoot = await mount([goal({ id: "g1" })]);
    expect(singleRoot.querySelectorAll(".goal-root")).toHaveLength(0);
  });
});

function commandLabels(root: ShadowRoot): string[] {
  return [...root.querySelectorAll(".goal-command")].map((el) => el.textContent.trim());
}

function button(root: ShadowRoot, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>(".goal-command")]
    .find((el) => el.textContent.trim() === label);
  if (found === undefined) throw new Error(`Expected a ${label} control`);
  return found;
}

async function mount(goals: GoalRecordSummary[]): Promise<ShadowRoot> {
  return shadow(await mountPanel(goals));
}

async function mountPanel(goals: GoalRecordSummary[], onRefresh?: () => void, onArchive?: (goal: GoalRecordSummary) => void, onRunCommand?: (goal: GoalRecordSummary, command: string) => void): Promise<GoalPanel> {
  const panel = new GoalPanel();
  panel.goalsLoad = { state: "loaded", key: "test-key", data: goals };
  if (onRefresh !== undefined) panel.onRefresh = onRefresh;
  if (onArchive !== undefined) panel.onArchive = onArchive;
  if (onRunCommand !== undefined) panel.onRunCommand = onRunCommand;
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function shadow(panel: GoalPanel): ShadowRoot {
  const root = panel.shadowRoot;
  if (root === null) throw new Error("Expected goal-panel shadow root");
  return root;
}

function goal(overrides: Partial<GoalRecordSummary> = {}): GoalRecordSummary {
  return {
    id: "g1",
    objective: "Ship the mobile work",
    status: "paused",
    path: "/repo/.pi/goals/g1.md",
    sisyphus: false,
    autoContinue: false,
    currentTaskId: "t2",
    tokensUsed: 1_142_125,
    tasks: [
      { id: "t1", title: "Compress the header", status: "complete", verificationContract: "Chat height grows" },
      {
        id: "t2",
        title: "Global switcher",
        status: "pending",
        subtasks: [{ id: "t2a", title: "Nested subtask", status: "pending" }],
      },
    ],
    completedTaskCount: 1,
    totalTaskCount: 3,
    ...overrides,
  };
}

describe("goal-panel failure state", () => {
  /**
   * A failed read must not read as "this workspace has no goals": the empty
   * line and the failure line answer different questions.
   */
  it("says the read failed instead of claiming there are no goals", async () => {
    const panel = new GoalPanel();
    panel.goalsLoad = { state: "failed", key: "test-key", data: [] };
    document.body.append(panel);
    await panel.updateComplete;

    expect(shadow(panel).querySelector(".empty")?.textContent).toContain("Couldn't read");
    expect(shadow(panel).querySelector(".empty")?.textContent).not.toContain("No goals recorded");
  });
});
