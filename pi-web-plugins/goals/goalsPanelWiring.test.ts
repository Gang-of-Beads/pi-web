// @vitest-environment happy-dom

import { html, render } from "lit";
import { describe, expect, it } from "vitest";
import plugin from "./pi-web-plugin.js";
import type { DrawerSectionContext, PluginActivationContext } from "@gang-of-beads/pi-web/plugin-api";
import "./browser/defineGoalPanel.js";
import type { GoalRecordSummary } from "./browser/goalTypes.js";

function goal(): GoalRecordSummary {
  return {
    id: "g1",
    objective: "Ship the mobile work",
    status: "paused",
    path: "/repo/.pi/goals/g1.md",
    sisyphus: false,
    autoContinue: false,
    currentTaskId: "t2",
    tokensUsed: 1_142_125,
    tasks: [{ id: "t2", title: "Global switcher", status: "pending" }],
    completedTaskCount: 0,
    totalTaskCount: 1,
  };
}

function activate(answer: () => Promise<unknown>) {
  const calls: { operation: string; input: unknown }[] = [];
  const result = plugin.activate({
    apiVersion: 2,
    pluginId: "goals",
    runtimePluginId: "goals",
    html,
    svg: html,
    callOperation: (operation: string, input: unknown) => {
      calls.push({ operation, input });
      return answer();
    },
  } satisfies PluginActivationContext);
  const section = result.contributions.drawerSections?.[0];
  if (section === undefined) throw new Error("The goals plugin contributed no section");
  return { section, calls };
}

function context(): DrawerSectionContext {
  return {
    sessionId: "s1",
    machineId: "local",
    workspacePath: "/repo",
    sessionCwd: undefined,
    requestUpdate: () => { return; },
  };
}

function redraw(section: ReturnType<typeof activate>["section"], host: HTMLElement): HTMLElement {
  render(section.render(context()), host);
  const panel = host.querySelector("goal-panel");
  if (panel === null) throw new Error("The section rendered no goal panel");
  return panel;
}

async function settle(panel?: HTMLElement & { updateComplete?: Promise<boolean> }): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  await panel?.updateComplete;
}

async function untilReadSettles(panel: HTMLElement & { updateComplete?: Promise<boolean>; shadowRoot: ShadowRoot | null }): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await panel.updateComplete;
    const busy = panel.shadowRoot?.querySelector(".refresh-entry")?.hasAttribute("disabled") ?? true;
    if (!busy) return;
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
  throw new Error("The goal panel never finished its read");
}

async function drawnPanel(section: ReturnType<typeof activate>["section"], calls: { operation: string; input: unknown }[]) {
  const host = document.createElement("div");
  document.body.append(host);
  let panel = redraw(section, host);
  await settle(panel);
  panel = redraw(section, host);
  await settle(panel);
  return { host, panel, calls };
}

describe("the goals panel the section renders", () => {
  it("wires refresh to its own read", async () => {
    const { section, calls } = activate(() => Promise.resolve({ goals: [goal()] }));
    const { host, panel, calls: all } = await drawnPanel(section, calls);
    const before = all.length;

    const button = panel.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="Refresh goals"]');
    if (button === undefined || button === null) throw new Error("The goal panel rendered no refresh button");
    await untilReadSettles(panel);
    button.click();
    await settle(redraw(section, host));

    expect(all.length).toBeGreaterThan(before);
    host.remove();
  });

  it("wires archive to its own operation and reads again afterwards", async () => {
    const { section, calls } = activate(() => Promise.resolve({ goals: [goal()] }));
    const { host, panel, calls: all } = await drawnPanel(section, calls);
    const before = all.length;

    await untilReadSettles(panel);
    const header = panel.shadowRoot?.querySelector<HTMLButtonElement>(".goal-header");
    if (header === undefined || header === null) throw new Error("The goal panel rendered no expandable goal header");
    header.click();
    await settle(panel);
    const armed = panel.shadowRoot?.querySelector<HTMLButtonElement>('.goal-archive');
    if (armed === undefined || armed === null) throw new Error('The goal panel rendered no archive button');
    armed.click();
    const button = panel.shadowRoot?.querySelector<HTMLButtonElement>('.goal-archive');
    if (button === undefined || button === null) throw new Error('The goal panel rendered no archive confirm button');
    button.click();
    await settle(redraw(section, host));

    expect(all[before]).toMatchObject({ operation: "goals.archive", input: { workspacePath: "/repo", goalId: "g1" } });
    expect(all.slice(before + 1).some((call) => call.operation === "goals.read")).toBe(true);
    host.remove();
  });
});
