import { describe, expect, it } from "vitest";
import { parseGoalRecord, sortGoalRecords, type GoalRecordSummary } from "./goalRecords.js";

const goalFile = (overrides: Record<string, unknown> = {}): unknown => JSON.parse(JSON.stringify({
  version: 3,
  id: "active_goal_1_test",
  objective: "Ship the thing",
  status: "active",
  updatedAt: "2026-09-08T10:00:00.000Z",
  taskList: { tasks: [{ id: "task-1", title: "One", status: "complete" }, { id: "task-2", title: "Two", status: "pending" }] },
  ...overrides,
}));

describe("parseGoalRecord", () => {
  it("parses a version-3 goal file into a summary", () => {
    const goal = parseGoalRecord("active_goal_1_test.md", goalFile());
    expect(goal).toMatchObject({ id: "active_goal_1_test", objective: "Ship the thing", status: "active", tasksTotal: 2, tasksDone: 1, updatedAt: "2026-09-08T10:00:00.000Z" });
  });

  it("derives the id from the file name when the record has none", () => {
    const goal = parseGoalRecord("active_goal_2_fallback.md", goalFile({ id: undefined }));
    expect(goal?.id).toBe("active_goal_2_fallback");
  });

  it("reads currentStatus when status is absent", () => {
    const goal = parseGoalRecord("g.md", goalFile({ status: undefined, currentStatus: "paused" }));
    expect(goal?.status).toBe("paused");
  });

  it("defaults an unknown status to active", () => {
    const goal = parseGoalRecord("g.md", goalFile({ status: "mysterious" }));
    expect(goal?.status).toBe("active");
  });

  it("returns undefined for non-object bodies and empty objectives", () => {
    expect(parseGoalRecord("b.md", "just a string")).toBeUndefined();
    expect(parseGoalRecord("c.md", goalFile({ objective: "   " }))).toBeUndefined();
  });

  it("tolerates a goal without a task list", () => {
    const goal = parseGoalRecord("g.md", goalFile({ taskList: undefined }));
    expect(goal).toMatchObject({ tasksTotal: 0, tasksDone: 0 });
  });
});

describe("sortGoalRecords", () => {
  const record = (id: string, status: GoalRecordSummary["status"], updatedAt: string): GoalRecordSummary => ({
    id, objective: id, status, tasksTotal: 0, tasksDone: 0, updatedAt,
  });

  it("leads with live goals by recency and trails completed ones", () => {
    const sorted = sortGoalRecords([
      record("old-live", "active", "2026-09-01T00:00:00.000Z"),
      record("done", "complete", "2026-09-09T00:00:00.000Z"),
      record("new-live", "active", "2026-09-08T00:00:00.000Z"),
    ]);
    expect(sorted.map((goal) => goal.id)).toEqual(["new-live", "old-live", "done"]);
  });

  it("breaks recency ties by id", () => {
    const sorted = sortGoalRecords([record("b", "active", "2026-09-08T00:00:00.000Z"), record("a", "active", "2026-09-08T00:00:00.000Z")]);
    expect(sorted.map((goal) => goal.id)).toEqual(["b", "a"]);
  });
});
