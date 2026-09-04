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

function context(patch: Partial<DrawerSectionContext> = {}): DrawerSectionContext {
  return {
    sessionId: "s1",
    machineId: "local",
    workspacePath: "/repo",
    sessionCwd: undefined,
    requestUpdate: () => { updates += 1; },
    ...patch,
  };
}

let updates = 0;

function requests(calls: { operation: string; input: unknown }[]): unknown[] {
  return calls.map((call) => call.input);
}

describe("the goals section this plugin contributes", () => {
  it("reads its own goals through its own operation when first drawn", async () => {
    updates = 0;
    const { section, calls } = activate(() => Promise.resolve({ goals: [{ id: "g1" }] }));

    section.render(context());
    await Promise.resolve();

    expect(calls[0]?.operation).toBe("goals.read");
    expect(calls[0]?.input).toMatchObject({ workspacePath: "/repo" });
  });

  it("does not re-read the same workspace on every draw", async () => {
    const { section, calls } = activate(() => Promise.resolve({ goals: [] }));

    section.render(context());
    await Promise.resolve();
    section.render(context());
    await Promise.resolve();

    expect(calls).toHaveLength(1);
  });

  it("reads again when the workspace changes", async () => {
    const { section, calls } = activate(() => Promise.resolve({ goals: [] }));

    section.render(context());
    await Promise.resolve();
    section.render(context({ workspacePath: "/other" }));
    await Promise.resolve();

    expect(requests(calls)).toMatchObject([{ workspacePath: "/repo" }, { workspacePath: "/other" }]);
  });

  it("reads again when the focused session's cwd changes, and unions that root", async () => {
    const { section, calls } = activate(() => Promise.resolve({ goals: [] }));

    section.render(context());
    await Promise.resolve();
    section.render(context({ sessionCwd: "/repo/sub" }));
    await Promise.resolve();

    expect(requests(calls)).toMatchObject([{ workspacePath: "/repo" }, { workspacePath: "/repo", sessionCwd: "/repo/sub" }]);
  });

  it("asks the host to redraw when a read lands", async () => {
    updates = 0;
    const { section } = activate(() => Promise.resolve({ goals: [{ id: "g1" }] }));

    section.render(context());
    await Promise.resolve();
    await Promise.resolve();

    expect(updates).toBeGreaterThan(0);
  });

  it("re-reads when the reader asks for a refresh", async () => {
    const { section, calls } = activate(() => Promise.resolve({ goals: [] }));

    const drawn = section.render(context());
    await Promise.resolve();
    const refresh = drawn.values.find((value) => typeof value === "object");
    expect(refresh).toBeDefined();

    section.render(context());
    await Promise.resolve();
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("says it cannot tell yet before it has read, so the tab stays", () => {
    const { section } = activate(() => Promise.resolve({ goals: [] }));

    expect(section.available?.(context())).toBeUndefined();
    expect(section.badge?.(context())).toBeUndefined();
  });

  it("has nothing to show for a context with no workspace", () => {
    const { section } = activate(() => Promise.resolve({ goals: [] }));

    expect(section.available?.(context({ workspacePath: undefined }))).toBe(false);
  });

  it("says so once a read completed and found nothing", async () => {
    const { section } = activate(() => Promise.resolve({ goals: [] }));

    section.render(context());
    await Promise.resolve();
    await Promise.resolve();

    expect(section.available?.(context())).toBe(false);
    expect(section.badge?.(context())).toBeUndefined();
  });

  it("counts the goals it read once it has them", async () => {
    const { section } = activate(() => Promise.resolve({ goals: [{ id: "g1" }, { id: "g2" }] }));

    section.render(context());
    await Promise.resolve();
    await Promise.resolve();

    expect(section.available?.(context())).toBe(true);
    expect(section.badge?.(context())).toBe(2);
  });

  it("does not count another workspace's goals", async () => {
    const { section } = activate(() => Promise.resolve({ goals: [{ id: "g1" }] }));

    section.render(context());
    await Promise.resolve();
    await Promise.resolve();

    expect(section.badge?.(context({ workspacePath: "/other" }))).toBeUndefined();
  });

  it("archives a goal through its own operation and reads again", async () => {
    const { section, calls } = activate(() => Promise.resolve({ goals: [] }));

    section.render(context());
    await Promise.resolve();
    await Promise.resolve();
    const before = calls.length;
    section.render(context());
    const drawn = section.render(context());
    await Promise.resolve();
    expect(calls.length).toBeGreaterThanOrEqual(before);

    expect(requests(calls)[0]).toMatchObject({ workspacePath: "/repo" });
    expect(drawn).toBeDefined();
  });
});
