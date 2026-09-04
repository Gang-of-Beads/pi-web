import { html } from "lit";
import { describe, expect, it } from "vitest";
import plugin from "./pi-web-plugin.js";
import type { DrawerSectionContext } from "@gang-of-beads/pi-web/plugin-api";

function activate(answer: () => Promise<unknown>) {
  const calls: { operation: string; input: unknown }[] = [];
  const result = plugin.activate({
    apiVersion: 2,
    pluginId: "goals",
    runtimePluginId: "goals",
    html,
    svg: html,
    callOperation: (operation, input) => {
      calls.push({ operation, input });
      return answer();
    },
  });
  const section = result.contributions.drawerSections?.[0];
  if (section === undefined) throw new Error("The goals plugin contributed no section");
  return { section, calls, dispose: result.dispose };
}

const context: DrawerSectionContext = { sessionId: "s1", machineId: "local", workspacePath: "/repo" };

describe("the goals section this plugin contributes", () => {
  it("reads its own goals through its own operation when first drawn", async () => {
    const { section, calls } = activate(() => Promise.resolve({ goals: [{ id: "g1" }] }));

    section.render(context);
    await Promise.resolve();

    expect(calls[0]?.operation).toBe("goals.read");
    expect(calls[0]?.input).toMatchObject({ workspacePath: "/repo" });
  });

  it("does not re-read the same workspace on every draw", async () => {
    const { section, calls } = activate(() => Promise.resolve({ goals: [] }));

    section.render(context);
    await Promise.resolve();
    section.render(context);
    await Promise.resolve();

    expect(calls).toHaveLength(1);
  });

  it("reads again when the workspace changes", async () => {
    const { section, calls } = activate(() => Promise.resolve({ goals: [] }));

    section.render(context);
    await Promise.resolve();
    section.render({ ...context, workspacePath: "/other" });
    await Promise.resolve();

    expect(calls.map((call) => call.input)).toMatchObject([{ workspacePath: "/repo" }, { workspacePath: "/other" }]);
  });

  it("says it cannot tell yet before it has read, so the tab stays", () => {
    const { section } = activate(() => Promise.resolve({ goals: [] }));

    expect(section.available?.(context)).toBeUndefined();
    expect(section.badge?.(context)).toBeUndefined();
  });

  it("has nothing to show for a context with no workspace", () => {
    const { section } = activate(() => Promise.resolve({ goals: [] }));

    expect(section.available?.({ ...context, workspacePath: undefined })).toBe(false);
  });

  it("counts the goals it read once it has them", async () => {
    const { section } = activate(() => Promise.resolve({ goals: [{ id: "g1" }, { id: "g2" }] }));

    section.render(context);
    await Promise.resolve();
    await Promise.resolve();

    expect(section.available?.(context)).toBe(true);
    expect(section.badge?.(context)).toBe(2);
  });
});
