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
    loading.goals = [];
    loading.loading = true;
    document.body.append(loading);
    await loading.updateComplete;
    expect(shadow(loading).querySelector(".empty")?.textContent).toContain("Loading goals");
  });

  it("requests a refresh on demand", async () => {
    const onRefresh = vi.fn();
    const panel = await mountPanel([goal()], onRefresh);

    shadow(panel).querySelector<HTMLButtonElement>(".refresh-entry")?.click();

    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

async function mount(goals: GoalRecordSummary[]): Promise<ShadowRoot> {
  return shadow(await mountPanel(goals));
}

async function mountPanel(goals: GoalRecordSummary[], onRefresh?: () => void): Promise<GoalPanel> {
  const panel = new GoalPanel();
  panel.goals = goals;
  if (onRefresh !== undefined) panel.onRefresh = onRefresh;
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
