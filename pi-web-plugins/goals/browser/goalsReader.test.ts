import { describe, expect, it } from "vitest";
import { GoalsReader } from "./goalsReader.js";

function reader(call: (operation: string, input?: unknown) => Promise<unknown>) {
  const changes: string[] = [];
  const instance = new GoalsReader(call, () => { changes.push(instance.current().state); });
  return { instance, changes };
}

describe("reading goals through the plugin's own operation", () => {
  it("asks its own operation, naming the workspace it is reading for", async () => {
    const seen: { operation: string; input: unknown }[] = [];
    const { instance } = reader((operation, input) => {
      seen.push({ operation, input });
      return Promise.resolve({ goals: [{ id: "g1" }] });
    });

    await instance.read("/repo", "/repo/sub");

    expect(seen[0]?.operation).toBe("goals.read");
    expect(seen[0]?.input).toEqual({ workspacePath: "/repo", sessionCwd: "/repo/sub" });
    expect(instance.current().data).toEqual([{ id: "g1" }]);
  });

  it("reports a refused read as failed, not as a workspace with no goals", async () => {
    const { instance } = reader(() => Promise.reject(new Error("daemon unreachable")));

    await instance.read("/repo");

    expect(instance.current().state).toBe("failed");
    expect(instance.current().error).toContain("daemon unreachable");
  });

  it("passes through loading before it answers", async () => {
    const { instance, changes } = reader(() => Promise.resolve({ goals: [] }));

    await instance.read("/repo");

    expect(changes).toEqual(["loading", "loaded"]);
  });

  it("does not let an overtaken read land under the workspace that replaced it", async () => {
    let release: ((value: { goals: { id: string }[] }) => void) | undefined;
    const slow = new Promise<{ goals: { id: string }[] }>((resolve) => { release = resolve; });
    const { instance } = reader((_operation, input) => {
      const path: unknown = typeof input === "object" && input !== null ? Reflect.get(input, "workspacePath") : undefined;
      return path === "/slow" ? slow : Promise.resolve({ goals: [{ id: "fast" }] });
    });

    const first = instance.read("/slow");
    await instance.read("/fast");
    release?.({ goals: [{ id: "slow" }] });
    await first;

    expect(instance.current().key).toBe("/fast");
    expect(instance.current().data).toEqual([{ id: "fast" }]);
  });

  it("treats an answer without goals as a failure rather than an empty workspace", async () => {
    const { instance } = reader(() => Promise.resolve({}));

    await instance.read("/repo");

    expect(instance.current().state).toBe("failed");
  });
});
