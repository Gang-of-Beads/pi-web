import { html, svg } from "lit";
import { describe, expect, it } from "vitest";
import { badgeFor, progressLabel } from "./goalsSectionElement.js";
import type { GoalRecordSummary } from "./goalRecords.js";
import plugin from "./pi-web-plugin.js";
import type { DrawerSectionContribution } from "@gang-of-beads/pi-web/plugin-api";

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

function requiredSection(): DrawerSectionContribution {
  const section = plugin.activate(activationContext).contributions.drawerSections?.[0];
  if (section === undefined) throw new Error("Expected the Goals drawer section");
  return section;
}

describe("the goals drawer section contract", () => {
  it("contributes exactly one drawer section named Goals", () => {
    const sections = plugin.activate(activationContext).contributions.drawerSections;
    expect(sections).toHaveLength(1);
    const section = sections?.[0];
    if (section === undefined) throw new Error("Expected the Goals drawer section");
    expect(section.title).toBe("Goals");
  });

  it("is unavailable without a workspace path", () => {
    const section = requiredSection();
    const available = section.available?.({ sessionId: "s", machineId: "m", workspacePath: undefined, sessionCwd: undefined, requestUpdate: () => undefined });
    expect(available).toBe(false);
  });

  it("hides itself once the workspace read found no goals", () => {
    const section = requiredSection();
    const context = { sessionId: "s", machineId: "m", workspacePath: "/w", sessionCwd: undefined, requestUpdate: () => undefined };
    expect(section.available?.(context)).toBeUndefined();
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
