import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listGoalsOperation, readGoalDirectory } from "./server-plugin.js";

let root: string;

const goalFile = (objective: string, status: string, updatedAt: string): string => JSON.stringify({
  version: 3, id: `goal-${objective.replace(/\W+/g, "-").toLowerCase()}`, objective, status, updatedAt,
  taskList: { tasks: [{ id: "t1", title: "One", status: "complete" }, { id: "t2", title: "Two", status: "pending" }] },
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "goals-plugin-"));
  await mkdir(join(root, ".pi", "goals"), { recursive: true });
  await writeFile(join(root, ".pi", "goals", "active_goal_a.md"), goalFile("Alpha", "active", "2026-09-08T10:00:00.000Z"));
  await writeFile(join(root, ".pi", "goals", "active_goal_b.md"), goalFile("Beta", "complete", "2026-09-09T00:00:00.000Z"));
  await writeFile(join(root, ".pi", "goals", "broken.md"), "{ not json");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("readGoalDirectory", () => {
  it("reads workspace goal records, sorted live-first, counting broken files", async () => {
    const reading = await readGoalDirectory(root, undefined);
    expect(reading.goals.map((goal) => goal.objective)).toEqual(["Alpha", "Beta"]);
    expect(reading.brokenFiles).toBe(1);
  });

  let nestedRoot: string;

  it("overlays session-cwd goals on the workspace's by id", async () => {
    nestedRoot = join(root, "nested");
    await mkdir(join(nestedRoot, ".pi", "goals"), { recursive: true });
    await writeFile(join(nestedRoot, ".pi", "goals", "active_goal_a.md"), goalFile("Nested Alpha", "active", "2026-09-08T11:00:00.000Z"));
    const reading = await readGoalDirectory(root, nestedRoot);
    expect(reading.goals.map((goal) => goal.objective)).toEqual(["Nested Alpha", "Alpha", "Beta"]);
  });

  it("ignores a session cwd outside the workspace", async () => {
    const outside = await mkdtemp(join(tmpdir(), "goals-outside-"));
    try {
      const reading = await readGoalDirectory(root, outside);
      expect(reading.goals.map((goal) => goal.objective)).toEqual(["Alpha", "Beta"]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("returns an empty reading for a workspace without goals", async () => {
    const empty = await mkdtemp(join(tmpdir(), "goals-empty-"));
    try {
      const reading = await readGoalDirectory(empty, undefined);
      expect(reading).toEqual({ goals: [], brokenFiles: 0, roots: [empty] });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe("listGoalsOperation", () => {
  const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

  const goalObjectives = async (input: unknown): Promise<string[]> => {
    const answer = await listGoalsOperation(input, { signal: new AbortController().signal });
    if (!isRecord(answer) || !Array.isArray(answer["goals"])) throw new Error("Expected a goals array");
    const goals: unknown[] = answer["goals"];
    return goals.map((goal) => (isRecord(goal) && typeof goal["objective"] === "string" ? goal["objective"] : ""));
  };

  it("answers the workspace read through the operation channel", async () => {
    expect(await goalObjectives({ workspacePath: root })).toEqual(["Alpha", "Beta"]);
  });

  it("answers empty for a missing or relative workspace path", async () => {
    const signal = { signal: new AbortController().signal };
    expect(await listGoalsOperation({}, signal)).toEqual({ goals: [], brokenFiles: 0, roots: [] });
    expect(await listGoalsOperation({ workspacePath: "relative/path" }, signal)).toEqual({ goals: [], brokenFiles: 0, roots: [] });
  });
});
