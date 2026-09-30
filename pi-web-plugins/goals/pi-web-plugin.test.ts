import { html, svg } from "lit";
import { describe, expect, it } from "vitest";
import { badgeFor, goalsSectionStyles, progressLabel } from "./goalsSectionElement.js";
import type { GoalRecordSummary } from "./goalRecords.js";
import plugin from "./pi-web-plugin.js";

const activationContext = {
  apiVersion: 2,
  pluginId: "goals",
  runtimePluginId: "goals",
  html,
  svg,
} as const;

const record = (overrides: Partial<GoalRecordSummary> = {}): GoalRecordSummary => ({
  id: "goal-1", objective: "Ship the thing", status: "active", tasksTotal: 5, tasksDone: 2, updatedAt: "2026-09-08T10:00:00.000Z",
  ...overrides,
});

describe("the Goals page", () => {
  /**
   * Owner, 2026-09-30: "don't add a separate goal bar… it belongs in the three-bar Go to menu. Once a plugin declares it, a new plugin button appears, and tapping it opens the plugin's own custom display".
   * Goals is one entry in the Go to page, opening its own page; nothing sits over the transcript.
   */
  it("is a Go to page entry named Goals, and no bar over the transcript", () => {
    const contributions = plugin.activate(activationContext).contributions;
    expect({
      panels: (contributions.workspacePanels ?? []).map((panel) => [panel.id, panel.title]),
      drawer: Reflect.has(contributions, "drawerSections"),
    }).toEqual({ panels: [["goals", "Goals"]], drawer: false });
  });

  /**
   * Inside the old drawer the section borrowed the drawer's padding; as a page it has none of its
   * own, and on a 393 px phone the goal's status dot sat on the screen edge, half cut. A page owns
   * its inset and its scroll, like every other plugin page.
   */
  it("insets its content from the reading edge and scrolls on its own", () => {
    const host = /:host\s*\{([^}]*)\}/u.exec(goalsSectionStyles)?.[1] ?? "";
    expect(host).toMatch(/padding:[^;]*var\(--pi-reading-edge\)/u);
    expect(host).toMatch(/overflow:\s*auto/u);
  });

  it("badges the remaining task count and stays quiet when nothing remains", () => {
    expect(badgeFor({ goals: [record()], brokenFiles: 0 })).toBe(3);
    expect(badgeFor({ goals: [record({ status: "complete" })], brokenFiles: 0 })).toBeUndefined();
    expect(badgeFor({ goals: [record({ tasksTotal: 0 })], brokenFiles: 0 })).toBeUndefined();
    expect(badgeFor(undefined)).toBeUndefined();
  });

  it("labels progress from the done/total pair", () => {
    expect(progressLabel(record())).toBe("2/5 tasks");
    expect(progressLabel(record({ status: "complete" }))).toBe("5/5 tasks");
    expect(progressLabel(record({ tasksTotal: 0 }))).toBeUndefined();
  });
});
